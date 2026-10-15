package com.guillermorc.nuvora.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.text.format.DateUtils
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
import com.guillermorc.nuvora.sync.Destacados
import com.guillermorc.nuvora.sync.EnPapelera
import com.guillermorc.nuvora.sync.Papelera
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

private fun hace(fecha: Long): String =
    DateUtils.getRelativeTimeSpanString(fecha, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()

/** Las secciones de la web, en el móvil. «Compartido» necesita el servidor del Mac, así que no está. */
private enum class Seccion(val titulo: String, val icono: ImageVector, val subtitulo: String) {
    UNIDAD("Mi unidad", Icons.Outlined.Folder, "Se sincronizan con todos tus dispositivos"),
    RECIENTES("Recientes", Icons.Outlined.Schedule, "Lo último que ha cambiado, aquí o en otro dispositivo"),
    DESTACADOS("Destacados", Icons.Outlined.StarOutline, "Lo que has marcado con ★ en este móvil"),
    PAPELERA("Papelera", Icons.Outlined.Delete, "Se puede recuperar durante 30 días"),
}

@Composable
fun PantallaArchivos() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val raiz = remember { Carpeta.raiz(context) }
    var seccionN by rememberSaveable { mutableIntStateOf(0) }
    val seccion = Seccion.entries[seccionN]
    var actual by remember { mutableStateOf(raiz) }
    var buscando by rememberSaveable { mutableStateOf(false) }
    var texto by rememberSaveable { mutableStateOf("") }
    var elementos by remember { mutableStateOf<List<File>>(emptyList()) }
    val cambios by Sincronizador.cambios.collectAsState()
    var refresco by remember { mutableIntStateOf(0) }
    var menuNuevo by remember { mutableStateOf(false) }
    var dialogoCarpeta by remember { mutableStateOf(false) }
    var renombrar by remember { mutableStateOf<File?>(null) }
    val avisos = remember { SnackbarHostState() }
    val cargador = remember {
        ImageLoader.Builder(context).components { add(VideoFrameDecoder.Factory()) }.crossfade(true).build()
    }
    val destacados = Destacados.rutas

    suspend fun cargar(): List<File> = withContext(Dispatchers.IO) {
        when {
            buscando -> Carpeta.buscar(raiz, texto)
            seccion == Seccion.UNIDAD -> Carpeta.listar(actual)
            seccion == Seccion.RECIENTES -> Carpeta.recientes(raiz)
            seccion == Seccion.DESTACADOS -> Destacados.archivos(context)
            else -> emptyList()
        }
    }
    // La lista se repinta al cambiar algo (también lo que llega de otros dispositivos)
    LaunchedEffect(seccion, actual, cambios, refresco, buscando, texto, destacados) {
        if (buscando) delay(200)
        elementos = cargar()
    }
    LaunchedEffect(seccion, actual, buscando) {
        while (true) { delay(5000); elementos = cargar() }
    }
    LaunchedEffect(Unit) { withContext(Dispatchers.IO) { Papelera.limpiar(context) } }

    BackHandler(enabled = buscando || seccion != Seccion.UNIDAD || actual != raiz) {
        when {
            buscando -> { buscando = false; texto = "" }
            seccion != Seccion.UNIDAD -> seccionN = 0
            else -> actual = actual.parentFile ?: raiz
        }
    }

    val elegir = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val n = withContext(Dispatchers.IO) { Carpeta.copiar(context, uris, actual) }
            Sincronizador.revisar()
            refresco++
            Toast.makeText(context, if (n == 1) "Archivo añadido" else "$n archivos añadidos", Toast.LENGTH_SHORT).show()
        }
    }

    fun irA(carpeta: File) { buscando = false; texto = ""; seccionN = 0; actual = carpeta }

    fun aPapelera(f: File) {
        scope.launch {
            val movidos = withContext(Dispatchers.IO) { Papelera.mover(context, f) }
            Sincronizador.revisar()
            refresco++
            val r = avisos.showSnackbar("«${f.name}» se ha movido a la papelera", actionLabel = "Deshacer", withDismissAction = true)
            if (r == SnackbarResult.ActionPerformed) {
                withContext(Dispatchers.IO) { movidos.forEach { Papelera.restaurar(context, it) } }
                Sincronizador.revisar()
                refresco++
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            if (buscando) {
                BarraBusqueda(texto, onTexto = { texto = it }, onCerrar = { buscando = false; texto = "" })
            } else {
                Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val dentro = seccion == Seccion.UNIDAD && actual != raiz
                    if (dentro) {
                        IconButton(onClick = { actual = actual.parentFile ?: raiz }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Atrás") }
                    } else Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (dentro) actual.name else seccion.titulo, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            if (dentro) actual.relativeTo(raiz).path else seccion.subtitulo,
                            fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = { buscando = true }) { Icon(Icons.Outlined.Search, "Buscar en Nuvora") }
                    if (seccion != Seccion.PAPELERA) {
                        IconButton(onClick = { Apariencia.vistaLista = !Apariencia.vistaLista; Apariencia.guardar() }) {
                            if (Apariencia.vistaLista) Icon(Icons.Outlined.GridView, "Cuadrícula")
                            else Icon(Icons.AutoMirrored.Outlined.List, "Lista")
                        }
                    }
                }
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(Seccion.entries) { s ->
                        FilterChip(
                            selected = s == seccion,
                            onClick = { seccionN = s.ordinal; if (s == Seccion.UNIDAD && seccion == Seccion.UNIDAD) actual = raiz },
                            label = { Text(s.titulo) },
                            leadingIcon = { Icon(s.icono, null, Modifier.size(FilterChipDefaults.IconSize)) },
                        )
                    }
                }
            }

            if (seccion == Seccion.PAPELERA && !buscando) {
                VistaPapelera(refresco, cambios, onCambio = { scope.launch { Sincronizador.revisar() }; refresco++ })
            } else if (elementos.isEmpty()) {
                Vacio(
                    when {
                        buscando && texto.isBlank() -> Triple(Icons.Outlined.Search, "Busca en todo Nuvora", "Escribe parte del nombre de un archivo o carpeta.")
                        buscando -> Triple(Icons.Outlined.SearchOff, "Sin resultados", "No hay nada que se llame «$texto».")
                        seccion == Seccion.RECIENTES -> Triple(Icons.Outlined.Schedule, "Nada reciente", "Aquí verás lo último que añadas o cambies.")
                        seccion == Seccion.DESTACADOS -> Triple(Icons.Outlined.StarOutline, "Sin destacados",
                            "Mantén pulsado un archivo o carpeta y toca «Destacar» para tenerlo siempre a mano.")
                        actual == raiz -> Triple(Icons.Outlined.UploadFile, "Tu Nuvora está vacío",
                            "Toca «Nuevo» para añadir fotos, vídeos o documentos. También puedes usar «Compartir → Nuvora» desde cualquier app.")
                        else -> Triple(Icons.Outlined.FolderOpen, "Carpeta vacía", "Toca «Nuevo» para añadir algo aquí.")
                    },
                )
            } else {
                val conRuta = buscando || seccion != Seccion.UNIDAD
                LazyVerticalGrid(
                    columns = if (Apariencia.vistaLista) GridCells.Fixed(1) else GridCells.Adaptive(150.dp),
                    contentPadding = PaddingValues(12.dp, 6.dp, 12.dp, 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(if (Apariencia.vistaLista) 2.dp else 10.dp),
                ) {
                    if (buscando) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                if (elementos.size == 1) "1 resultado" else "${elementos.size} resultados",
                                fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
                            )
                        }
                    }
                    items(elementos, key = { it.path }) { f ->
                        Elemento(
                            f = f, raiz = raiz, lista = Apariencia.vistaLista, conRuta = conRuta, cargador = cargador,
                            destacado = Destacados.ruta(context, f) in destacados,
                            onAbrir = { if (f.isDirectory) irA(f) else abrir(context, f) },
                            onUbicacion = if (conRuta) ({ irA(f.parentFile ?: raiz) }) else null,
                            onDestacar = { Destacados.alternar(context, f) },
                            onRenombrar = { renombrar = f },
                            onBorrar = { aPapelera(f) },
                        )
                    }
                }
            }
        }

        if (seccion == Seccion.UNIDAD && !buscando) {
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
        SnackbarHost(avisos, Modifier.align(Alignment.BottomCenter).padding(bottom = 80.dp))
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
                else if (f.renameTo(destino)) Destacados.renombrar(context, f, destino)
            }
            scope.launch { Sincronizador.revisar() }
            refresco++
        }
    }
}

@Composable
private fun BarraBusqueda(texto: String, onTexto: (String) -> Unit, onCerrar: () -> Unit) {
    val foco = remember { FocusRequester() }
    LaunchedEffect(Unit) { foco.requestFocus() }
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onCerrar) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Cerrar búsqueda") }
        OutlinedTextField(
            value = texto, onValueChange = onTexto, singleLine = true,
            placeholder = { Text("Buscar en Nuvora") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            trailingIcon = { if (texto.isNotEmpty()) IconButton(onClick = { onTexto("") }) { Icon(Icons.Outlined.Close, "Borrar") } },
            shape = RoundedCornerShape(28.dp),
            modifier = Modifier.weight(1f).focusRequester(foco),
        )
    }
}

@Composable
private fun Vacio(contenido: Triple<ImageVector, String, String>) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(contenido.first, null, Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(12.dp))
        Text(contenido.second, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(contenido.third, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Miniatura(f: File, tipo: Tipo, cargador: ImageLoader, modifier: Modifier, tamanoIcono: Int) {
    Box(modifier, contentAlignment = Alignment.Center) {
        if (tipo == Tipo.IMAGEN || tipo == Tipo.VIDEO) {
            AsyncImage(model = f, contentDescription = f.name, imageLoader = cargador, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            if (tipo == Tipo.VIDEO) Icon(Icons.Outlined.PlayCircle, null, Modifier.size((tamanoIcono * 0.75f).dp), tint = Color.White)
        } else {
            val (icono, color) = iconoDe(tipo)
            Icon(icono, null, Modifier.size(tamanoIcono.dp), tint = color)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Elemento(
    f: File, raiz: File, lista: Boolean, conRuta: Boolean, cargador: ImageLoader, destacado: Boolean,
    onAbrir: () -> Unit, onUbicacion: (() -> Unit)?, onDestacar: () -> Unit, onRenombrar: () -> Unit, onBorrar: () -> Unit,
) {
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val tipo = tipoDe(f)
    val detalle = buildString {
        append(if (f.isDirectory) "${Carpeta.listar(f).size} elementos" else formatoTamano(f.length()))
        if (lista && !f.isDirectory) append(" · ").append(hace(f.lastModified()))
        if (conRuta) append(" · ").append(f.parentFile?.takeIf { it != raiz }?.relativeTo(raiz)?.path ?: "Mi unidad")
    }
    val nombre: @Composable () -> Unit = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (destacado) {
                Icon(Icons.Filled.Star, "Destacado", Modifier.size(15.dp), tint = Color(0xFFF5B400))
                Spacer(Modifier.size(4.dp))
            }
            Text(f.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    Box {
        if (lista) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .combinedClickable(onClick = onAbrir, onLongClick = { menu = true })
                    .padding(horizontal = 6.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Miniatura(f, tipo, cargador, Modifier.size(46.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant), 26)
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    nombre()
                    Text(detalle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "Más opciones") }
            }
        } else {
            Column(
                Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .combinedClickable(onClick = onAbrir, onLongClick = { menu = true }),
            ) {
                Miniatura(
                    f, tipo, cargador,
                    Modifier.fillMaxWidth().aspectRatio(if (f.isDirectory) 2.2f else 1.25f),
                    if (f.isDirectory) 40 else 52,
                )
                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    nombre()
                    Text(detalle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            if (!f.isDirectory) DropdownMenuItem(
                text = { Text("Compartir") }, leadingIcon = { Icon(Icons.Outlined.Share, null) },
                onClick = { menu = false; compartir(context, f) },
            )
            DropdownMenuItem(
                text = { Text(if (destacado) "Quitar de destacados" else "Destacar") },
                leadingIcon = { Icon(if (destacado) Icons.Filled.Star else Icons.Outlined.StarOutline, null) },
                onClick = { menu = false; onDestacar() },
            )
            if (onUbicacion != null) DropdownMenuItem(
                text = { Text("Ver en su carpeta") }, leadingIcon = { Icon(Icons.Outlined.FolderOpen, null) },
                onClick = { menu = false; onUbicacion() },
            )
            DropdownMenuItem(
                text = { Text("Cambiar nombre") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) },
                onClick = { menu = false; onRenombrar() },
            )
            DropdownMenuItem(
                text = { Text("Mover a la papelera") }, leadingIcon = { Icon(Icons.Outlined.Delete, null) },
                onClick = { menu = false; onBorrar() },
            )
        }
    }
}

/** La papelera: lo borrado en este móvil y lo borrado o sustituido en tus otros dispositivos. */
@Composable
private fun VistaPapelera(refresco: Int, cambios: Any?, onCambio: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var lista by remember { mutableStateOf<List<EnPapelera>>(emptyList()) }
    var propio by remember { mutableIntStateOf(0) }
    var vaciar by remember { mutableStateOf(false) }
    LaunchedEffect(refresco, cambios, propio) { lista = withContext(Dispatchers.IO) { Papelera.listar(context) } }

    fun hecho() { propio++; onCambio() }

    if (lista.isEmpty()) {
        return Vacio(Triple(Icons.Outlined.Delete, "La papelera está vacía", "Lo que borres aquí o en tus otros dispositivos se podrá recuperar durante 30 días."))
    }
    LazyColumn(contentPadding = PaddingValues(12.dp, 4.dp, 12.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (lista.size == 1) "1 elemento" else "${lista.size} elementos",
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = { vaciar = true }) { Text("Vaciar papelera") }
            }
        }
        items(lista, key = { it.archivo.path }) { e ->
            var menu by remember { mutableStateOf(false) }
            val tipo = tipoDe(e.archivo)
            val (icono, color) = iconoDe(tipo)
            Box {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).padding(horizontal = 6.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(46.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center,
                    ) { Icon(icono, null, Modifier.size(26.dp), tint = color) }
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(File(e.ruta).name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val donde = File(e.ruta).parent ?: "Mi unidad"
                        Text(
                            "${formatoTamano(e.archivo.length())} · $donde · " +
                                (if (e.desdeOtro) "de otro dispositivo, " else "") + hace(e.fecha),
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = {
                        scope.launch {
                            val f = withContext(Dispatchers.IO) { Papelera.restaurar(context, e) }
                            Toast.makeText(context, "«${f.name}» restaurado", Toast.LENGTH_SHORT).show()
                            hecho()
                        }
                    }) { Icon(Icons.Outlined.Restore, "Restaurar") }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "Más opciones") }
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Eliminar para siempre") }, leadingIcon = { Icon(Icons.Outlined.DeleteForever, null) },
                        onClick = {
                            menu = false
                            scope.launch { withContext(Dispatchers.IO) { Papelera.borrar(context, e) }; hecho() }
                        },
                    )
                }
            }
        }
    }
    if (vaciar) {
        AlertDialog(
            onDismissRequest = { vaciar = false },
            title = { Text("¿Vaciar la papelera?") },
            text = { Text("Se eliminan para siempre ${lista.size} elementos de este móvil. No se puede deshacer.") },
            confirmButton = {
                TextButton(onClick = {
                    vaciar = false
                    scope.launch { withContext(Dispatchers.IO) { Papelera.vaciar(context) }; hecho() }
                }) { Text("Vaciar", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { vaciar = false }) { Text("Cancelar") } },
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
