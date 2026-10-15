package com.guillermorc.nuvora.sync

import android.content.Context
import android.os.Build
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/** Un dispositivo de tu cuenta (móvil, tablet, Mac…) con su id de Syncthing. */
data class Dispositivo(
    val id: String,
    val nombre: String,
    val plataforma: String,
    val visto: Long,
)

/**
 * La lista de tus dispositivos vive en Firestore (plan gratuito): usuarios/{uid}/dispositivos/{id}.
 * Así, al entrar con tu cuenta de Google en un dispositivo nuevo, todos los demás
 * lo conocen y se emparejan solos para sincronizar la carpeta Nuvora.
 */
object Dispositivos {
    /** Si la nube (Firestore) falla, el motivo: sin ella tus dispositivos no se encuentran. */
    val error = MutableStateFlow<String?>(null)

    fun explicar(e: Throwable?): String {
        val m = e?.message ?: ""
        return when {
            "PERMISSION_DENIED" in m || "permission" in m.lowercase() ->
                "La nube no deja guardar tus dispositivos: revisa las reglas de Firestore del proyecto Nuvora (deben estar publicadas)."
            "NOT_FOUND" in m || "does not exist" in m ->
                "Falta crear la base de datos de Firestore en el proyecto Nuvora de Firebase."
            "UNAVAILABLE" in m || "offline" in m.lowercase() -> "Sin conexión con la nube. Se reintentará solo."
            else -> "No se pudo hablar con la nube: $m"
        }
    }

    private fun coleccion(uid: String) =
        FirebaseFirestore.getInstance().collection("usuarios").document(uid).collection("dispositivos")

    fun nombreDeEste(): String {
        val marca = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        return if (Build.MODEL.startsWith(marca, ignoreCase = true)) Build.MODEL else "$marca ${Build.MODEL}"
    }

    suspend fun publicar(context: Context, uid: String, miId: String) {
        coleccion(uid).document(miId).set(
            mapOf("nombre" to nombreDeEste(), "plataforma" to "android", "visto" to FieldValue.serverTimestamp()),
            SetOptions.merge(),
        ).await()
        error.value = null
        context.getSharedPreferences("sync", Context.MODE_PRIVATE).edit().putString("miId", miId).apply()
    }

    /** Apunta otro dispositivo (un Mac u ordenador emparejado) en tu lista. */
    suspend fun registrar(uid: String, id: String, nombre: String, plataforma: String) {
        coleccion(uid).document(id).set(
            mapOf("nombre" to nombre, "plataforma" to plataforma, "visto" to FieldValue.serverTimestamp()),
            SetOptions.merge(),
        ).await()
    }

    suspend fun quitar(uid: String, id: String) {
        runCatching { coleccion(uid).document(id).delete().await() }
    }

    fun flujo(uid: String): Flow<List<Dispositivo>> = callbackFlow {
        val r = coleccion(uid).addSnapshotListener { snap, e ->
            if (e != null) error.value = explicar(e)
            if (snap == null) return@addSnapshotListener
            if (!snap.metadata.isFromCache) error.value = null
            trySend(snap.documents.map { d ->
                Dispositivo(
                    id = d.id,
                    nombre = d.getString("nombre") ?: "Dispositivo",
                    plataforma = d.getString("plataforma") ?: "",
                    visto = d.getTimestamp("visto")?.toDate()?.time ?: 0L,
                )
            })
        }
        awaitClose { r.remove() }
    }
}
