package com.guillermorc.nuvora.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseUser
import com.guillermorc.nuvora.MainActivity
import com.guillermorc.nuvora.sync.Carpeta
import com.guillermorc.nuvora.sync.Dispositivos
import com.guillermorc.nuvora.sync.Emparejar
import com.guillermorc.nuvora.sync.Ordenador
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.LaunchedEffect
import android.widget.Toast
import com.guillermorc.nuvora.sync.EstadoDispositivo
import com.guillermorc.nuvora.sync.SincronizacionService
import com.guillermorc.nuvora.sync.Sincronizador
import com.guillermorc.nuvora.sync.formatoTamano
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
private fun Tarjeta(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(16.dp),
    ) { content() }
}

@Composable
fun PantallaDispositivos(usuario: FirebaseUser) {
    val estado by Sincronizador.estado.collectAsState()
    val scope = rememberCoroutineScope()
    var quitar by remember { mutableStateOf<EstadoDispositivo?>(null) }
    var anadirOrdenador by remember { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Tus dispositivos", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(
                "Todos los que entran con ${usuario.email ?: "tu cuenta"} comparten la carpeta Nuvora.",
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.PhoneAndroid, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${Dispositivos.nombreDeEste()} (este)", fontWeight = FontWeight.SemiBold)
                        Text(
                            when {
                                !estado.disponible -> estado.error ?: "Sincronización no disponible"
                                !estado.activo -> estado.error ?: "Arrancando…"
                                estado.pausada -> "En pausa: solo se sincroniza con wifi"
                                estado.pendientes > 0 -> "Recibiendo ${estado.pendientes} archivo${if (estado.pendientes > 1) "s" else ""}…"
                                else -> "Al día"
                            },
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        estado.error?.takeIf { estado.activo }?.let { msg ->
            item {
                Tarjeta {
                    Text("No se pueden encontrar tus otros dispositivos", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
                    Text(msg, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (estado.activo && estado.otros.isEmpty() && estado.error == null) {
            item {
                Tarjeta {
                    Text("Solo está este dispositivo", fontWeight = FontWeight.SemiBold)
                    Text(
                        "Instala Nuvora en tu otro móvil o tablet y entra con la misma cuenta de Google (${usuario.email ?: ""}). " +
                            "Con otra cuenta no se sincronizan: cada cuenta tiene su propia carpeta.",
                        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        items(estado.otros, key = { it.dispositivo.id }) { e ->
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (e.dispositivo.plataforma == "mac" || e.dispositivo.plataforma == "pc") Icons.Outlined.Computer else Icons.Outlined.PhoneAndroid,
                        null, tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(e.dispositivo.nombre, fontWeight = FontWeight.SemiBold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(8.dp).clip(CircleShape).background(if (e.conectado) Color(0xFF2BB673) else Color(0xFF9CA3AF)))
                            Spacer(Modifier.size(6.dp))
                            Text(
                                if (e.conectado) (if (e.completado >= 100) "Conectado · al día" else "Conectado · ${e.completado} %")
                                else "Sin conexión" + (if (e.dispositivo.visto > 0) " · visto ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(e.dispositivo.visto))}" else ""),
                                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    TextButton(onClick = { quitar = e }) { Text("Quitar") }
                }
                if (e.conectado && e.completado < 100) {
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(progress = { e.completado / 100f }, modifier = Modifier.fillMaxWidth())
                }
            }
        }
        item {
            OutlinedButton(onClick = { anadirOrdenador = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Computer, null)
                Spacer(Modifier.size(8.dp))
                Text("Añadir mi Mac u ordenador")
            }
        }
        item {
            Tarjeta {
                Row {
                    Icon(Icons.Outlined.Info, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.size(12.dp))
                    Text(
                        if (estado.otros.isEmpty()) "Para añadir otro móvil o tablet, instala Nuvora y entra con la misma cuenta de Google: se emparejan solos.\n\nLos archivos viajan directamente de un dispositivo a otro (en la misma wifi o por internet), sin pasar por ninguna nube. Para que se pasen, los dos tienen que estar encendidos con Nuvora."
                        else "Los archivos viajan directamente entre tus dispositivos cuando están encendidos con Nuvora, en la misma wifi o por internet. Para añadir otro, entra con la misma cuenta de Google.",
                        fontSize = 13.sp,
                    )
                }
            }
        }
    }
    if (anadirOrdenador) DialogoOrdenador(usuario, estado.miId) { anadirOrdenador = false }
    quitar?.let { e ->
        AlertDialog(
            onDismissRequest = { quitar = null },
            title = { Text("¿Quitar «${e.dispositivo.nombre}»?") },
            text = { Text("Dejará de sincronizarse con tus dispositivos. Si vuelve a abrir Nuvora con tu cuenta, aparecerá otra vez.") },
            confirmButton = {
                TextButton(onClick = { quitar = null; scope.launch { Dispositivos.quitar(usuario.uid, e.dispositivo.id) } }) { Text("Quitar") }
            },
            dismissButton = { TextButton(onClick = { quitar = null }) { Text("Cancelar") } },
        )
    }
}

@Composable
fun PantallaAjustes(usuario: FirebaseUser, onSalir: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("ajustes", Context.MODE_PRIVATE) }
    var soloWifi by remember { mutableStateOf(prefs.getBoolean("soloWifi", false)) }
    var segundoPlano by remember { mutableStateOf(prefs.getBoolean("segundoPlano", true)) }
    val ocupado = remember { formatoTamano(Carpeta.tamano(Carpeta.raiz(context))) }
    var apariencia by remember { mutableStateOf(false) }
    if (apariencia) DialogoApariencia(onCerrar = { apariencia = false })
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (usuario.photoUrl != null) {
                        AsyncImage(usuario.photoUrl, null, Modifier.size(52.dp).clip(CircleShape), contentScale = ContentScale.Crop)
                    } else {
                        Box(Modifier.size(52.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                            Text((usuario.displayName ?: "?").take(1), color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.size(14.dp))
                    Column {
                        Text(usuario.displayName ?: "Tu cuenta", fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        Text(usuario.email ?: "", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item {
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Palette, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Apariencia", fontWeight = FontWeight.SemiBold)
                        Text(
                            "${TEMAS[Apariencia.tema]?.nombre} · ${MODOS[Apariencia.modo]} · ${LETRAS[Apariencia.letra]?.first}",
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    TextButton(onClick = { apariencia = true }) { Text("Cambiar") }
                }
            }
        }
        item {
            Tarjeta {
                Ajuste("Solo con wifi", "Con datos móviles, la sincronización se pausa", soloWifi) {
                    soloWifi = it; prefs.edit().putBoolean("soloWifi", it).apply()
                }
                Spacer(Modifier.height(8.dp))
                Ajuste("Con la app cerrada", "Seguir sincronizando en segundo plano (aviso fijo)", segundoPlano) {
                    segundoPlano = it; prefs.edit().putBoolean("segundoPlano", it).apply()
                }
            }
        }
        item {
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Storage, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.size(12.dp))
                    Column {
                        Text("En este móvil: $ocupado", fontWeight = FontWeight.SemiBold)
                        Text("Carpeta: Android/data/${context.packageName}/files/Nuvora", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item {
            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Computer, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Mi Nuvora del Mac u ordenador", fontWeight = FontWeight.SemiBold)
                        Text("Abrir el servidor de casa (más espacio, web, enlaces públicos)", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { context.startActivity(Intent(context, MainActivity::class.java)) }) { Text("Abrir") }
                }
            }
        }
        item { Tarjeta { FilaVersion() } }
        item {
            OutlinedButton(onClick = onSalir, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Logout, null)
                Spacer(Modifier.size(8.dp))
                Text("Cerrar sesión")
            }
        }
    }
}

@Composable
private fun Ajuste(titulo: String, detalle: String, valor: Boolean, cambiar: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(titulo, fontWeight = FontWeight.SemiBold)
            Text(detalle, fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = valor, onCheckedChange = cambiar)
    }
}

/** Buscar el Mac u ordenador en la wifi y emparejarlo con el código que enseña. */
@Composable
private fun DialogoOrdenador(usuario: FirebaseUser, miId: String?, onCerrar: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var buscando by remember { mutableStateOf(true) }
    var encontrados by remember { mutableStateOf<List<Ordenador>>(emptyList()) }
    var elegido by remember { mutableStateOf<Ordenador?>(null) }
    var codigo by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var vuelta by remember { mutableStateOf(0) }
    LaunchedEffect(vuelta) {
        buscando = true
        encontrados = runCatching { Emparejar.buscar() }.getOrDefault(emptyList())
        if (encontrados.size == 1 && elegido == null) elegido = encontrados.first()
        buscando = false
    }
    AlertDialog(
        onDismissRequest = onCerrar,
        title = { Text("Añadir mi Mac u ordenador") },
        text = {
            Column {
                val o = elegido
                when {
                    miId == null -> Text("Espera a que arranque la sincronización y vuelve a intentarlo.")
                    o != null -> {
                        Text("Escribe el código que aparece en ${o.nombre}, en Nuvora → Sincronización.")
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = codigo, onValueChange = { codigo = it.filter(Char::isDigit).take(6) },
                            singleLine = true, label = { Text("Código de 6 cifras") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                    }
                    buscando -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(12.dp))
                        Text("Buscando Nuvora en tu wifi…")
                    }
                    encontrados.isEmpty() -> Text(
                        "No encuentro ningún Mac u ordenador con Nuvora en esta wifi.\n\n" +
                            "Abre Nuvora para Mac en el ordenador, con el móvil en la misma wifi, y vuelve a buscar.",
                    )
                    else -> encontrados.forEach { e ->
                        TextButton(onClick = { elegido = e }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Outlined.Computer, null)
                            Spacer(Modifier.size(8.dp))
                            Text(e.nombre, modifier = Modifier.weight(1f))
                        }
                    }
                }
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            val o = elegido
            if (o != null && miId != null) {
                Button(enabled = codigo.length == 6 && !enviando, onClick = {
                    enviando = true
                    error = null
                    scope.launch {
                        try {
                            val (id, nombre) = Emparejar.emparejar(o, codigo, miId, Dispositivos.nombreDeEste())
                            Dispositivos.registrar(usuario.uid, id, nombre, "mac")
                            Toast.makeText(context, "$nombre emparejado: la carpeta Nuvora ya se sincroniza", Toast.LENGTH_LONG).show()
                            onCerrar()
                        } catch (e: Exception) {
                            error = e.message ?: "No se pudo emparejar"
                        } finally {
                            enviando = false
                        }
                    }
                }) { Text(if (enviando) "Emparejando…" else "Emparejar") }
            } else if (!buscando && miId != null) {
                TextButton(onClick = { vuelta++ }) { Text("Buscar otra vez") }
            }
        },
        dismissButton = { TextButton(onClick = onCerrar) { Text("Cancelar") } },
    )
}
