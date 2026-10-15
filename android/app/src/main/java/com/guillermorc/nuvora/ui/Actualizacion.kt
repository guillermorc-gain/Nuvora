package com.guillermorc.nuvora.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.guillermorc.nuvora.Actualizador
import com.guillermorc.nuvora.BuildConfig
import com.guillermorc.nuvora.EstadoActualizacion
import com.guillermorc.nuvora.Version
import com.guillermorc.nuvora.sync.formatoTamano
import kotlinx.coroutines.launch

/** El aviso «Hay una versión nueva»: se descarga e instala sin salir de Nuvora. */
@Composable
fun DialogoActualizacion() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val estado by Actualizador.estado.collectAsState()
    var esperandoPermiso by remember { mutableStateOf<Version?>(null) }

    // Al volver de «Instalar apps desconocidas», si lo has permitido, sigue solo
    val permiso = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val v = esperandoPermiso ?: return@rememberLauncherForActivityResult
        esperandoPermiso = null
        if (Actualizador.puedeInstalar(context)) scope.launch { Actualizador.actualizar(context, v) }
    }
    fun empezar(v: Version) {
        if (Actualizador.puedeInstalar(context)) scope.launch { Actualizador.actualizar(context, v) }
        else { esperandoPermiso = v; permiso.launch(Actualizador.intentPermiso(context)) }
    }

    val v = when (val e = estado) {
        is EstadoActualizacion.Disponible -> e.version
        is EstadoActualizacion.Descargando -> e.version
        is EstadoActualizacion.Instalando -> e.version
        is EstadoActualizacion.Error -> e.version
        else -> null
    } ?: return
    val ocupado = estado is EstadoActualizacion.Descargando || estado is EstadoActualizacion.Instalando

    AlertDialog(
        onDismissRequest = { if (!ocupado) Actualizador.descartar() },
        icon = { Icon(Icons.Outlined.SystemUpdate, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text("Nuvora ${v.nombre}") },
        text = {
            Column {
                when (val e = estado) {
                    is EstadoActualizacion.Descargando -> {
                        Text("Descargando… ${(e.progreso * 100).toInt()} %")
                        Spacer(Modifier.height(10.dp))
                        LinearProgressIndicator(progress = { e.progreso }, modifier = Modifier.fillMaxWidth())
                    }
                    is EstadoActualizacion.Instalando -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(12.dp))
                        Text("Instalando… Nuvora se cerrará un momento y quedará actualizada.")
                    }
                    is EstadoActualizacion.Error -> Text(e.mensaje, color = MaterialTheme.colorScheme.error)
                    else -> {
                        Text(
                            "Hay una versión nueva (tienes la ${BuildConfig.VERSION_NAME})." +
                                if (v.tamano > 0) " Ocupa ${formatoTamano(v.tamano)}." else "",
                        )
                        if (v.notas.isNotBlank()) {
                            Spacer(Modifier.height(10.dp))
                            Text("Novedades", fontWeight = FontWeight.SemiBold)
                            Text(v.notas, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 8)
                        }
                        if (!Actualizador.puedeInstalar(context)) {
                            Spacer(Modifier.height(10.dp))
                            Text(
                                "La primera vez, Android te pedirá permitir que Nuvora instale actualizaciones. Actívalo y vuelve atrás.",
                                fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (!ocupado) {
                Button(onClick = { empezar(v) }) {
                    Text(if (estado is EstadoActualizacion.Error) "Reintentar" else "Actualizar")
                }
            }
        },
        dismissButton = {
            if (!ocupado) TextButton(onClick = { Actualizador.descartar() }) { Text("Más tarde") }
        },
    )
}

/** En Ajustes: la versión instalada y «Buscar actualizaciones». */
@Composable
fun FilaVersion() {
    val scope = rememberCoroutineScope()
    val estado by Actualizador.estado.collectAsState()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.SystemUpdate, null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Versión ${BuildConfig.VERSION_NAME}", fontWeight = FontWeight.SemiBold)
            Text(
                when (val e = estado) {
                    EstadoActualizacion.Buscando -> "Buscando…"
                    EstadoActualizacion.AlDia -> "Tienes la última versión"
                    is EstadoActualizacion.Disponible -> "Hay una versión nueva: ${e.version.nombre}"
                    is EstadoActualizacion.Descargando -> "Descargando ${e.version.nombre}…"
                    is EstadoActualizacion.Instalando -> "Instalando ${e.version.nombre}…"
                    is EstadoActualizacion.Error -> e.mensaje
                    EstadoActualizacion.Nada -> "Se actualiza desde aquí, sin salir de la app"
                },
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(
            enabled = estado != EstadoActualizacion.Buscando,
            onClick = { scope.launch { Actualizador.buscar() } },
        ) { Text("Buscar") }
    }
}
