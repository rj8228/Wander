plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from version.js at the repo root, e.g. "0.1.4" -> versionCode 104.
val wanderVersion: String = Regex("WANDER_VERSION\\s*=\\s*\"([0-9.]+)\"").find(rootProject.file("../version.js").readText())!!.groupValues[1]
val wanderCode: Int = wanderVersion.split(".").map { it.toInt() }.let { it[0] * 10000 + it[1] * 100 + it[2] }

android {
    namespace = "com.raj.wander"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.raj.wander"
        minSdk = 26
        targetSdk = 35
        versionCode = wanderCode
        versionName = wanderVersion
    }

    // One fixed key for every build, so each new APK installs over the last one.
    // The key is never in this repo: CI writes it from secrets (backup in the private rj8228/signing-keys repo).
    // Without WANDER_KEYSTORE the release build comes out unsigned.
    val keystore = System.getenv("WANDER_KEYSTORE")
    signingConfigs {
        if (keystore != null) create("wander") {
            storeFile = file(keystore)
            storePassword = System.getenv("WANDER_KEYSTORE_PASSWORD")
            keyAlias = "wander"
            keyPassword = System.getenv("WANDER_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore != null) signingConfig = signingConfigs.getByName("wander")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.1")
}
