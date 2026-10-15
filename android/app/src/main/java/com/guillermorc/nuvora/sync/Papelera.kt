package com.guillermorc.nuvora.sync

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File

/** Algo borrado que aún se puede recuperar. [ruta]: dónde estaba dentro de Nuvora. */
data class EnPapelera(val archivo: File, val ruta: String, val desdeOtro: Boolean, val fecha: Long)

/**
 * La papelera junta dos sitios:
 *  - Lo que borras en este móvil: se mueve a Android/data/…/files/Papelera (fuera de
 *    la carpeta que se sincroniza, así que en los demás dispositivos desaparece).
 *  - Lo que se borró o cambió en tus otros dispositivos: Syncthing lo guarda en
 *    Nuvora/.stversions (30 días).
 */
object Papelera {
    private const val DIAS = 30L

    private fun local(context: Context) =
        File(context.getExternalFilesDir(null) ?: context.filesDir, "Papelera").apply { mkdirs() }

    private fun versiones(context: Context) = File(Carpeta.raiz(context), ".stversions")

    private fun prefs(context: Context) = context.getSharedPreferences("papelera", Context.MODE_PRIVATE)

    /** Mueve a la papelera un archivo o una carpeta de Nuvora. */
    fun mover(context: Context, f: File): List<EnPapelera> {
        val raiz = Carpeta.raiz(context)
        val ahora = System.currentTimeMillis()
        val p = prefs(context).edit()
        val movidos = mutableListOf<EnPapelera>()
        f.walkBottomUp().forEach { x ->
            if (x.isDirectory) { x.delete(); return@forEach }
            val ruta = x.relativeTo(raiz).path
            val destino = File(local(context), ruta)
            destino.parentFile?.mkdirs()
            if (destino.exists()) destino.delete()
            if (!x.renameTo(destino)) { x.copyTo(destino, overwrite = true); x.delete() }
            p.putLong(ruta, ahora)
            movidos += EnPapelera(destino, ruta, false, ahora)
        }
        p.apply()
        Destacados.quitarDentro(context, f)
        return movidos
    }

    fun listar(context: Context): List<EnPapelera> {
        val pr = prefs(context)
        val propios = local(context).let { base ->
            base.walkTopDown().filter { it.isFile }.map {
                val ruta = it.relativeTo(base).path
                EnPapelera(it, ruta, false, pr.getLong(ruta, it.lastModified()))
            }.toList()
        }
        val otros = versiones(context).let { base ->
            if (!base.isDirectory) emptyList()
            else base.walkTopDown().filter { it.isFile }.map {
                // Syncthing a veces añade «~20261015-143000» al nombre: se quita para saber el original
                val ruta = it.relativeTo(base).path.replace(Regex("~\\d{8}-\\d{6}(?=(\\.[^./]*)?$)"), "")
                EnPapelera(it, ruta, true, it.lastModified())
            }.toList()
        }
        return (propios + otros).sortedByDescending { it.fecha }
    }

    /** Vuelve a ponerlo donde estaba (si hay algo con ese nombre, con otro nombre libre). */
    fun restaurar(context: Context, e: EnPapelera): File {
        val original = File(Carpeta.raiz(context), e.ruta)
        original.parentFile?.mkdirs()
        val destino = Carpeta.nombreLibre(original.parentFile!!, original.name)
        if (!e.archivo.renameTo(destino)) { e.archivo.copyTo(destino, overwrite = true); e.archivo.delete() }
        olvidar(context, e)
        return destino
    }

    fun borrar(context: Context, e: EnPapelera) {
        e.archivo.delete()
        olvidar(context, e)
    }

    fun vaciar(context: Context) {
        local(context).deleteRecursively()
        versiones(context).listFiles()?.forEach { it.deleteRecursively() }
        prefs(context).edit().clear().apply()
    }

    /** Lo borrado aquí hace más de 30 días se elimina para siempre. */
    fun limpiar(context: Context) {
        val limite = System.currentTimeMillis() - DIAS * 24 * 3600 * 1000
        listar(context).filter { !it.desdeOtro && it.fecha < limite }.forEach { borrar(context, it) }
    }

    private fun olvidar(context: Context, e: EnPapelera) {
        if (!e.desdeOtro) prefs(context).edit().remove(e.ruta).apply()
        // Quita las carpetas que se hayan quedado vacías
        val base = if (e.desdeOtro) versiones(context) else local(context)
        var dir = e.archivo.parentFile
        while (dir != null && dir != base && dir.startsWith(base) && (dir.listFiles()?.isEmpty() == true)) {
            dir.delete()
            dir = dir.parentFile
        }
    }
}

/** Los destacados (★) de este móvil, por su ruta dentro de Nuvora. */
object Destacados {
    var rutas by mutableStateOf<Set<String>>(emptySet())
        private set

    private fun prefs(context: Context) = context.getSharedPreferences("destacados", Context.MODE_PRIVATE)

    fun cargar(context: Context) { rutas = prefs(context).getStringSet("rutas", emptySet())!!.toSet() }

    private fun guardar(context: Context, nuevas: Set<String>) {
        rutas = nuevas
        prefs(context).edit().putStringSet("rutas", nuevas).apply()
    }

    fun ruta(context: Context, f: File) = f.relativeTo(Carpeta.raiz(context)).path

    fun es(context: Context, f: File) = ruta(context, f) in rutas

    fun alternar(context: Context, f: File) {
        val r = ruta(context, f)
        guardar(context, if (r in rutas) rutas - r else rutas + r)
    }

    /** Al cambiar de nombre: la estrella va con el archivo (y con lo que haya dentro de la carpeta). */
    fun renombrar(context: Context, de: File, a: File) {
        val viejo = ruta(context, de)
        val nuevo = ruta(context, a)
        guardar(context, rutas.map { if (it == viejo) nuevo else if (it.startsWith("$viejo/")) nuevo + it.removePrefix(viejo) else it }.toSet())
    }

    fun quitarDentro(context: Context, f: File) {
        val r = ruta(context, f)
        guardar(context, rutas.filterNot { it == r || it.startsWith("$r/") }.toSet())
    }

    fun archivos(context: Context): List<File> {
        val raiz = Carpeta.raiz(context)
        return rutas.map { File(raiz, it) }.filter { it.exists() }
            .sortedWith(compareBy<File> { !it.isDirectory }.thenBy { it.name.lowercase() })
    }
}
