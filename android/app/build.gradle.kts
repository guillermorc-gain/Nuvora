plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// El workflow «Publicar versión» pasa el número de la versión (v0.N → versionCode N)
val codigo = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val nombre = (project.findProperty("versionName") as String?) ?: "0.0"

android {
    namespace = "com.guillermorc.nuvora"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.guillermorc.nuvora"
        minSdk = 26
        targetSdk = 34
        versionCode = codigo
        versionName = nombre
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
