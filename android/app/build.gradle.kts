plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// El workflow «Publicar versión» pasa el número de la versión (v0.N → versionCode N)
val codigo = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val nombre = (project.findProperty("versionName") as String?) ?: "0.0"

// El cliente web de Google sale de google-services.json (proyecto de Firebase «Nuvora»),
// como en Memories. Sin él la APK se compila igual, pero sin «Continuar con Google».
val clienteWebGoogle: String = file("google-services.json").takeIf { it.exists() }?.let { archivo ->
    @Suppress("UNCHECKED_CAST")
    val datos = groovy.json.JsonSlurper().parse(archivo) as Map<String, Any?>
    (datos["client"] as? List<Map<String, Any?>>).orEmpty()
        .flatMap { (it["oauth_client"] as? List<Map<String, Any?>>).orEmpty() }
        .firstOrNull { (it["client_type"] as? Number)?.toInt() == 3 }
        ?.get("client_id") as? String
} ?: ""

android {
    namespace = "com.guillermorc.nuvora"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.guillermorc.nuvora"
        minSdk = 26
        targetSdk = 34
        versionCode = codigo
        versionName = nombre
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$clienteWebGoogle\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Todas las APK van firmadas con la misma clave, así cada una se instala encima de la anterior
    signingConfigs {
        create("nuvora") {
            storeFile = file("nuvora.keystore")
            storePassword = "nuvora-apk"
            keyAlias = "nuvora"
            keyPassword = "nuvora-apk"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("nuvora")
        }
        debug {
            signingConfig = signingConfigs.getByName("nuvora")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    // La APK se instala a mano (no va a Google Play): que la revisión de Play no pare la compilación
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    // Iniciar sesión con Google (las mismas versiones que Memories)
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
