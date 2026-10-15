package com.guillermorc.nuvora.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.google.firebase.auth.FirebaseUser
import com.guillermorc.nuvora.Actualizador
import com.guillermorc.nuvora.Cuenta
import com.guillermorc.nuvora.LoginCancelado
import com.guillermorc.nuvora.MainActivity
import com.guillermorc.nuvora.R
import com.guillermorc.nuvora.sync.Carpeta
import com.guillermorc.nuvora.sync.SincronizacionService
import com.guillermorc.nuvora.sync.Sincronizador
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Nuvora en el móvil: entras con Google y la carpeta Nuvora se sincroniza
 * directamente con tus otros dispositivos (Syncthing, como Memories), sin
 * ordenador ni nube de pago.
 */
class AppActivity : ComponentActivity() {
    private var usuario by mutableStateOf(Cuenta.actual)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NuvoraTema {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val u = usuario
                    if (u == null) PantallaEntrar(onDentro = { usuario = it })
                    else PantallaPrincipal(u, onSalir = {
                        lifecycleScope.launch {
                            SincronizacionService.parar(this@AppActivity)
                            Cuenta.salir(this@AppActivity)
                            usuario = null
                        }
                    })
                }
            }
        }
        recibirCompartido(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        recibirCompartido(intent)
    }

    /** «Compartir → Nuvora» desde otra app: los archivos van a la carpeta Nuvora. */
    private fun recibirCompartido(intent: Intent?) {
        if (intent == null || Cuenta.actual == null) return
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM),
            )
            Intent.ACTION_SEND_MULTIPLE ->
                (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)).orEmpty()
            else -> emptyList()
        }
        if (uris.isEmpty()) return
        intent.action = null
        lifecycleScope.launch {
            val n = withContext(Dispatchers.IO) { Carpeta.copiar(this@AppActivity, uris, Carpeta.raiz(this@AppActivity)) }
            Sincronizador.revisar()
            Toast.makeText(this@AppActivity, if (n == 1) "Guardado en Nuvora" else "$n archivos guardados en Nuvora", Toast.LENGTH_SHORT).show()
        }
    }
}

@Composable
private fun PantallaEntrar(onDentro: (FirebaseUser) -> Unit) {
    val context = LocalContext.current
    val activity = context as ComponentActivity
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var entrando by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            // El icono «Nube N»: su degradado y la nube encima
            Box(
                Modifier.size(104.dp).shadow(10.dp, RoundedCornerShape(26.dp)).clip(RoundedCornerShape(26.dp)).background(DegradadoLogo),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(R.drawable.ic_launcher_foreground), null, Modifier.size(160.dp), tint = Color.Unspecified)
            }
            Spacer(Modifier.height(18.dp))
            Logotipo(46.sp)
            Spacer(Modifier.height(8.dp))
            Text(
                "Tus archivos, fotos y vídeos en todos tus dispositivos. Viajan directamente de uno a otro, sin ordenador y sin pagar nube.",
                textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(28.dp))
            Button(
                onClick = {
                    error = null
                    entrando = true
                    scope.launch {
                        try {
                            onDentro(Cuenta.entrarConGoogle(activity))
                        } catch (_: LoginCancelado) {
                        } catch (e: Exception) {
                            error = e.message ?: "No se pudo entrar con Google"
                        } finally {
                            entrando = false
                        }
                    }
                },
                enabled = !entrando,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF1F1F1F)),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFDADCE0)),
            ) {
                Icon(painterResource(R.drawable.ic_google), null, Modifier.size(20.dp), tint = Color.Unspecified)
                Spacer(Modifier.size(10.dp))
                Text(if (entrando) "Entrando…" else "Continuar con Google", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(18.dp))
            TextButton(onClick = { context.startActivity(Intent(context, MainActivity::class.java)) }) {
                Text("Usar mi Nuvora del Mac u ordenador")
            }
        }
    }
}

private enum class Pestana(val titulo: String) { ARCHIVOS("Archivos"), DISPOSITIVOS("Dispositivos"), AJUSTES("Ajustes") }

@Composable
private fun PantallaPrincipal(usuario: FirebaseUser, onSalir: () -> Unit) {
    val context = LocalContext.current
    var pestana by rememberSaveable { mutableIntStateOf(0) }
    val avisos = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(usuario.uid) {
        if (Build.VERSION.SDK_INT >= 33) avisos.launch(Manifest.permission.POST_NOTIFICATIONS)
        SincronizacionService.arrancar(context)
        // ¿Hay una versión nueva en GitHub? Se avisa y se actualiza sin salir
        Actualizador.buscar(silencioso = true)
    }
    DialogoActualizacion()
    Scaffold(
        topBar = { Cabecera { EstadoCabecera() } },
        bottomBar = {
            NavigationBar {
                Pestana.entries.forEachIndexed { i, p ->
                    NavigationBarItem(
                        selected = pestana == i,
                        onClick = { pestana = i },
                        icon = {
                            Icon(
                                when (p) {
                                    Pestana.ARCHIVOS -> Icons.Outlined.Folder
                                    Pestana.DISPOSITIVOS -> Icons.Outlined.Devices
                                    Pestana.AJUSTES -> Icons.Outlined.Settings
                                }, null,
                            )
                        },
                        label = { Text(p.titulo) },
                    )
                }
            }
        },
    ) { relleno ->
        Box(Modifier.padding(relleno).fillMaxSize()) {
            when (Pestana.entries[pestana]) {
                Pestana.ARCHIVOS -> PantallaArchivos()
                Pestana.DISPOSITIVOS -> PantallaDispositivos(usuario)
                Pestana.AJUSTES -> PantallaAjustes(usuario, onSalir)
            }
        }
    }
}

@Composable
private fun EstadoCabecera() {
    val estado by Sincronizador.estado.collectAsState()
    val conectados = estado.otros.count { it.conectado }
    val texto = when {
        !estado.activo -> "Arrancando…"
        estado.pausada -> "En pausa (sin wifi)"
        estado.estadoCarpeta == "syncing" || estado.pendientes > 0 -> "Sincronizando…"
        conectados > 0 -> "Al día · $conectados conectado${if (conectados > 1) "s" else ""}"
        else -> "Al día"
    }
    Text(texto, color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(end = 12.dp))
}
