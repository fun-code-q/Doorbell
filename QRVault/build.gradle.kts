// Top-level build file. Plugin versions are declared in gradle/libs.versions.toml.
plugins {
    alias(libs.plugins.android.application)      apply false
    alias(libs.plugins.kotlin.android)           apply false
    alias(libs.plugins.kotlin.compose)           apply false
    alias(libs.plugins.kotlin.serialization)     apply false
    alias(libs.plugins.google.devtools.ksp)      apply false
    alias(libs.plugins.hilt.android)             apply false
    alias(libs.plugins.google.services)          apply false
    alias(libs.plugins.aboutlibraries)           apply false
    alias(libs.plugins.firebase.crashlytics)     apply false
}
