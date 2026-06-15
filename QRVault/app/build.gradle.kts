import java.util.Properties

val localProps = Properties().also { props ->
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { props.load(it) }
}

// Read property from local.properties or env, falling back to a default.
fun prop(key: String, default: String = ""): String =
    localProps.getProperty(key)
        ?: System.getenv(key)
        ?: default

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.devtools.ksp)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.google.services)
    alias(libs.plugins.aboutlibraries)
    alias(libs.plugins.firebase.crashlytics)
}

aboutLibraries {
    // Pre-process dependency-license metadata at build time. The plugin
    // scans every Gradle dependency, pulls POM metadata, embeds the
    // result as a JSON asset the LibrariesContainer reads at runtime.
    registerAndroidTasks = true
    excludeFields = arrayOf("generated")
}

android {
    namespace = "com.hamburgbuzz.qrvault"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.hamburgbuzz.qrvault"
        minSdk = 27
        targetSdk = 36
        versionCode = 2
        versionName = "2.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Supabase + guest-host URLs are injected at build time, never hard-coded.
        buildConfigField("String", "SUPABASE_URL",   "\"${prop("SUPABASE_URL")}\"")
        buildConfigField("String", "SUPABASE_KEY",   "\"${prop("SUPABASE_KEY")}\"")
        buildConfigField("String", "GUEST_BASE_URL", "\"${prop("GUEST_BASE_URL", "https://example.invalid/")}\"")

        resourceConfigurations += listOf("en", "de", "es", "fr", "tr", "pl")

        vectorDrawables { useSupportLibrary = true }
    }

    // ---------------------------------------------------------------------
    // Signing configuration.
    // CI builds get keystore + passwords from environment variables; local
    // builds may use local.properties. The release variant always uses
    // signingConfigs.release — never the debug keystore.
    // See USER_ACTIONS.md step 2 for the secret-distribution flow.
    // ---------------------------------------------------------------------
    signingConfigs {
        create("release") {
            val storePath = prop("RELEASE_STORE_FILE")
            if (storePath.isNotBlank()) {
                storeFile     = rootProject.file(storePath)
                storePassword = prop("RELEASE_STORE_PASSWORD")
                keyAlias      = prop("RELEASE_KEY_ALIAS")
                keyPassword   = prop("RELEASE_KEY_PASSWORD")
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Only use the release signing config when a keystore is actually present.
            if (prop("RELEASE_STORE_FILE").isNotBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        getByName("debug") {
            isMinifyEnabled = false
            isShrinkResources = false
            // No applicationIdSuffix — google-services.json only has a
            // client registered for `com.hamburgbuzz.qrvault`. Add a
            // separate Firebase Android app for `*.debug` and restore
            // the suffix if you want side-by-side debug+release installs.
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    packaging {
        resources {
            excludes += listOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/INDEX.LIST",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
                "/META-INF/io.netty.versions.properties",
                "META-INF/proguard/*",
            )
        }
        jniLibs {
            useLegacyPackaging = true   // lazysodium requires JNI extraction
        }
    }

    // generateLocaleConfig is intentionally not set — we maintain the
    // locale list manually at `res/xml/locales_config.xml` and reference
    // it from the manifest's `android:localeConfig`. Letting AGP also
    // auto-generate one collides on AGP 8.x.

    lint {
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = true
    }
}

// JVM toolchain must be at top-level under AGP 8.x; the Kotlin Gradle
// Plugin's `kotlin {}` DSL is the project-level extension, not nested
// inside `android {}` (that nesting was an AGP 9 preview affordance).
kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui.text.google.fonts)
    implementation(libs.coil.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.material)

    // Supabase
    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.realtime)
    implementation(libs.supabase.auth)
    implementation(libs.ktor.client.android)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.utils)

    // Firebase Cloud Messaging
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    // Location (geofence guarantee on the owner side)
    implementation(libs.play.services.location)

    // Runtime permissions wrapper
    implementation(libs.accompanist.permissions)

    // Biometric (Batch G #22): opt-in unlock gate before sensitive screens.
    implementation(libs.androidx.biometric)

    // Splash Screen API (Batch G #21).
    implementation(libs.androidx.core.splashscreen)

    // Wear OS bridging extras (Batch H #17): paired-watch ring actions.
    implementation(libs.androidx.wear)

    // OSS-licenses screen (AboutLibraries plugin produces the metadata
    // at build time; the compose-m3 module renders it inside the app).
    implementation(libs.aboutlibraries.core)
    implementation(libs.aboutlibraries.compose.m3)

    // ZXing for local QR rendering (share PNG, print-to-PDF, etc.).
    implementation(libs.zxing.core)

    // Play Core in-app updates (Batch O #6).
    implementation(libs.play.app.update.ktx)

    // Google Code Scanner — on-device, no UI work (Batch P #19).
    implementation(libs.play.services.code.scanner)

    // Firebase Crashlytics (Batch O #7). Uses the same firebase-bom as FCM.
    implementation(libs.firebase.crashlytics)

    // E2E encryption — libsodium for Android (sealed-box decrypt of guest messages).
    //
    // Exclude the JAR variant of JNA from lazysodium-android's transitive
    // deps; we pull JNA in as AAR ourselves below (needed for the
    // Android-shaped JNI binaries). Without this exclude, JNA classes
    // collide and `checkDebugDuplicateClasses` fails.
    implementation(libs.lazysodium.android) {
        exclude(group = "net.java.dev.jna", module = "jna")
    }
    implementation(libs.jna) { artifact { type = "aar" } }

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.android.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.androidx.core)
    testImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.runner)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
