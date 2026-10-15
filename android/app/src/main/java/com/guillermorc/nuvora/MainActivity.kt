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

        @JavascriptInterface
        fun cerrarSesionGoogle() {
            runOnUiThread {
                CredentialManager.create(this@MainActivity).clearCredentialStateAsync(
                    ClearCredentialStateRequest(), null, enPrincipal,
                    object : CredentialManagerCallback<Void?, ClearCredentialException> {
                        override fun onResult(result: Void?) {}
                        override fun onError(e: ClearCredentialException) {}
                    })
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
            errorGoogle("Esta versión de la app se compiló sin google-services.json del proyecto Nuvora de Firebase. Entra con un código o con tu correo.")
            return
        }
        val opcion = GetSignInWithGoogleOption.Builder(cliente).build()
        val peticion = GetCredentialRequest.Builder().addCredentialOption(opcion).build()
        CredentialManager.create(this).getCredentialAsync(this, peticion, CancellationSignal(), enPrincipal,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val c = result.credential
                    if (c is CustomCredential && c.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        val token = GoogleIdTokenCredential.createFrom(c.data).idToken
                        js("window.nuvoraGoogleToken && nuvoraGoogleToken(${JSONObject.quote(token)})")
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
        if (requestCode != ELEGIR_ARCHIVOS) return
        val callback = subida ?: return
        subida = null
        if (resultCode != RESULT_OK || data == null) return callback.onReceiveValue(null)
        val varios = data.clipData
        val uris = if (varios != null) Array(varios.itemCount) { varios.getItemAt(it).uri }
        else data.data?.let { arrayOf(it) }
        callback.onReceiveValue(uris)
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
    }
}
