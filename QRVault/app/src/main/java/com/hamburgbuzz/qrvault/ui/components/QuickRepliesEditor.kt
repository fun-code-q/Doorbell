package com.hamburgbuzz.qrvault.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary

/**
 * Dialog for editing the owner's quick replies. Up to 5 entries, each up
 * to 200 chars. Empty entries are dropped on save. Passing an empty list
 * to onSave reverts to the bundled defaults (handled server-side by
 * `set_quick_replies` with null).
 *
 * The five slots are independently editable; their order in the list is
 * preserved when they're shown on the incoming-ring screen.
 */
@Composable
fun QuickRepliesEditor(
    initial: List<String>?,
    onDismiss: () -> Unit,
    onSave: (List<String>?) -> Unit,
) {
    val rows = remember {
        mutableStateListOf<String>().apply {
            val src = initial ?: emptyList()
            repeat(5) { add(src.getOrNull(it) ?: "") }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        shape = RoundedCornerShape(20.dp),
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Quick replies", color = TextPrimary, fontWeight = FontWeight.Bold)
                Text(
                    "Up to 5 canned answers shown on the incoming-ring screen. Leave blank to skip a slot.",
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(5) { idx ->
                    OutlinedTextField(
                        value = rows[idx],
                        onValueChange = { if (it.length <= 200) rows[idx] = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text(placeholderFor(idx), color = TextSecondary) },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            cursorColor = Accent,
                        ),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val clean = rows.map { it.trim() }.filter { it.isNotEmpty() }
                    // Empty list → null payload → server reverts to defaults.
                    onSave(if (clean.isEmpty()) null else clean)
                    onDismiss()
                },
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
                shape = RoundedCornerShape(10.dp),
            ) { Text("SAVE", color = BgObsidian, fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(onClick = {
                rows.indices.forEach { rows[it] = "" }  // mark all empty → save reverts
            }) {
                Icon(Icons.Outlined.RestartAlt, contentDescription = null, tint = TextSecondary)
                Text("CLEAR", color = TextSecondary)
            }
        },
    )
}

private fun placeholderFor(idx: Int): String = when (idx) {
    0 -> "Coming!"
    1 -> "Leave it at the door, thanks."
    2 -> "Use the side entrance."
    3 -> "Busy — call back in 10 min."
    else -> "(optional)"
}
