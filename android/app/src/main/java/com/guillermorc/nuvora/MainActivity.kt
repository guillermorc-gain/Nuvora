package com.guillermorc.nuvora

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
import android.provider.ContactsContract
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import org.json.JSONObject
import java.util.concurrent.Executor
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.net.URL
import kotlin.concurrent.thread

/**
 * Nuvora para Android: la app web de tu servidor Nuvora dentro de la app, con
 * lo que el navegador no da: elegir archivos del móvil para subirlos, descargas
 * a «Descargas», vídeo a pantalla completa y la barra de estado del color del tema.
 * La primera vez pide la dirección del servidor (pantalla assets/inicio.html).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var raiz: FrameLayout
    private var subida: ValueCallback<Array<Uri>>? = null
    private var pantallaCompleta: View? = null

    // Token de Google conseguido en la pantalla de bienvenida, para entrar en el servidor al conectar
    private var tokenGoogle: String? = null
    private var tokenGoogleHora = 0L

    private val prefs by lazy { getSharedPreferences("nuvora", MODE_PRIVATE) }
    private val servidor: String? get() = prefs.getString("servidor", null)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        raiz = FrameLayout(this)
        web = WebView(this)
        raiz.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(raiz)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = "$userAgentString NuvoraApp/${version()}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        web.addJavascriptInterface(Puente(), "NuvoraApp")
        web.webViewClient = Cliente()
        web.webChromeClient = Navegador()
        web.setDownloadListener { url, userAgent, disposicion, tipo, _ -> descargar(url, userAgent, disposicion, tipo) }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else abrirInicio()
    }

    private fun abrirInicio(error: Boolean = false) {
        val s = servidor
        if (s != null && !error) web.loadUrl(s)
        else {
            val q = listOfNotNull(s?.let { "url=" + Uri.encode(it) }, if (error) "error=1" else null)
            web.loadUrl("file:///android_asset/inicio.html" + (if (q.isEmpty()) "" else "?" + q.joinToString("&")))
        }
    }

    private fun version(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }

    /** Lo que la página puede pedir a la app (window.NuvoraApp en JavaScript). */
    inner class Puente {
        /** Comprueba que en esa dirección hay un servidor Nuvora y, si lo hay, lo abre. */
        @JavascriptInterface
        fun conectar(direccion: String) {
            var url = direccion.trim().trimEnd('/')
            if (url.isEmpty()) return responder("Escribe la dirección del servidor.")
            if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://$url"
            thread {
                val error = comprobar(url)
                runOnUiThread {
                    if (error == null) {
                        prefs.edit().putString("servidor", url).apply()
                        web.clearHistory()
                        web.loadUrl(url)
                    } else responder(error)
                }
            }
        }

        /** Abre la hoja de cuentas de Google de Android y entrega el token a la página. */
        @JavascriptInterface
        fun iniciarConGoogle() {
            runOnUiThread { entrarConGoogle() }
        }

        /** ¿Se compiló la app con el proyecto de Google (google-services.json)? */
        @JavascriptInterface
        fun googleDisponible(): Boolean = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotEmpty()

        /** El token de Google de la bienvenida (una sola vez y si tiene menos de 50 minutos). */
        @JavascriptInterface
        fun tokenPendiente(): String {
            val t = tokenGoogle
            tokenGoogle = null
            return if (t != null && System.currentTimeMillis() - tokenGoogleHora < 50 * 60_000) t else ""
        }

        /** La cuenta de Google con la que se entró la última vez: {"nombre": …, "foto": …} */
        @JavascriptInterface
        fun cuenta(): String = JSONObject().apply {
            put("nombre", prefs.getString("cuentaNombre", "") ?: "")
            put("foto", prefs.getString("cuentaFoto", "") ?: "")
        }.toString()

        @JavascriptInterface
        fun cerrarSesionGoogle() {
            prefs.edit().remove("cuentaNombre").remove("cuentaFoto").apply()
            runOnUiThread {
                CredentialManager.create(this@MainActivity).clearCredentialStateAsync(
                    ClearCredentialStateRequest(), null, enPrincipal,
                    object : CredentialManagerCallback<Void?, ClearCredentialException> {
                        override fun onResult(result: Void?) {}
                        override fun onError(e: ClearCredentialException) {}
                    })
            }
        }

        /** Elegir un contacto del móvil (para añadirlo de amigo). Devuelve su correo a la página. */
        @JavascriptInterface
        fun elegirContacto() {
            runOnUiThread {
                try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Email.CONTENT_URI), ELEGIR_CONTACTO)
                } catch (_: ActivityNotFoundException) {
                    js("window.nuvoraContactos && nuvoraContactos([])")
                }
            }
        }

        @JavascriptInterface
        fun cambiarServidor() {
            runOnUiThread {
                val actual = servidor
                prefs.edit().remove("servidor").apply()
                web.loadUrl("file:///android_asset/inicio.html" + (if (actual != null) "?url=" + Uri.encode(actual) else ""))
            }
        }

        /**
         * Busca servidores Nuvora en la wifi: prueba el puerto 3000 de todas las
         * direcciones de la red del móvil y avisa a la página de cada uno que encuentra.
         */
        @JavascriptInterface
        fun buscarServidores() {
            thread { buscarEnLaWifi() }
        }

        @JavascriptInterface
        fun servidor(): String = this@MainActivity.servidor ?: ""

        @JavascriptInterface
        fun version(): String = this@MainActivity.version()

        /** La barra de estado del color de la cabecera del tema elegido en Apariencia. */
        @JavascriptInterface
        fun colorBarra(hex: String) {
            runOnUiThread {
                try {
                    window.statusBarColor = Color.parseColor(hex.trim())
                } catch (_: IllegalArgumentException) { }
            }
        }

        private fun responder(mensaje: String) {
            runOnUiThread {
                web.evaluateJavascript("window.mostrarError && mostrarError(${JSONObject.quote(mensaje)})", null)
            }
        }
    }

    private val enPrincipal = Executor { runOnUiThread(it) }

    private fun js(codigo: String) = web.evaluateJavascript(codigo, null)

    /**
     * «Iniciar sesión con Google» nativo (Credential Manager), con el cliente web del
     * proyecto de Firebase «Nuvora»: el servidor Nuvora comprueba el token y abre la sesión.
     */
    private fun entrarConGoogle() {
        val cliente = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (cliente.isEmpty()) {
            errorGoogle("El inicio de sesión con Google aún no está activado: falta crear el proyecto Nuvora en Firebase. Mientras tanto, conecta con tu Nuvora y entra con tu correo o con un código.")
            return
        }
        val opcion = GetSignInWithGoogleOption.Builder(cliente).build()
        val peticion = GetCredentialRequest.Builder().addCredentialOption(opcion).build()
        CredentialManager.create(this).getCredentialAsync(this, peticion, CancellationSignal(), enPrincipal,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val c = result.credential
                    if (c is CustomCredential && c.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        val g = GoogleIdTokenCredential.createFrom(c.data)
                        tokenGoogle = g.idToken
                        tokenGoogleHora = System.currentTimeMillis()
                        val nombre = g.displayName ?: g.id
                        val foto = g.profilePictureUri?.toString() ?: ""
                        prefs.edit().putString("cuentaNombre", nombre).putString("cuentaFoto", foto).apply()
                        js("window.nuvoraGoogleToken && nuvoraGoogleToken(${JSONObject.quote(g.idToken)}, ${JSONObject.quote(nombre)}, ${JSONObject.quote(foto)})")
                    } else errorGoogle("Google devolvió una credencial inesperada.")
                }

                override fun onError(e: GetCredentialException) {
                    when (e) {
                        is GetCredentialCancellationException -> {}
                        is NoCredentialException -> errorGoogle(
                            "Google no ha dejado entrar. Comprueba que hay una cuenta de Google en el móvil " +
                                "y que la app está registrada en el proyecto Nuvora de Firebase con su SHA-1 (README → Iniciar sesión con Google)."
                        )
                        else -> errorGoogle("No se pudo entrar con Google: ${e.message ?: e.type}")
                    }
                }
            })
    }

    private fun errorGoogle(mensaje: String) =
        js("window.nuvoraGoogleError && nuvoraGoogleError(${JSONObject.quote(mensaje)})")

    private fun buscarEnLaWifi() {
        val propias = NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
        val redes = propias.map { it.hostAddress!!.substringBeforeLast('.') }.distinct()
        val encontrados = AtomicInteger(0)
        val grupo = Executors.newFixedThreadPool(48)
        for (red in redes) for (n in 1..254) {
            grupo.execute {
                val url = "http://$red.$n:$PUERTO"
                try {
                    val c = URL("$url/api/config").openConnection() as HttpURLConnection
                    c.connectTimeout = 700
                    c.readTimeout = 1500
                    if (c.responseCode == 200) {
                        val datos = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                        if (datos.optBoolean("nuvora")) {
                            encontrados.incrementAndGet()
                            val nombre = datos.optString("nombre", "$red.$n")
                            runOnUiThread { js("window.servidorEncontrado && servidorEncontrado(${JSONObject.quote(url)}, ${JSONObject.quote(nombre)})") }
                        }
                    }
                    c.disconnect()
                } catch (_: Exception) { }
            }
        }
        grupo.shutdown()
        grupo.awaitTermination(30, TimeUnit.SECONDS)
        runOnUiThread { js("window.busquedaTerminada && busquedaTerminada(${encontrados.get()}, ${redes.isNotEmpty()})") }
    }

    /** null si en [url] responde un servidor Nuvora; si no, el motivo para enseñarlo. */
    private fun comprobar(url: String): String? = try {
        val c = URL("$url/api/me").openConnection() as HttpURLConnection
        c.connectTimeout = 6000
        c.readTimeout = 6000
        val codigo = c.responseCode
        val cuerpo = (if (codigo >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        if ((codigo == 200 || codigo == 401) && (cuerpo.contains("\"error\"") || cuerpo.contains("\"email\""))) null
        else "En esa dirección no hay un servidor Nuvora (respuesta $codigo)."
    } catch (e: Exception) {
        "No se pudo conectar con $url. Comprueba que el servidor está encendido y que el móvil está en la misma red."
    }

    private inner class Cliente : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == "file") return false
            val base = servidor?.let { Uri.parse(it) }
            if (base != null && url.host == base.host && url.port == base.port) return false
            // Los enlaces a otras webs se abren fuera, en el navegador
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, url))
                true
            } catch (_: ActivityNotFoundException) { false }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            // Si no se puede abrir el servidor, se vuelve a la pantalla de inicio con el aviso
            if (request.isForMainFrame && request.url.scheme != "file") abrirInicio(error = true)
        }
    }

    private inner class Navegador : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            subida?.onReceiveValue(null)
            subida = callback
            val intent = params.createIntent().apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                if (type.isNullOrEmpty() || type == ".*") type = "*/*"
            }
            return try {
                startActivityForResult(Intent.createChooser(intent, "Elegir archivos"), ELEGIR_ARCHIVOS)
                true
            } catch (_: ActivityNotFoundException) {
                subida = null
                false
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            pantallaCompleta = view
            raiz.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web.visibility = View.GONE
            if (Build.VERSION.SDK_INT >= 30) {
                window.insetsController?.hide(android.view.WindowInsets.Type.systemBars())
                window.insetsController?.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }

        override fun onHideCustomView() {
            pantallaCompleta?.let { raiz.removeView(it) }
            pantallaCompleta = null
            web.visibility = View.VISIBLE
            if (Build.VERSION.SDK_INT >= 30) window.insetsController?.show(android.view.WindowInsets.Type.systemBars())
        }
    }

    @Deprecated("Activity sin AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == ELEGIR_CONTACTO) return contactoElegido(if (resultCode == RESULT_OK) data?.data else null)
        if (requestCode != ELEGIR_ARCHIVOS) return
        val callback = subida ?: return
        subida = null
        if (resultCode != RESULT_OK || data == null) return callback.onReceiveValue(null)
        val varios = data.clipData
        val uris = if (varios != null) Array(varios.itemCount) { varios.getItemAt(it).uri }
        else data.data?.let { arrayOf(it) }
        callback.onReceiveValue(uris)
    }

    /** El selector de contactos de Android da permiso para leer solo ese contacto (no hace falta pedir permisos). */
    private fun contactoElegido(uri: Uri?) {
        val lista = org.json.JSONArray()
        if (uri != null) runCatching {
            contentResolver.query(
                uri,
                arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS, ContactsContract.Contacts.DISPLAY_NAME),
                null, null, null,
            )?.use { c ->
                if (c.moveToFirst()) lista.put(JSONObject().put("email", c.getString(0) ?: "").put("name", c.getString(1) ?: ""))
            }
        }
        js("window.nuvoraContactos && nuvoraContactos($lista)")
    }

    /** Las descargas van a «Descargas» con su nombre, usando la sesión de la app. */
    private fun descargar(url: String, userAgent: String, disposicion: String?, tipo: String?) {
        try {
            val nombre = URLUtil.guessFileName(url, disposicion, tipo)
            val peticion = DownloadManager.Request(Uri.parse(url)).apply {
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                addRequestHeader("User-Agent", userAgent)
                setTitle(nombre)
                setDescription("Nuvora")
                if (!tipo.isNullOrEmpty()) setMimeType(tipo)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombre)
            }
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(peticion)
            Toast.makeText(this, "Descargando $nombre", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo descargar: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Activity sin AndroidX")
    override fun onBackPressed() {
        when {
            pantallaCompleta != null -> (web.webChromeClient as? WebChromeClient)?.onHideCustomView()
            web.canGoBack() -> web.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    companion object {
        private const val ELEGIR_ARCHIVOS = 7
        private const val ELEGIR_CONTACTO = 8
        private const val PUERTO = 3000
    }
}
