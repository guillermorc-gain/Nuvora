package com.guillermorc.nuvora.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.guillermorc.nuvora.R

/** Un tema de colores: los mismos de la web (Ajustes → Apariencia). */
class TemaColor(
    val nombre: String,
    val claro: List<Long>?,
    val oscuro: List<Long>?,
    val muestra: List<Long>,
    val cabecera: List<Long>,
)

// Orden de cada paleta: fondo, superficie, superficie 2, tinte, texto, texto suave, borde, color principal
val TEMAS = linkedMapOf(
    "nuvora" to TemaColor("Nuvora", null, null, listOf(0xFFF6F5FC, 0xFF7C5CFF, 0xFF22D3EE), listOf(0xFF7C5CFF, 0xFF5B7CFF, 0xFF1FB8D8)),
    "medianoche" to TemaColor("Medianoche",
        listOf(0xFFEEF2FB, 0xFFFFFFFF, 0xFFE6ECF8, 0xFFDFE6FB, 0xFF16203D, 0xFF5D6A8F, 0xFFD5DCEF, 0xFF4338CA),
        listOf(0xFF0B1020, 0xFF141C33, 0xFF1A2444, 0xFF1B2D6B, 0xFFDCE6FF, 0xFF8B9AC4, 0xFF26345E, 0xFF22D3EE),
        listOf(0xFF0B1020, 0xFF22D3EE, 0xFF6366F1), listOf(0xFF1E1B4B, 0xFF4338CA, 0xFF0891B2)),
    "amanecer" to TemaColor("Amanecer",
        listOf(0xFFFFF7F0, 0xFFFFFFFF, 0xFFFFF0E6, 0xFFFFE7D8, 0xFF3B2A24, 0xFF9B7D70, 0xFFFFD9C2, 0xFFC2410C),
        listOf(0xFF1F1512, 0xFF2A1D18, 0xFF33231D, 0xFF4A2A1F, 0xFFFFE9DC, 0xFFC09A88, 0xFF4A342A, 0xFFFF9A66),
        listOf(0xFFFFF7F0, 0xFFFF8A4C, 0xFFFF5F7E), listOf(0xFFFF7A45, 0xFFFF4F7B, 0xFFB83280)),
    "bosque" to TemaColor("Bosque",
        listOf(0xFFF1EFE6, 0xFFFBFAF5, 0xFFECE8DA, 0xFFE3ECDC, 0xFF233127, 0xFF6F7A68, 0xFFDCD7C5, 0xFF2F5A3E),
        listOf(0xFF141C16, 0xFF1C261F, 0xFF223027, 0xFF2A3D2F, 0xFFE3EADB, 0xFF9AA892, 0xFF2F3F33, 0xFF8FBF6A),
        listOf(0xFFF1EFE6, 0xFF2F5A3E, 0xFF6B8F47), listOf(0xFF1F3B2A, 0xFF3F6B3A, 0xFF7A9A3F)),
    "oceano" to TemaColor("Océano",
        listOf(0xFFE6F6FA, 0xFFFFFFFF, 0xFFDFF1F7, 0xFFD3EEF6, 0xFF0F3B4C, 0xFF5B7F8F, 0xFFC9E3EC, 0xFF0A6F94),
        listOf(0xFF06222E, 0xFF0B2F3D, 0xFF0F3848, 0xFF10455A, 0xFFD6F3FB, 0xFF7FB0C0, 0xFF15485A, 0xFF3FD0E0),
        listOf(0xFFE0F7FA, 0xFF00A6B8, 0xFF1565C0), listOf(0xFF033E6B, 0xFF0369A1, 0xFF06B6D4)),
    "grafito" to TemaColor("Grafito",
        listOf(0xFFF2F1EE, 0xFFFFFFFF, 0xFFEAE8E3, 0xFFF7EECD, 0xFF26272B, 0xFF6D6B66, 0xFFDEDBD3, 0xFF8A6508),
        listOf(0xFF1A1B1E, 0xFF232428, 0xFF2A2B30, 0xFF3A3320, 0xFFE6E3DC, 0xFF9A978F, 0xFF34353A, 0xFFF4C542),
        listOf(0xFF1A1B1E, 0xFFF4C542, 0xFF34353A), listOf(0xFF141518, 0xFF2E2F35, 0xFF8A6A12)),
    "pastel" to TemaColor("Pastel",
        listOf(0xFFF6F3FF, 0xFFFFFFFF, 0xFFF1EDFF, 0xFFECE6FF, 0xFF3D3654, 0xFF8A83A3, 0xFFE5DEFA, 0xFF6D4FE0),
        listOf(0xFF1E1B2E, 0xFF28243D, 0xFF2F2A48, 0xFF3A3358, 0xFFECE6FF, 0xFFA79FC4, 0xFF3D3660, 0xFFC9B8FF),
        listOf(0xFFF6F3FF, 0xFFC9B8FF, 0xFFA8E6CF), listOf(0xFF7C6CF0, 0xFFB794F6, 0xFFF0A6CA)),
    "retro" to TemaColor("Retro 80",
        listOf(0xFFFFF0FA, 0xFFFFFFFF, 0xFFFBE6F5, 0xFFF3E0FF, 0xFF2B1640, 0xFF7A5C96, 0xFFE9C6F0, 0xFFB00D72),
        listOf(0xFF1B0F33, 0xFF251548, 0xFF2D1A57, 0xFF3A2468, 0xFFF3E9FF, 0xFFB7A3D9, 0xFF784BA0, 0xFFFFD319),
        listOf(0xFF1B0F33, 0xFFFF3CAC, 0xFFFFD319), listOf(0xFF3B0A6B, 0xFFC0157F, 0xFFFF8A00)),
    "mediterraneo" to TemaColor("Mediterráneo",
        listOf(0xFFFBFAF7, 0xFFFFFFFF, 0xFFF4F1EA, 0xFFE8EEF6, 0xFF1D3557, 0xFF6B7A8F, 0xFFE7E2D8, 0xFF1D4E89),
        listOf(0xFF0F1A2B, 0xFF16243A, 0xFF1B2C46, 0xFF1D3557, 0xFFE8EEF6, 0xFF93A4BD, 0xFF26395A, 0xFF7FB2F0),
        listOf(0xFFFBFAF7, 0xFF1D4E89, 0xFFC8553D), listOf(0xFF1D4E89, 0xFF2F6FB3, 0xFFC8553D)),
)

@OptIn(ExperimentalTextApi::class)
private fun variable(id: Int, vararg pesos: Int) = FontFamily(
    pesos.map { Font(id, FontWeight(it), variationSettings = FontVariation.Settings(FontVariation.weight(it))) },
)

/** Las letras de la web, metidas en la app (funcionan sin internet). */
val LETRAS: LinkedHashMap<String, Pair<String, FontFamily>> by lazy {
    val pesos = intArrayOf(400, 500, 600, 700, 800)
    linkedMapOf(
        "sistema" to ("La del sistema" to FontFamily.Default),
        "clasica" to ("Clásica" to variable(R.font.lora, 400, 500, 600, 700)),
        "elegante" to ("Elegante" to variable(R.font.playfair, *pesos)),
        "moderna" to ("Moderna" to variable(R.font.montserrat, *pesos)),
        "redondeada" to ("Redondeada" to variable(R.font.nunito, *pesos)),
        "suave" to ("Suave" to variable(R.font.quicksand, 400, 500, 600, 700)),
        "geometrica" to ("Geométrica" to variable(R.font.comfortaa, 400, 500, 600, 700)),
        "estrecha" to ("Estrecha" to variable(R.font.roboto_condensed, *pesos)),
        "maquina" to ("Máquina de escribir" to FontFamily(
            Font(R.font.courier_prime, FontWeight.Normal), Font(R.font.courier_prime_bold, FontWeight.Bold),
        )),
        "amano" to ("A mano" to variable(R.font.caveat, 400, 500, 600, 700)),
    )
}

val TAMANOS = linkedMapOf("pequeno" to ("Pequeño" to 0.9f), "normal" to ("Normal" to 1f), "grande" to ("Grande" to 1.12f), "muygrande" to ("Muy grande" to 1.25f))
val MODOS = linkedMapOf("sistema" to "Como el sistema", "claro" to "Claro", "oscuro" to "Oscuro")

/** Lo que eliges en Ajustes → Apariencia. Se guarda en el móvil. */
object Apariencia {
    var tema by mutableStateOf("nuvora")
    var modo by mutableStateOf("sistema")
    var letra by mutableStateOf("sistema")
    var tamano by mutableStateOf("normal")
    var vistaLista by mutableStateOf(false)
    private var prefs: android.content.SharedPreferences? = null

    fun cargar(context: Context) {
        val p = context.getSharedPreferences("apariencia", Context.MODE_PRIVATE)
        prefs = p
        tema = p.getString("tema", "nuvora")!!.takeIf { it in TEMAS } ?: "nuvora"
        modo = p.getString("modo", "sistema")!!
        letra = p.getString("letra", "sistema")!!
        tamano = p.getString("tamano", "normal")!!
        vistaLista = p.getBoolean("lista", false)
    }

    fun guardar() {
        prefs?.edit()?.putString("tema", tema)?.putString("modo", modo)?.putString("letra", letra)
            ?.putString("tamano", tamano)?.putBoolean("lista", vistaLista)?.apply()
    }

    fun restablecer() { tema = "nuvora"; modo = "sistema"; letra = "sistema"; tamano = "normal"; guardar() }

    @Composable
    fun oscuro(): Boolean = when (modo) { "claro" -> false; "oscuro" -> true; else -> isSystemInDarkTheme() }

    val escala: Float get() = TAMANOS[tamano]?.second ?: 1f
    val familia: FontFamily get() = LETRAS[letra]?.second ?: FontFamily.Default

    /** Los colores de la cabecera; en oscuro, apagados (como en la web). */
    @Composable
    fun cabecera(): List<Color> {
        val t = TEMAS[tema] ?: TEMAS.getValue("nuvora")
        val oscuro = oscuro()
        if (t.claro == null) return if (oscuro) listOf(Color(0xFF3A2A8F), Color(0xFF0E5566)) else t.cabecera.map { Color(it) }
        return t.cabecera.map { if (oscuro) oscurecer(Color(it)) else Color(it) }
    }

    fun esquema(oscuro: Boolean, porDefecto: ColorScheme): ColorScheme {
        val t = TEMAS[tema]
        val p = (if (oscuro) t?.oscuro else t?.claro)?.map { Color(it) } ?: return porDefecto
        val (fondo, sup, sup2, tinte, texto, suave, borde, principal) = p
        val sobrePrincipal = if (oscuro) fondo else Color.White
        val base = if (oscuro) darkColorScheme() else lightColorScheme()
        return base.copy(
            primary = principal, onPrimary = sobrePrincipal, primaryContainer = tinte, onPrimaryContainer = texto,
            secondary = principal, onSecondary = sobrePrincipal, secondaryContainer = tinte, onSecondaryContainer = texto,
            tertiary = principal, background = fondo, onBackground = texto, surface = sup, onSurface = texto,
            surfaceVariant = sup2, onSurfaceVariant = suave, outline = suave, outlineVariant = borde,
            surfaceContainerLowest = sup, surfaceContainerLow = sup, surfaceContainer = sup2,
            surfaceContainerHigh = sup, surfaceContainerHighest = sup2, surfaceBright = sup, surfaceDim = fondo,
            inverseSurface = texto, inverseOnSurface = fondo, surfaceTint = principal,
        )
    }
}

private operator fun <T> List<T>.component6() = this[5]
private operator fun <T> List<T>.component7() = this[6]
private operator fun <T> List<T>.component8() = this[7]

private fun oscurecer(c: Color, f: Float = 0.62f) = Color(c.red * f, c.green * f, c.blue * f, c.alpha)

/** Todos los estilos de texto de Material con la letra elegida. */
fun tipografia(familia: FontFamily): Typography {
    val t = Typography()
    if (familia == FontFamily.Default) return t
    fun TextStyle.con() = copy(fontFamily = familia)
    return Typography(
        displayLarge = t.displayLarge.con(), displayMedium = t.displayMedium.con(), displaySmall = t.displaySmall.con(),
        headlineLarge = t.headlineLarge.con(), headlineMedium = t.headlineMedium.con(), headlineSmall = t.headlineSmall.con(),
        titleLarge = t.titleLarge.con(), titleMedium = t.titleMedium.con(), titleSmall = t.titleSmall.con(),
        bodyLarge = t.bodyLarge.con(), bodyMedium = t.bodyMedium.con(), bodySmall = t.bodySmall.con(),
        labelLarge = t.labelLarge.con(), labelMedium = t.labelMedium.con(), labelSmall = t.labelSmall.con(),
    )
}

/** Ajustes → Apariencia: tema, modo, letra y tamaño del texto. Se ve el cambio al momento. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DialogoApariencia(onCerrar: () -> Unit) {
    val oscuro = Apariencia.oscuro()
    AlertDialog(
        onDismissRequest = { Apariencia.guardar(); onCerrar() },
        title = { Text("Apariencia") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Seccion("Tema")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TEMAS.forEach { (id, t) ->
                        val elegido = Apariencia.tema == id
                        val cab = t.cabecera.map { if (oscuro && t.claro != null) oscurecer(Color(it)) else Color(it) }
                        Column(
                            Modifier
                                .width(84.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .border(
                                    if (elegido) BorderStroke(2.dp, MaterialTheme.colorScheme.primary)
                                    else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    RoundedCornerShape(12.dp),
                                )
                                .clickable { Apariencia.tema = id; Apariencia.guardar() },
                        ) {
                            Box(Modifier.fillMaxWidth().height(26.dp).background(Brush.linearGradient(cab)))
                            Row(Modifier.padding(horizontal = 7.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(t.nombre, fontSize = 11.sp, maxLines = 1, modifier = Modifier.weight(1f),
                                    fontWeight = if (elegido) FontWeight.Bold else FontWeight.Normal)
                                t.muestra.drop(1).forEach { Box(Modifier.size(7.dp).clip(CircleShape).background(Color(it))) }
                            }
                        }
                    }
                }
                Seccion("Modo")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MODOS.forEach { (id, nombre) ->
                        FilterChip(selected = Apariencia.modo == id, onClick = { Apariencia.modo = id; Apariencia.guardar() }, label = { Text(nombre) })
                    }
                }
                Seccion("Letra")
                LETRAS.forEach { (id, l) ->
                    val elegido = Apariencia.letra == id
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 3.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (elegido) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                            .border(1.dp, if (elegido) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp))
                            .clickable { Apariencia.letra = id; Apariencia.guardar() }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        Text(l.first, fontFamily = l.second, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        Text("Mis fotos del viaje.jpg", fontFamily = l.second, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Seccion("Tamaño del texto")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    TAMANOS.forEach { (id, t) ->
                        FilterChip(selected = Apariencia.tamano == id, onClick = { Apariencia.tamano = id; Apariencia.guardar() }, label = { Text(t.first) })
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { Apariencia.guardar(); onCerrar() }) { Text("Listo") } },
        dismissButton = { TextButton(onClick = { Apariencia.restablecer() }) { Text("Restablecer") } },
    )
}

@Composable
private fun Seccion(texto: String) {
    Spacer(Modifier.height(14.dp))
    Text(texto, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(8.dp))
}
