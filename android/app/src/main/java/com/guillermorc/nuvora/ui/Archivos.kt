package com.guillermorc.nuvora.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.VideoFrameDecoder
import com.guillermorc.nuvora.sync.Carpeta
import com.guillermorc.nuvora.sync.Sincronizador
import com.guillermorc.nuvora.sync.formatoTamano
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private enum class Tipo { CARPETA, IMAGEN, VIDEO, AUDIO, PDF, OTRO }

private fun tipoDe(f: File): Tipo {
    if (f.isDirectory) return Tipo.CARPETA
    val mime = mimeDe(f)
    return when {
        mime.startsWith("image/") -> Tipo.IMAGEN
        mime.startsWith("video/") -> Tipo.VIDEO
        mime.startsWith("audio/") -> Tipo.AUDIO
        mime == "application/pdf" -> Tipo.PDF
        else -> Tipo.OTRO
    }
}

private fun mimeDe(f: File): String =
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase()) ?: "application/octet-stream"

private fun iconoDe(t: Tipo): Pair<ImageVector, Color> = when (t) {
    Tipo.CARPETA -> Icons.Outlined.Folder to Color(0xFF5E8FE0)
    Tipo.IMAGEN -> Icons.Outlined.Image to Color(0xFFE8505B)
    Tipo.VIDEO -> Icons.Outlined.Movie to Color(0xFFE84393)
    Tipo.AUDIO -> Icons.Outlined.AudioFile to Color(0xFFF59E0B)
    Tipo.PDF -> Icons.Outlined.PictureAsPdf to Color(0xFFDC2626)
    Tipo.OTRO -> Icons.AutoMirrored.Outlined.InsertDriveFile to Color(0xFF64748B)
}

private fun uriDe(context: Context, f: File) = FileProvider.getUriForFile(context, "${context.packageName}.archivos", f)

private fun abrir(context: Context, f: File) {
    val i = Intent(Intent.ACTION_VIEW).setDataAndType(uriDe(context, f), mimeDe(f)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try { context.startActivity(i) } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, "No hay ninguna app para abrir este archivo", Toast.LENGTH_SHORT).show()
    }
}

private fun compartir(context: Context, f: File) {
    val i = Intent(Intent.ACTION_SEND).setType(mimeDe(f)).putExtra(Intent.EXTRA_STREAM, uriDe(context, f))
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(i, "Compartir «${f.name}»"))
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PantallaArchivos() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val raiz = remember { Carpeta.raiz(context) }
    var actual by remember { mutableStateOf(raiz) }
    var elementos by remember { mutableStateOf<List<File>>(emptyList()) }
    val cambios by Sincronizador.cambios.collectAsState()
    var refresco by remember { mutableStateOf(0) }
    var menuNuevo by remember { mutableStateOf(false) }
    var dialogoCarpeta by remember { mutableStateOf(false) }
    var renombrar by remember { mutableStateOf<File?>(null) }
    var borrar by remember { mutableStateOf<File?>(null) }
    val cargador = remember {
        ImageLoader.Builder(context).components { add(VideoFrameDecoder.Factory()) }.crossfade(true).build()
    }

    // La lista se repinta al cambiar algo (también lo que llega de otros dispositivos)
    LaunchedEffect(actual, cambios, refresco) {
        elementos = withContext(Dispatchers.IO) { Carpeta.listar(actual) }
    }
    LaunchedEffect(actual) {
        while (true) { delay(5000); elementos = withContext(Dispatchers.IO) { Carpeta.listar(actual) } }
    }
    BackHandler(enabled = actual != raiz) { actual = actual.parentFile ?: raiz }

    val elegir = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val n = withContext(Dispatchers.IO) { Carpeta.copiar(context, uris, actual) }
            Sincronizador.revisar()
            refresco++
            Toast.makeText(context, if (n == 1) "Archivo añadido" else "$n archivos añadidos", Toast.LENGTH_SHORT).show()
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Ruta actual
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (actual != raiz) {
                    IconButton(onClick = { actual = actual.parentFile ?: raiz }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Atrás") }
                } else Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (actual == raiz) "Mis archivos" else actual.name, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (actual == raiz) "Se sincronizan con todos tus dispositivos" else actual.relativeTo(raiz).path,
                        fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (elementos.isEmpty()) {
                Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Icon(Icons.Outlined.UploadFile, null, Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(12.dp))
                    Text(if (actual == raiz) "Tu Nuvora está vacío" else "Carpeta vacía", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text(
                        "Toca «Nuevo» para añadir fotos, vídeos o documentos. También puedes usar «Compartir → Nuvora» desde cualquier app.",
                        textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(150.dp),
                    contentPadding = PaddingValues(12.dp, 12.dp, 12.dp, 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(elementos, key = { it.path }) { f ->
                        var menu by remember { mutableStateOf(false) }
                        val tipo = tipoDe(f)
                        Box {
                            Column(
                                Modifier
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .combinedClickable(
                                        onClick = { if (f.isDirectory) actual = f else abrir(context, f) },
                                        onLongClick = { menu = true },
                                    ),
                            ) {
                                if (tipo == Tipo.IMAGEN || tipo == Tipo.VIDEO) {
                                    Box(Modifier.fillMaxWidth().aspectRatio(1.25f), contentAlignment = Alignment.Center) {
                                        AsyncImage(
                                            model = f, contentDescription = f.name, imageLoader = cargador,
                                            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                                        )
                                        if (tipo == Tipo.VIDEO) Icon(Icons.Outlined.PlayCircle, null, Modifier.size(40.dp), tint = Color.White)
                                    }
                                } else {
                                    val (icono, color) = iconoDe(tipo)
                                    Box(Modifier.fillMaxWidth().aspectRatio(if (f.isDirectory) 2.2f else 1.25f), contentAlignment = Alignment.Center) {
                                        Icon(icono, null, Modifier.size(if (f.isDirectory) 40.dp else 52.dp), tint = color)
                                    }
                                }
                                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                    Text(f.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        if (f.isDirectory) "${Carpeta.listar(f).size} elementos" else formatoTamano(f.length()),
                                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                if (!f.isDirectory) DropdownMenuItem(
                                    text = { Text("Compartir") }, leadingIcon = { Icon(Icons.Outlined.Share, null) },
                                    onClick = { menu = false; compartir(context, f) },
                                )
                                DropdownMenuItem(
                                    text = { Text("Cambiar nombre") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) },
                                    onClick = { menu = false; renombrar = f },
                                )
                                DropdownMenuItem(
                                    text = { Text("Eliminar") }, leadingIcon = { Icon(Icons.Outlined.Delete, null) },
                                    onClick = { menu = false; borrar = f },
                                )
                            }
                        }
                    }
                }
            }
        }

        Box(Modifier.align(Alignment.BottomEnd).padding(16.dp)) {
            ExtendedFloatingActionButton(
                onClick = { menuNuevo = true },
                icon = { Icon(Icons.Outlined.Add, null) },
                text = { Text("Nuevo") },
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            DropdownMenu(expanded = menuNuevo, onDismissRequest = { menuNuevo = false }) {
                DropdownMenuItem(
                    text = { Text("Subir archivos") }, leadingIcon = { Icon(Icons.Outlined.UploadFile, null) },
                    onClick = { menuNuevo = false; elegir.launch(arrayOf("*/*")) },
                )
                DropdownMenuItem(
                    text = { Text("Nueva carpeta") }, leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, null) },
                    onClick = { menuNuevo = false; dialogoCarpeta = true },
                )
            }
        }
    }

    if (dialogoCarpeta) {
        DialogoNombre("Nueva carpeta", "Carpeta sin título", "Crear", onCerrar = { dialogoCarpeta = false }) { nombre ->
            Carpeta.nombreLibre(actual, nombre).mkdirs()
            scope.launch { Sincronizador.revisar() }
            refresco++
        }
    }
    renombrar?.let { f ->
        DialogoNombre("Cambiar nombre", f.name, "Aceptar", onCerrar = { renombrar = null }) { nombre ->
            if (nombre != f.name) {
                val destino = File(f.parentFile, nombre)
                if (destino.exists()) Toast.makeText(context, "Ya hay algo con ese nombre", Toast.LENGTH_SHORT).show()
                else f.renameTo(destino)
            }
            scope.launch { Sincronizador.revisar() }
            refresco++
        }
    }
    borrar?.let { f ->
        AlertDialog(
            onDismissRequest = { borrar = null },
            title = { Text("¿Eliminar «${f.name}»?") },
            text = { Text("Se borra en todos tus dispositivos. En los demás queda 30 días en la papelera de la sincronización.") },
            confirmButton = {
                TextButton(onClick = {
                    borrar = null
                    scope.launch {
                        withContext(Dispatchers.IO) { f.deleteRecursively() }
                        Sincronizador.revisar()
                        refresco++
                    }
                }) { Text("Eliminar", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { borrar = null }) { Text("Cancelar") } },
        )
    }
}

@Composable
private fun DialogoNombre(titulo: String, inicial: String, accion: String, onCerrar: () -> Unit, onAceptar: (String) -> Unit) {
    var texto by remember { mutableStateOf(inicial) }
    AlertDialog(
        onDismissRequest = onCerrar,
        title = { Text(titulo) },
        text = { OutlinedTextField(value = texto, onValueChange = { texto = it.replace('/', '_') }, singleLine = true) },
        confirmButton = {
            TextButton(enabled = texto.isNotBlank(), onClick = { onAceptar(texto.trim()); onCerrar() }) { Text(accion) }
        },
        dismissButton = { TextButton(onClick = onCerrar) { Text("Cancelar") } },
    )
}
