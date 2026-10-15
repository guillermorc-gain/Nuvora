package com.guillermorc.nuvora.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL

/** Un Mac u ordenador con Nuvora en la wifi, listo para emparejarse. */
data class Ordenador(val url: String, val nombre: String)

/**
 * Emparejar el móvil con tu Mac u ordenador: se busca en la wifi (puerto 3000),
 * se manda el código de 6 cifras que enseña el ordenador y el id de Syncthing de
 * este móvil; el ordenador responde con el suyo, que se apunta en tu lista de dispositivos.
 */
object Emparejar {
    private const val PUERTO = 3000

    suspend fun buscar(): List<Ordenador> = withContext(Dispatchers.IO) {
        val redes = NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .map { it.hostAddress!!.substringBeforeLast('.') }
            .distinct()
        val limite = Semaphore(48)
        coroutineScope {
            redes.flatMap { red -> (1..254).map { "http://$red.$it:$PUERTO" } }.map { url ->
                async {
                    limite.withPermit {
                        runCatching {
                            val c = URL("$url/api/config").openConnection() as HttpURLConnection
                            c.connectTimeout = 700
                            c.readTimeout = 1500
                            val datos = if (c.responseCode == 200) JSONObject(c.inputStream.bufferedReader().use { it.readText() }) else null
                            c.disconnect()
                            if (datos != null && datos.optBoolean("nuvora") && datos.optBoolean("syncthing")) {
                                Ordenador(url, datos.optString("nombre", url))
                            } else null
                        }.getOrNull()
                    }
                }
            }.awaitAll().filterNotNull()
        }
    }

    /** Devuelve el id de Syncthing y el nombre del ordenador. */
    suspend fun emparejar(ordenador: Ordenador, codigo: String, miId: String, miNombre: String): Pair<String, String> =
        withContext(Dispatchers.IO) {
            val c = URL("${ordenador.url}/api/emparejar").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 5000
            c.readTimeout = 15000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use {
                it.write(JSONObject().put("codigo", codigo).put("id", miId).put("nombre", miNombre).toString().toByteArray())
            }
            val codigoHttp = c.responseCode
            val texto = (if (codigoHttp in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            c.disconnect()
            val json = JSONObject(texto)
            if (codigoHttp !in 200..299) error(json.optString("error", "El ordenador respondió $codigoHttp"))
            json.getString("id") to json.optString("nombre", ordenador.nombre)
        }
}
