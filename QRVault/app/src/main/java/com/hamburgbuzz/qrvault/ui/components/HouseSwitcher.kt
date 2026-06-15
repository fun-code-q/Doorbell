package com.hamburgbuzz.qrvault.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.HouseSwitcherViewModel

/**
 * House-switcher pill rendered inside the Home top bar. Tapping opens a
 * DropdownMenu of every house the user is a member of; selecting one
 * fires the switch RPC and updates the active_house_id.
 *
 * Hidden when the user only has a single house (nothing to switch to).
 *
 * `onHouseChanged` lets the parent screen react — e.g. HomeViewModel
 * can clear the ring list + re-subscribe to realtime for the new house.
 */
@Composable
fun HouseSwitcher(
    modifier: Modifier = Modifier,
    onHouseChanged: () -> Unit = {},
    viewModel: HouseSwitcherViewModel = hiltViewModel(),
) {
    val houses by viewModel.houses.collectAsStateWithLifecycle()
    val activeId by viewModel.activeHouseId.collectAsStateWithLifecycle()

    if (houses.size < 2) return  // nothing to switch to

    val activeName = houses.firstOrNull { it.id == activeId }?.name
        ?: houses.firstOrNull()?.name
        ?: "House"

    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier) {
        Surface(
            color = BgElevated,
            shape = RoundedCornerShape(20.dp),
            onClick = { expanded = true },
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Icon(Icons.Outlined.Home, contentDescription = null, tint = Accent, modifier = Modifier.size(16.dp))
                Text(
                    text = activeName,
                    color = TextPrimary,
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    maxLines = 1,
                )
                Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(16.dp))
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = BgElevated,
        ) {
            houses.forEach { house ->
                val selected = house.id == activeId
                DropdownMenuItem(
                    onClick = {
                        expanded = false
                        if (!selected) viewModel.switchTo(house.id) { onHouseChanged() }
                    },
                    text = {
                        Text(
                            house.name,
                            color = if (selected) Accent else TextPrimary,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                        )
                    },
                    leadingIcon = {
                        Icon(
                            Icons.Outlined.Home,
                            contentDescription = null,
                            tint = if (selected) Accent else TextSecondary,
                            modifier = Modifier.size(18.dp),
                        )
                    },
                )
            }
        }
    }
}

