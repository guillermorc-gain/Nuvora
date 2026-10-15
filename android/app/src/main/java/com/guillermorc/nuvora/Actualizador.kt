package com.guillermorc.nuvora

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.app.Notification
import com.guillermorc.nuvora.ui.AppActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Una versión de Nuvora publicada en GitHub Releases. */
data class Version(val numero: Int, val nombre: String, val url: String, val tamano: Long, val notas: String)

sealed interface EstadoActualizacion {
    data object Nada : EstadoActualizacion
    data object Buscando : EstadoActualizacion
    data object AlDia : EstadoActualizacion
    data class Disponible(val version: Version) : EstadoActualizacion
    data class Descargando(val version: Version, val progreso: Float) : EstadoActualizacion
    data class Instalando(val version: Version) : EstadoActualizacion
    data class Error(val mensaje: String, val version: Version? = null) : EstadoActualizacion
}

/**
 * Actualiza Nuvora desde dentro de la app: mira la última versión en GitHub
 * Releases, descarga Nuvora.apk y la instala con el instalador de Android
 * (sin navegador ni gestor de archivos).
 */
object Actualizador {
    private const val API = "https://api.github.com/repos/guillermorc-gain/Nuvora/releases/latest"
    private const val CANAL = "actualizaciones"

    private val _estado = MutableStateFlow<EstadoActualizacion>(EstadoActualizacion.Nada)
    val estado: StateFlow<EstadoActualizacion> = _estado

    /** Esta versión (v0.N → N), la que puso el workflow al compilar. */
    val actual: Int get() = BuildConfig.VERSION_CODE

    /** Busca una versión más nueva. [silencioso]: sin «Buscando…» ni errores (al abrir la app). */
    suspend fun buscar(silencioso: Boolean = false) {
        if (_estado.value is EstadoActualizacion.Descargando || _estado.value is EstadoActualizacion.Instalando) return
        if (!silencioso) _estado.value = EstadoActualizacion.Buscando
        try {
            val v = ultima()
            _estado.value = if (v != null && v.numero > actual) EstadoActualizacion.Disponible(v)
            else if (silencioso) EstadoActualizacion.Nada else EstadoActualizacion.AlDia
        } catch (e: Exception) {
            _estado.value = if (silencioso) EstadoActualizacion.Nada
            else EstadoActualizacion.Error("No se pudo comprobar. ¿Tienes internet?")
        }
    }

    fun descartar() {
        if (_estado.value !is EstadoActualizacion.Descargando && _estado.value !is EstadoActualizacion.Instalando) {
            _estado.value = EstadoActualizacion.Nada
        }
    }

    private suspend fun ultima(): Version? = withContext(Dispatchers.IO) {
        val c = URL(API).openConnection() as HttpURLConnection
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        try {
            if (c.responseCode != 200) throw IllegalStateException("GitHub ${c.responseCode}")
            val j = JSONObject(c.inputStream.bufferedReader().readText())
            val etiqueta = j.optString("tag_name")
            val numero = etiqueta.substringAfterLast('.').toIntOrNull() ?: return@withContext null
            val assets = j.optJSONArray("assets") ?: return@withContext null
            // La APK se sube un par de minutos después de crear la versión: sin ella, aún no hay nada que instalar
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.optString("name") == "Nuvora.apk") {
                    return@withContext Version(
                        numero, etiqueta.removePrefix("v"), a.getString("browser_download_url"),
                        a.optLong("size"), limpiarNotas(j.optString("body")),
                    )
                }
            }
            null
        } finally {
            c.disconnect()
        }
    }

    /** De las notas de la versión, solo la lista de novedades. */
    private fun limpiarNotas(md: String): String =
        md.substringAfter("## Novedades", md).substringBefore("## ").lines()
            .map { it.trim() }.filter { it.startsWith("- ") }.take(8)
            .joinToString("\n") { "• " + it.removePrefix("- ") }

    /** Android pide una vez permitir «Instalar apps desconocidas» para Nuvora. */
    fun puedeInstalar(context: Context): Boolean =
        Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun intentPermiso(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))

    /** Descarga la APK y se la pasa al instalador de Android. */
    suspend fun actualizar(context: Context, v: Version) {
        val app = context.applicationContext
        _estado.value = EstadoActualizacion.Descargando(v, 0f)
        try {
            val apk = descargar(app, v)
            _estado.value = EstadoActualizacion.Instalando(v)
            withContext(Dispatchers.IO) { instalar(app, apk) }
            app.getSharedPreferences("ajustes", Context.MODE_PRIVATE).edit().putInt("actualizandoA", v.numero).apply()
        } catch (e: Exception) {
            _estado.value = EstadoActualizacion.Error("No se pudo descargar la actualización. Inténtalo otra vez.", v)
        }
    }

    private suspend fun descargar(context: Context, v: Version): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "actualizacion").apply { deleteRecursively(); mkdirs() }
        val destino = File(dir, "Nuvora-${v.nombre}.apk")
        var url = URL(v.url)
        // GitHub redirige a otro dominio: se siguen las redirecciones a mano por si acaso
        repeat(5) {
            val c = url.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            val codigo = c.responseCode
            if (codigo in 300..399) {
                url = URL(url, c.getHeaderField("Location"))
                c.disconnect()
                return@repeat
            }
            if (codigo != 200) throw IllegalStateException("HTTP $codigo")
            val total = c.contentLengthLong.takeIf { it > 0 } ?: v.tamano
            c.inputStream.use { entrada ->
                destino.outputStream().use { salida ->
                    val buf = ByteArray(64 * 1024)
                    var leido = 0L
                    var ultimo = 0f
                    while (true) {
                        val n = entrada.read(buf)
                        if (n < 0) break
                        salida.write(buf, 0, n)
                        leido += n
                        val p = if (total > 0) (leido.toFloat() / total).coerceAtMost(1f) else 0f
                        if (p - ultimo >= 0.01f) { ultimo = p; _estado.value = EstadoActualizacion.Descargando(v, p) }
                    }
                }
            }
            c.disconnect()
            if (total > 0 && destino.length() != total) throw IllegalStateException("Descarga incompleta")
            return@withContext destino
        }
        throw IllegalStateException("Demasiadas redirecciones")
    }

    private fun instalar(context: Context, apk: File) {
        val instalador = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            // Desde Android 12, si la última vez instaló Nuvora ella misma, actualiza sin preguntar
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = instalador.createSession(params)
        instalador.openSession(id).use { sesion ->
            sesion.openWrite("Nuvora.apk", 0, apk.length()).use { salida ->
                apk.inputStream().use { it.copyTo(salida) }
                sesion.fsync(salida)
            }
            val aviso = PendingIntent.getBroadcast(
                context, id, Intent(context, InstalacionReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            sesion.commit(aviso.intentSender)
        }
    }

    internal fun fallo(mensaje: String) {
        val v = (_estado.value as? EstadoActualizacion.Instalando)?.version
        _estado.value = EstadoActualizacion.Error(mensaje, v)
    }

    /** Tras actualizarse, Android cierra la app: un aviso para volver a abrirla de un toque. */
    fun avisarActualizada(context: Context) {
        val prefs = context.getSharedPreferences("ajustes", Context.MODE_PRIVATE)
        val a = prefs.getInt("actualizandoA", 0)
        if (a == 0) return
        prefs.edit().remove("actualizandoA").apply()
        File(context.cacheDir, "actualizacion").deleteRecursively()
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, "Actualizaciones", NotificationManager.IMPORTANCE_DEFAULT))
        val abrir = PendingIntent.getActivity(
            context, 0, Intent(context, AppActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val n = Notification.Builder(context, CANAL)
            .setSmallIcon(R.drawable.ic_sync)
            .setContentTitle("Nuvora se ha actualizado")
            .setContentText("Ya tienes la versión ${BuildConfig.VERSION_NAME}. Toca para abrirla.")
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(7, n) }
    }
}

/** El instalador de Android cuenta aquí cómo va: si necesita tu «Actualizar», lo enseña encima de la app. */
class InstalacionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirmar = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                confirmar?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_FAILURE_ABORTED -> Actualizador.fallo("Actualización cancelada.")
            PackageInstaller.STATUS_FAILURE_STORAGE -> Actualizador.fallo("No hay espacio suficiente en el móvil.")
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                Actualizador.fallo("Esta versión no se puede instalar encima. Desinstala Nuvora e instálala de nuevo.")
            else -> Actualizador.fallo(
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)?.let { "No se pudo instalar: $it" }
                    ?: "No se pudo instalar la actualización.",
            )
        }
    }
}
