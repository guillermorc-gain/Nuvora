package com.guillermorc.nuvora.sync

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

/**
 * La carpeta «Nuvora» del móvil: lo que hay aquí es lo que se sincroniza con
 * tus otros dispositivos. Va en la zona de la app (Android/data/…/files/Nuvora),
 * que no necesita permisos.
 */
object Carpeta {
    const val ID = "nuvora"

    fun raiz(context: Context): File =
        File(context.getExternalFilesDir(null) ?: context.filesDir, "Nuvora").apply { mkdirs() }

    /** Lo que se enseña: sin los archivos internos de Syncthing. */
    fun listar(dir: File): List<File> = (dir.listFiles() ?: emptyArray())
        .filter { !it.name.startsWith(".st") && !it.name.startsWith(".syncthing.") && !it.name.endsWith(".tmp") }
        .sortedWith(compareBy<File> { !it.isDirectory }.thenBy { it.name.lowercase() })

    fun nombreLibre(dir: File, nombre: String): File {
        var f = File(dir, nombre)
        if (!f.exists()) return f
        val base = nombre.substringBeforeLast('.', nombre)
        val ext = if (nombre.contains('.')) "." + nombre.substringAfterLast('.') else ""
        var n = 1
        while (f.exists()) { f = File(dir, "$base ($n)$ext"); n++ }
        return f
    }

    fun nombreDe(context: Context, uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { return it.replace('/', '_') }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "archivo"
    }

    /** Copia archivos elegidos en el móvil (fotos, vídeos, documentos…) a [dir]. */
    fun copiar(context: Context, uris: List<Uri>, dir: File): Int {
        var n = 0
        for (uri in uris) runCatching {
            val destino = nombreLibre(dir, nombreDe(context, uri))
            context.contentResolver.openInputStream(uri)?.use { entrada ->
                destino.outputStream().use { entrada.copyTo(it) }
            }
            n++
        }
        return n
    }

    /** Todo lo de Nuvora (sin las carpetas internas de Syncthing como .stversions). */
    private fun todo(raiz: File): Sequence<File> = raiz.walkTopDown()
        .onEnter { it == raiz || !it.name.startsWith(".") }
        .filter { it != raiz && !it.name.startsWith(".") && !it.name.endsWith(".tmp") }

    /** Los últimos archivos que han cambiado (aquí o en otro dispositivo). */
    fun recientes(raiz: File, cuantos: Int = 60): List<File> =
        todo(raiz).filter { it.isFile }.sortedByDescending { it.lastModified() }.take(cuantos).toList()

    private fun normalizar(s: String) =
        java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

    /** Busca por nombre en todas las carpetas, sin importar tildes ni mayúsculas. */
    fun buscar(raiz: File, texto: String): List<File> {
        val q = normalizar(texto.trim())
        if (q.isEmpty()) return emptyList()
        return todo(raiz).filter { normalizar(it.name).contains(q) }
            .sortedWith(compareBy<File> { !it.isDirectory }.thenBy { it.name.lowercase() }).take(200).toList()
    }

    fun tamano(f: File): Long = if (f.isDirectory) f.walkTopDown().filter { it.isFile }.sumOf { it.length() } else f.length()
}

fun formatoTamano(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val unidades = listOf("KB", "MB", "GB", "TB")
    var v = bytes / 1024.0
    var i = 0
    while (v >= 1024 && i < unidades.lastIndex) { v /= 1024; i++ }
    return (if (v < 10) "%.1f %s" else "%.0f %s").format(v, unidades[i]).replace('.', ',')
}
