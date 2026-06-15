package com.hamburgbuzz.qrvault.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary

/**
 * Reusable text-edit dialog used by Personalization rows. Single source
 * of styling so every dialog in the app looks identical.
 *
 *   title     headline at the top
 *   helper    optional secondary line under the title
 *   initial   pre-populated value
 *   maxLines  1 for single-line; 4-6 for multi-line; affects keyboard IME
 *   maxChars  hard cap visible in the field
 *   onSave    called with the trimmed string (may be empty to clear)
 */
@Composable
fun TextFieldDialog(
    title: String,
    helper: String? = null,
    initial: String = "",
    placeholder: String = "",
    maxLines: Int = 1,
    maxChars: Int = 200,
    allowEmpty: Boolean = true,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(initial) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        shape = RoundedCornerShape(20.dp),
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, color = TextPrimary, fontWeight = FontWeight.Bold)
                helper?.let {
                    Text(it, color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= maxChars) text = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(placeholder, color = TextSecondary) },
                singleLine = maxLines == 1,
                maxLines = maxLines,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Color(0xFF27272A),
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    cursorColor = Accent,
                ),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = if (maxLines > 1) ImeAction.Default else ImeAction.Done,
                ),
                supportingText = {
                    Text("${text.length} / $maxChars", color = TextSecondary, style = MaterialTheme.typography.labelSmall)
                },
            )
        },
        confirmButton = {
            Button(
                onClick = { onSave(text.trim()); onDismiss() },
                enabled = allowEmpty || text.trim().isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
                shape = RoundedCornerShape(10.dp),
            ) { Text("SAVE", color = BgObsidian, fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("CANCEL", color = TextSecondary) }
        },
    )
}
