package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.components.QrScreen
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.mikepenz.aboutlibraries.ui.compose.m3.LibrariesContainer
import com.mikepenz.aboutlibraries.ui.compose.m3.LibraryDefaults

/**
 * Renders the OSS-licenses list embedded in the APK by the
 * AboutLibraries Gradle plugin. The plugin scans every Gradle dependency
 * at build time and ships a `aboutlibraries.json` asset; this composable
 * reads it and lays the libraries out as a Material 3 list.
 *
 * Replaces the placeholder external `licenses.html` link we shipped in
 * the AboutScreen at first. Bundled inside the APK = no network needed,
 * and always matches the libraries actually shipped in the current build.
 */
@Composable
fun LicensesScreen(
    onNavigateBack: () -> Unit,
) {
    QrScreen(
        title = stringResource(R.string.about_oss_licenses),
        onNavigateBack = onNavigateBack,
    ) { pad ->
        // AboutLibraries 11.x's LibrariesContainer doesn't accept a
        // textStyles parameter (that arrived in 12.x). The Material 3
        // typography ambient handles styling automatically.
        LibrariesContainer(
            modifier = Modifier.fillMaxSize().padding(pad),
            colors = LibraryDefaults.libraryColors(
                backgroundColor = BgObsidian,
                contentColor = TextPrimary,
                badgeBackgroundColor = Accent,
                badgeContentColor = BgObsidian,
                dialogConfirmButtonColor = Accent,
            ),
        )
    }
}
