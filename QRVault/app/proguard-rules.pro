# =============================================================================
# QRVault — release ProGuard / R8 rules.
# Goals:
#   1. Don't break kotlinx-serialization reflection
#   2. Don't break Hilt/Dagger generated code
#   3. Don't break Compose runtime
#   4. Don't break Ktor / OkHttp / libsodium JNI bindings
# =============================================================================

# Keep source file + line numbers in stack traces (Crashlytics-friendly).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# -----------------------------------------------------------------------------
# Kotlinx Serialization
# -----------------------------------------------------------------------------
-keepattributes *Annotation*, EnclosingMethod, Signature, InnerClasses

-keepclassmembers @kotlinx.serialization.Serializable class ** {
    static **$Companion Companion;
    static **$$serializer INSTANCE;
}

-keep,allowobfuscation,allowshrinking class kotlinx.serialization.** { *; }
-keepclassmembers class * {
    static **$Companion Companion;
}

# Keep every @Serializable data class in our model package, including their
# generated $serializer companion objects. Without this, release builds
# throw SerializationException at runtime.
-keep @kotlinx.serialization.Serializable class com.hamburgbuzz.qrvault.data.model.** { *; }
-keep class com.hamburgbuzz.qrvault.data.model.**$$serializer { *; }
-keepclassmembers class com.hamburgbuzz.qrvault.data.model.** { *** Companion; }

# -----------------------------------------------------------------------------
# Hilt / Dagger
# -----------------------------------------------------------------------------
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.internal.GeneratedComponent { *; }
-keepclassmembers,allowobfuscation class * {
  @dagger.hilt.android.AndroidEntryPoint <init>(...);
}

# -----------------------------------------------------------------------------
# Compose (BOM 2026.x is largely R8-safe; keep platform classes)
# -----------------------------------------------------------------------------
-keep class androidx.compose.ui.platform.** { *; }

# -----------------------------------------------------------------------------
# Ktor / OkHttp
# -----------------------------------------------------------------------------
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-keep class okio.** { *; }
-dontwarn okio.**

# -----------------------------------------------------------------------------
# libsodium-android (lazysodium) JNI bindings
# -----------------------------------------------------------------------------
-keep class com.goterl.lazysodium.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**
-keep,allowobfuscation,allowshrinking class * implements com.sun.jna.Library

# -----------------------------------------------------------------------------
# Firebase / Play Services
# -----------------------------------------------------------------------------
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# -----------------------------------------------------------------------------
# WorkManager
# -----------------------------------------------------------------------------
-keep class androidx.work.** { *; }

# -----------------------------------------------------------------------------
# Conservative defaults: do NOT enable aggressive optimizations that have
# historically broken Compose + Coroutines.
# (No -optimizationpasses / -allowaccessmodification / -mergeinterfacesaggressively.)
# -----------------------------------------------------------------------------
