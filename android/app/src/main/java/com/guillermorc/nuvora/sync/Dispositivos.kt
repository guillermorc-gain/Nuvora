package com.guillermorc.nuvora.sync

import android.content.Context
import android.os.Build
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
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
        context.getSharedPreferences("sync", Context.MODE_PRIVATE).edit().putString("miId", miId).apply()
    }

    suspend fun quitar(uid: String, id: String) {
        runCatching { coleccion(uid).document(id).delete().await() }
    }

    fun flujo(uid: String): Flow<List<Dispositivo>> = callbackFlow {
        val r = coleccion(uid).addSnapshotListener { snap, _ ->
            if (snap == null) return@addSnapshotListener
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
