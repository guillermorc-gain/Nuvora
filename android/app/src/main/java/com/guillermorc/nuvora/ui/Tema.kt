package com.guillermorc.nuvora.ui

import androidx.compose.foundation.background
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Los colores del icono «Nube N»: violeta → cian
val Violeta = Color(0xFF7C5CFF)
val Cian = Color(0xFF22D3EE)
val VioletaOscuro = Color(0xFF4B2FD6)

private val Claro = lightColorScheme(
    primary = Color(0xFF6C4DFF), onPrimary = Color.White, primaryContainer = Color(0xFFECE8FF), onPrimaryContainer = VioletaOscuro,
    secondary = Color(0xFF0891B2), background = Color(0xFFF6F5FC), onBackground = Color(0xFF1B1D2A),
    surface = Color.White, onSurface = Color(0xFF1B1D2A), surfaceVariant = Color(0xFFEFEEF8),
    onSurfaceVariant = Color(0xFF5E6275), outlineVariant = Color(0xFFE2E1EE), error = Color(0xFFD93A44),
)

private val Oscuro = darkColorScheme(
    primary = Color(0xFFA594FF), onPrimary = Color(0xFF21106B), primaryContainer = Color(0xFF2E2560),
    onPrimaryContainer = Color(0xFFECE8FF), background = Color(0xFF0F0F17), onBackground = Color(0xFFE8E8F2),
    surface = Color(0xFF181823), onSurface = Color(0xFFE8E8F2), surfaceVariant = Color(0xFF20202E),
    onSurfaceVariant = Color(0xFFA6A8BC), outlineVariant = Color(0xFF2C2C3D), error = Color(0xFFFF8A8F),
)

/** El degradado del icono, para el logotipo y la cabecera. */
val DegradadoLogo = Brush.linearGradient(listOf(Violeta, Cian))

@Composable
fun NuvoraTema(content: @Composable () -> Unit) {
    val oscuro = Apariencia.oscuro()
    val densidad = LocalDensity.current
    MaterialTheme(
        colorScheme = Apariencia.esquema(oscuro, if (oscuro) Oscuro else Claro),
        typography = tipografia(Apariencia.familia),
    ) {
        // Tamaño del texto de Apariencia, encima del que tengas en Android
        CompositionLocalProvider(LocalDensity provides Density(densidad.density, densidad.fontScale * Apariencia.escala), content = content)
    }
}

@Composable
fun Logotipo(tamano: TextUnit = 54.sp, color: Brush = DegradadoLogo) {
    Text("Nuvora", style = TextStyle(brush = color, fontSize = tamano, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.04).em))
}

/** Cabecera con el degradado del icono. */
@Composable
fun Cabecera(acciones: @Composable RowScope.() -> Unit = {}) {
    val colores = Apariencia.cabecera()
    Box(
        Modifier
            .fillMaxWidth()
            .background(Brush.linearGradient(colores))
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Logotipo(24.sp, Brush.linearGradient(listOf(Color.White, Color.White)))
            Column(Modifier.weight(1f)) {}
            acciones()
        }
    }
}
