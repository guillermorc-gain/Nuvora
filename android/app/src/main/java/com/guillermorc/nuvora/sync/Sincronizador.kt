package com.guillermorc.nuvora.sync

import android.content.Context
import android.net.ConnectivityManager
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/** Cómo va un dispositivo de tu cuenta visto desde este. */
data class EstadoDispositivo(
    val dispositivo: Dispositivo,
    val conectado: Boolean,
    /** 0–100: cuánto tiene ese dispositivo de lo que hay aquí. */
    val completado: Int,
)

data class EstadoSync(
    val disponible: Boolean = true,
    val activo: Boolean = false,
    val miId: String? = null,
    val estadoCarpeta: String = "",
    val pendientes: Long = 0,
    val otros: List<EstadoDispositivo> = emptyList(),
    val pausada: Boolean = false,
    val error: String? = null,
)

/**
 * Mantiene Syncthing al día con tus dispositivos (de Firestore): todos comparten
 * la carpeta «nuvora» en los dos sentidos. Lo borrado va a la papelera de
 * Syncthing (.stversions) en los demás durante 30 días.
 */
object Sincronizador {
    private val _estado = MutableStateFlow(EstadoSync())
    val estado: StateFlow<EstadoSync> = _estado.asStateFlow()

    /** Sube cuando cambia algo en la carpeta, para que la lista se repinte. */
    private val _cambios = MutableStateFlow(0)
    val cambios: StateFlow<Int> = _cambios.asStateFlow()

    private var st: Syncthing? = null
    private val candado = Mutex()

    /** Para avisar a Syncthing de que la app ha cambiado algo (subir, borrar…). */
    suspend fun revisar() {
        runCatching { st?.post("/rest/db/scan?folder=${Carpeta.ID}") }
        _cambios.value++
    }

    private fun soloWifi(context: Context) =
        context.getSharedPreferences("ajustes", Context.MODE_PRIVATE).getBoolean("soloWifi", false)

    private fun redMedida(context: Context) =
        context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered == true

    suspend fun ejecutar(context: Context) {
        val s = Syncthing(context)
        if (!s.disponible) {
            _estado.value = EstadoSync(disponible = false, error = "Esta versión de la app no lleva Syncthing")
            awaitCancellation()
        }
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        try {
            s.arrancar()
            if (!s.esperarLista()) {
                _estado.value = EstadoSync(error = "No se pudo arrancar la sincronización")
                return
            }
            st = s
            val miId = s.getJson("/rest/system/status").getString("myID")
            configurarOpciones(s)
            Dispositivos.publicar(context, uid, miId)
            _estado.value = EstadoSync(activo = true, miId = miId)

            coroutineScope {
                val todos = MutableStateFlow<List<Dispositivo>>(emptyList())
                launch {
                    Dispositivos.flujo(uid).collect { lista ->
                        todos.value = lista
                        runCatching { reconciliar(s, context, miId, lista) }
                    }
                }
                // Estado cada pocos segundos (y la pausa si solo se sincroniza con wifi)
                var versionVista = -1L
                var pausadaVista: Boolean? = null
                while (true) {
                    runCatching {
                        val pausar = soloWifi(context) && redMedida(context)
                        if (pausar != pausadaVista) {
                            pausadaVista = pausar
                            reconciliar(s, context, miId, todos.value)
                        }
                        val estadoCarpeta = s.getJson("/rest/db/status?folder=${Carpeta.ID}")
                        val version = estadoCarpeta.optLong("version", 0)
                        if (version != versionVista) { versionVista = version; _cambios.value++ }
                        val conexiones = s.getJson("/rest/system/connections").optJSONObject("connections") ?: JSONObject()
                        val otros = todos.value.filter { it.id != miId }.map { d ->
                            val c = conexiones.optJSONObject(d.id)
                            val completado = runCatching {
                                s.getJson("/rest/db/completion?folder=${Carpeta.ID}&device=${d.id}").optDouble("completion", 0.0).toInt()
                            }.getOrDefault(0)
                            EstadoDispositivo(d, c?.optBoolean("connected") == true, completado)
                        }
                        _estado.value = EstadoSync(
                            activo = true, miId = miId,
                            estadoCarpeta = estadoCarpeta.optString("state"),
                            pendientes = estadoCarpeta.optLong("needFiles", 0),
                            otros = otros, pausada = pausar,
                        )
                    }
                    delay(4000)
                }
            }
        } finally {
            st = null
            s.parar()
            _estado.value = _estado.value.copy(activo = false)
        }
    }

    private suspend fun configurarOpciones(s: Syncthing) {
        val o = s.getJson("/rest/config/options")
        o.put("urAccepted", -1)
        o.put("urSeen", 3)
        o.put("startBrowser", false)
        o.put("crashReportingEnabled", false)
        o.put("autoUpgradeIntervalH", 0)
        o.put("globalAnnounceEnabled", true)
        o.put("localAnnounceEnabled", true)
        o.put("relaysEnabled", true)
        o.put("natEnabled", true)
        s.put("/rest/config/options", o)
    }

    /** Que Syncthing conozca a todos tus dispositivos y comparta con ellos la carpeta. */
    private suspend fun reconciliar(s: Syncthing, context: Context, miId: String, lista: List<Dispositivo>) = candado.withLock {
        val otros = lista.filter { it.id != miId }
        val tengo = s.getLista("/rest/config/devices").let { l ->
            (0 until l.length()).map { l.getJSONObject(it).getString("deviceID") }
        }.toSet()
        otros.filter { it.id !in tengo }.forEach { d ->
            s.put(
                "/rest/config/devices/${d.id}",
                JSONObject()
                    .put("deviceID", d.id)
                    .put("name", d.nombre)
                    .put("addresses", JSONArray().put("dynamic"))
                    .put("autoAcceptFolders", false),
            )
        }
        // Los que ya no están en tu cuenta (los quitaste en Dispositivos) dejan de sincronizar
        (tengo - otros.map { it.id }.toSet() - miId).forEach { runCatching { s.delete("/rest/config/devices/$it") } }

        val raiz = Carpeta.raiz(context)
        java.io.File(raiz, ".stfolder").mkdirs()
        val dispositivos = JSONArray().put(JSONObject().put("deviceID", miId))
        otros.forEach { dispositivos.put(JSONObject().put("deviceID", it.id)) }
        val pausar = soloWifi(context) && redMedida(context)
        s.put(
            "/rest/config/folders/${Carpeta.ID}",
            JSONObject()
                .put("id", Carpeta.ID)
                .put("label", "Nuvora")
                .put("path", raiz.path)
                .put("type", "sendreceive")
                .put("devices", dispositivos)
                .put("rescanIntervalS", 600)
                .put("fsWatcherEnabled", true)
                .put("fsWatcherDelayS", 2)
                .put("ignorePerms", true)
                .put("paused", pausar)
                .put("markerName", ".stfolder")
                .put("versioning", JSONObject().put("type", "trashcan").put("params", JSONObject().put("cleanoutDays", "30"))),
        )
    }
}
