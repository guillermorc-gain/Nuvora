package com.guillermorc.nuvora.sync

// Adaptado de Memories (mismo autor): Syncthing dentro de la app.

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

/**
 * Syncthing va dentro de la APK como libsyncthing.so (un ejecutable, no una
 * librería): Android lo deja en nativeLibraryDir, el único sitio desde el que
 * una app puede lanzar programas. Se habla con él por su API REST local.
 */
class Syncthing(private val context: Context) {
    private val binario = File(context.applicationInfo.nativeLibraryDir, "libsyncthing.so")
    private val home = File(context.filesDir, "syncthing")
    private val registro = File(context.filesDir, "syncthing.log")
    private val puerto = 28385
    private val base = "http://127.0.0.1:$puerto"
    private var proceso: Process? = null

    val disponible: Boolean get() = binario.exists()
    // Process.isAlive() no existe hasta Android 8: si exitValue() falla, sigue vivo.
    val enMarcha: Boolean get() = proceso?.let { p -> runCatching { p.exitValue(); false }.getOrDefault(true) } == true

    private val apiKey: String by lazy {
        val prefs = context.getSharedPreferences("sync", Context.MODE_PRIVATE)
        prefs.getString("apikey", null) ?: run {
            val letras = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            val azar = SecureRandom()
            val clave = (1..32).map { letras[azar.nextInt(letras.length)] }.joinToString("")
            prefs.edit().putString("apikey", clave).apply()
            clave
        }
    }

    fun arrancar() {
        if (enMarcha || !disponible) return
        home.mkdirs()
        val pb = ProcessBuilder(
            binario.path, "serve",
            "--home", home.path,
            "--no-browser", "--no-restart", "--no-upgrade",
            "--gui-address", "127.0.0.1:$puerto",
            "--gui-apikey", apiKey,
        ).redirectErrorStream(true)
        pb.environment().apply {
            put("HOME", context.filesDir.path)
            put("STNOUPGRADE", "1")
            put("STNORESTART", "1")
        }
        val p = pb.start()
        proceso = p
        // Se vacía la salida (si no, el proceso se bloquea) guardando lo último.
        Thread {
            runCatching {
                registro.writeText("")
                p.inputStream.bufferedReader().forEachLine { linea ->
                    if (registro.length() > 512 * 1024) registro.writeText("")
                    registro.appendText(linea + "\n")
                }
            }
        }.apply { isDaemon = true; name = "syncthing-log" }.start()
    }

    fun parar() {
        val p = proceso ?: return
        runCatching { peticion("POST", "/rest/system/shutdown", null) }
        // Hasta 5 s para cerrarse bien; si no, se corta.
        repeat(50) { if (runCatching { p.exitValue() }.isSuccess) return@repeat; Thread.sleep(100) }
        runCatching { p.exitValue() }.onFailure { p.destroy() }
        proceso = null
    }

    /** Espera a que la API responda (arrancar lleva unos segundos). */
    suspend fun esperarLista(maxMs: Long = 60_000): Boolean {
        val fin = System.currentTimeMillis() + maxMs
        while (System.currentTimeMillis() < fin) {
            if (!enMarcha) return false
            val ok = withContext(Dispatchers.IO) {
                runCatching { JSONObject(peticion("GET", "/rest/noauth/health", null)).optString("status") == "OK" }
                    .getOrDefault(false)
            }
            if (ok) return true
            delay(1000)
        }
        return false
    }

    suspend fun get(ruta: String): String = withContext(Dispatchers.IO) { peticion("GET", ruta, null) }
    suspend fun getJson(ruta: String): JSONObject = JSONObject(get(ruta))
    suspend fun getLista(ruta: String): JSONArray = JSONArray(get(ruta))
    suspend fun put(ruta: String, cuerpo: JSONObject) = withContext(Dispatchers.IO) { peticion("PUT", ruta, cuerpo.toString()) }
    suspend fun post(ruta: String, cuerpo: JSONObject? = null) = withContext(Dispatchers.IO) { peticion("POST", ruta, cuerpo?.toString()) }
    suspend fun delete(ruta: String) = withContext(Dispatchers.IO) { peticion("DELETE", ruta, null) }

    private fun peticion(metodo: String, ruta: String, cuerpo: String?): String {
        val c = URL(base + ruta).openConnection() as HttpURLConnection
        c.requestMethod = metodo
        c.setRequestProperty("X-API-Key", apiKey)
        c.connectTimeout = 5_000
        c.readTimeout = 30_000
        try {
            if (cuerpo != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(cuerpo.toByteArray()) }
            }
            val codigo = c.responseCode
            val texto = (if (codigo in 200..299) c.inputStream else c.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            if (codigo !in 200..299) error("Syncthing $metodo $ruta → $codigo $texto")
            return texto
        } finally {
            c.disconnect()
        }
    }
}
