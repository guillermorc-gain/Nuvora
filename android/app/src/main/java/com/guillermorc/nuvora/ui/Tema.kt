package com.guillermorc.nuvora.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.guillermorc.nuvora.R

// Los azules de Memories (y de la web de Nuvora)
val Azul = Color(0xFF1565C0)
val AzulOscuro = Color(0xFF003A99)

private val Claro = lightColorScheme(
    primary = Azul, onPrimary = Color.White, primaryContainer = Color(0xFFDBE7FB), onPrimaryContainer = AzulOscuro,
    secondary = AzulOscuro, background = Color(0xFFF4F6FA), onBackground = Color(0xFF1A2233),
    surface = Color.White, onSurface = Color(0xFF1A2233), surfaceVariant = Color(0xFFEDF1F7),
    onSurfaceVariant = Color(0xFF566173), outlineVariant = Color(0xFFE3E7EE), error = Color(0xFFC62828),
)

private val Oscuro = darkColorScheme(
    primary = Color(0xFF8AB4F8), onPrimary = Color(0xFF002E6B), primaryContainer = Color(0xFF1B3A6B),
    onPrimaryContainer = Color(0xFFDBE7FB), background = Color(0xFF0F131A), onBackground = Color(0xFFE3E7EE),
    surface = Color(0xFF181D26), onSurface = Color(0xFFE3E7EE), surfaceVariant = Color(0xFF1E2430),
    onSurfaceVariant = Color(0xFFAAB3C2), outlineVariant = Color(0xFF2A303B), error = Color(0xFFFF8A80),
)

val Caligrafica = FontFamily(Font(R.font.dancing_script, FontWeight.Bold))

/** El degradado del logotipo «Nuvora» (como el de Memories). */
val DegradadoLogo = Brush.horizontalGradient(listOf(Color(0xFF1E3A8A), Color(0xFF6A3DE8), Color(0xFFC2185B), Color(0xFFFF7A2F)))

@Composable
fun NuvoraTema(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Oscuro else Claro, content = content)
}

@Composable
fun Logotipo(tamano: TextUnit = 54.sp, color: Brush = DegradadoLogo) {
    Text("Nuvora", style = TextStyle(brush = color, fontFamily = Caligrafica, fontSize = tamano, fontWeight = FontWeight.Bold))
}

/** Cabecera con el degradado azul de Memories. */
@Composable
fun Cabecera(acciones: @Composable RowScope.() -> Unit = {}) {
    val oscuro = isSystemInDarkTheme()
    val colores = if (oscuro) listOf(Color(0xFF0D2147), Color(0xFF06102A)) else listOf(Azul, Color(0xFF0D4FA8), AzulOscuro)
    Box(
        Modifier
            .fillMaxWidth()
            .background(Brush.linearGradient(colores))
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Logotipo(30.sp, Brush.linearGradient(listOf(Color.White, Color.White)))
            Column(Modifier.weight(1f)) {}
            acciones()
        }
    }
}
