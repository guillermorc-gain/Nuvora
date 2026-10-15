package com.guillermorc.nuvora

import android.app.Activity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

class LoginCancelado : Exception("Cancelado")

/** La cuenta de Google con Firebase (proyecto «Nuvora», plan gratuito). */
object Cuenta {
    val actual: FirebaseUser? get() = FirebaseAuth.getInstance().currentUser

    suspend fun entrarConGoogle(activity: Activity): FirebaseUser {
        val cliente = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (cliente.isEmpty()) error("Falta google-services.json del proyecto Nuvora")
        val opcion = GetSignInWithGoogleOption.Builder(cliente).build()
        val peticion = GetCredentialRequest.Builder().addCredentialOption(opcion).build()
        val resultado = try {
            CredentialManager.create(activity).getCredential(activity, peticion)
        } catch (e: GetCredentialCancellationException) {
            throw LoginCancelado()
        } catch (e: NoCredentialException) {
            error("No hay ninguna cuenta de Google en el móvil, o Google no reconoce la app.")
        }
        val c = resultado.credential
        if (c !is CustomCredential || c.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            error("Google devolvió una credencial inesperada")
        }
        val google = GoogleIdTokenCredential.createFrom(c.data)
        val r = FirebaseAuth.getInstance().signInWithCredential(GoogleAuthProvider.getCredential(google.idToken, null)).await()
        return r.user ?: error("Firebase no devolvió la cuenta")
    }

    suspend fun salir(activity: Activity) {
        FirebaseAuth.getInstance().signOut()
        runCatching { CredentialManager.create(activity).clearCredentialState(ClearCredentialStateRequest()) }
    }
}
