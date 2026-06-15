package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DoorSliding
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.alpha
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.data.model.DoorMember
import com.hamburgbuzz.qrvault.data.model.DoorPoint
import com.hamburgbuzz.qrvault.ui.components.ShimmerList
import com.hamburgbuzz.qrvault.ui.theme.*
import com.hamburgbuzz.qrvault.ui.viewmodel.DoorsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DoorsScreen(
    onNavigateBack: () -> Unit,
    onSignOut: () -> Unit,
    viewModel: DoorsViewModel = hiltViewModel()
) {
    val doorPoints by viewModel.doorPoints.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    val context = LocalContext.current
    LaunchedEffect(error) {
        error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }
    
    var doorName by remember { mutableStateOf("") }
    var doorDesc by remember { mutableStateOf("") }
    
    var selectedDoorForEdit by remember { mutableStateOf<DoorPoint?>(null) }
    var selectedDoorForMembers by remember { mutableStateOf<DoorPoint?>(null) }
    var selectedDoorForQr by remember { mutableStateOf<DoorPoint?>(null) }
    var selectedDoorForInfo by remember { mutableStateOf<DoorPoint?>(null) }
    var selectedDoorForSecurity by remember { mutableStateOf<DoorPoint?>(null) }

    // Runtime permission gate for ACCESS_FINE_LOCATION. The result is consumed
    // by SecurityDialog's "Pin location" action.
    val locationPermissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        contract = androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (!granted) {
            Toast.makeText(context, "Location permission is required to pin the door's anchor.", Toast.LENGTH_LONG).show()
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgObsidian
    ) {
        Scaffold(
            containerColor = BgObsidian,
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.doors_title).uppercase(), fontWeight = FontWeight.Bold, letterSpacing = 1.sp) },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back), tint = Color.White)
                        }
                    },
                    actions = {
                        IconButton(onClick = {
                            viewModel.signOut()
                            onSignOut()
                        }) {
                            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sign Out", tint = Color.Red)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = BgObsidian,
                        titleContentColor = Accent
                    )
                )
            }
        ) { padding ->
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                // Fixed Add Section (Matching mobile-owner layout)
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    colors = CardDefaults.cardColors(containerColor = BgElevated),
                    shape = RoundedCornerShape(20.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A))
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "Add New Location",
                            style = MaterialTheme.typography.labelMedium,
                            color = TextSecondary,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        
                        OutlinedTextField(
                            value = doorName,
                            onValueChange = { if (it.length <= 13) doorName = it },
                            placeholder = { Text("Location Name (e.g. Front Door)", color = TextSecondary) },
                            modifier = Modifier.fillMaxWidth(),
                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp)) },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Accent,
                                unfocusedBorderColor = Color(0xFF27272A),
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                cursorColor = Accent
                            ),
                            shape = RoundedCornerShape(12.dp),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Words,
                                imeAction = ImeAction.Next
                            )
                        )
                        
                        Spacer(modifier = Modifier.height(8.dp))
                        
                        OutlinedTextField(
                            value = doorDesc,
                            onValueChange = { doorDesc = it },
                            placeholder = { Text("Instructions (optional)", color = TextSecondary) },
                            modifier = Modifier.fillMaxWidth(),
                            leadingIcon = { Icon(Icons.Default.Description, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp)) },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Accent,
                                unfocusedBorderColor = Color(0xFF27272A),
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                cursorColor = Accent
                            ),
                            shape = RoundedCornerShape(12.dp),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Sentences,
                                imeAction = ImeAction.Done
                            )
                        )
                        
                        Spacer(modifier = Modifier.height(16.dp))
                        
                        Button(
                            onClick = {
                                if (doorName.isNotBlank()) {
                                    viewModel.addDoorPoint(doorName, doorDesc)
                                    doorName = ""
                                    doorDesc = ""
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Accent),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("ADD", fontWeight = FontWeight.Bold, color = Color.Black)
                        }
                    }
                }

                if (isLoading && doorPoints.isEmpty()) {
                    ShimmerList(padding = PaddingValues(0.dp))
                } else if (doorPoints.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Outlined.DoorSliding, contentDescription = null, modifier = Modifier.size(64.dp), tint = TextSecondary)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(stringResource(R.string.no_doors), color = TextSecondary)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(bottom = 16.dp)
                    ) {
                        items(doorPoints) { door ->
                            DoorCard(
                                door = door,
                                onToggle = { viewModel.setDoorPointActive(door.id, it) },
                                onDelete = { viewModel.deleteDoorPoint(door.id) },
                                onShowQr = { selectedDoorForQr = door },
                                onEdit = { selectedDoorForEdit = door },
                                onMembers = { selectedDoorForMembers = door },
                                onShowInfo = { selectedDoorForInfo = door },
                                onShowSecurity = { selectedDoorForSecurity = door }
                            )
                        }
                    }
                }
            }
        }
    }

    // Dialogs
    selectedDoorForEdit?.let { door ->
        EditDoorDialog(
            door = door,
            onDismiss = { selectedDoorForEdit = null },
            onConfirm = { name, desc ->
                viewModel.updateDoorPoint(door.id, name, desc)
                selectedDoorForEdit = null
            }
        )
    }

    selectedDoorForMembers?.let { door ->
        val membersMap by viewModel.doorMembers.collectAsStateWithLifecycle()
        MemberManagementDialog(
            doorName = door.name,
            doorId = door.id,
            members = membersMap[door.id] ?: emptyList(),
            onDismiss = { selectedDoorForMembers = null },
            onInvite = { viewModel.addDoorMember(door.id, it) },
            onRemove = { viewModel.removeDoorMember(door.id, it) },
            onMute = { userId, muted -> viewModel.muteDoorMember(door.id, userId, muted) },
            onLoad = { viewModel.loadDoorMembers(door.id) }
        )
    }

    selectedDoorForQr?.let { door ->
        QrDialog(
            doorName = door.name,
            qrUrl = viewModel.guestUrl(door.qrToken),
            onDismiss = { selectedDoorForQr = null }
        )
    }

    selectedDoorForInfo?.let { door ->
        InfoDialog(
            doorName = door.name,
            description = door.description ?: "",
            onDismiss = { selectedDoorForInfo = null }
        )
    }

    selectedDoorForSecurity?.let { door ->
        val geocodePreview by viewModel.geocodePreview.collectAsStateWithLifecycle()
        val geocoding by viewModel.geocoding.collectAsStateWithLifecycle()
        SecurityDialog(
            door = door,
            onDismiss = {
                viewModel.clearGeocodePreview()
                selectedDoorForSecurity = null
            },
            onPinLocation = { radiusM ->
                if (com.hamburgbuzz.qrvault.util.LocationCapture.hasFinePermission(context)) {
                    viewModel.pinCurrentLocation(door.id, radiusM)
                } else {
                    locationPermissionLauncher.launch(android.Manifest.permission.ACCESS_FINE_LOCATION)
                }
            },
            onLookupAddress = { viewModel.lookupAddress(it) },
            onClearGeocode = { viewModel.clearGeocodePreview() },
            onApplyGeocode = { radiusM -> viewModel.applyGeocodedPin(door.id, radiusM) },
            geocodePreview = geocodePreview,
            geocoding = geocoding,
            onRotateQr = { viewModel.rotateQrToken(door.id) },
            onSetDnd = { minutes -> viewModel.setDnd(door.id, minutes) },
            onSetRingtone = { ident -> viewModel.setRingtone(door.id, ident) },
        )
    }
}

@Composable
fun SecurityDialog(
    door: DoorPoint,
    onDismiss: () -> Unit,
    onPinLocation: (radiusM: Int) -> Unit,
    onLookupAddress: (String) -> Unit,
    onClearGeocode: () -> Unit,
    onApplyGeocode: (radiusM: Int) -> Unit,
    geocodePreview: com.hamburgbuzz.qrvault.ui.viewmodel.DoorsViewModel.GeocodePreview?,
    geocoding: Boolean,
    onRotateQr: () -> Unit,
    onSetDnd: (minutes: Int) -> Unit,
    onSetRingtone: (identifier: String?) -> Unit,
) {
    var sliderRadius by remember { mutableStateOf(door.geofenceRadiusM.toFloat()) }
    var confirmRotate by remember { mutableStateOf(false) }
    var addressQuery by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Shield, contentDescription = null, tint = Accent)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Anti-spam controls", color = Color.White, fontWeight = FontWeight.Bold)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {

                // ----- Geofence -----
                Column {
                    Text("Geofence anchor", color = Accent, style = MaterialTheme.typography.labelLarge)
                    Spacer(modifier = Modifier.height(4.dp))
                    if (door.latitude != null && door.longitude != null) {
                        Text(
                            "Pinned at %.5f, %.5f · radius %d m".format(
                                door.latitude, door.longitude, door.geofenceRadiusM
                            ),
                            color = TextSecondary,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        door.locationAccuracyM?.let {
                            Text(
                                "Capture accuracy ±%.0f m".format(it),
                                color = TextSecondary,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    } else {
                        Text(
                            "Not pinned. Guests can ring from anywhere until you stand at the door and tap Pin.",
                            color = Color(0xFFFCA5A5),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Radius: ${sliderRadius.toInt()} m", color = Color.White, style = MaterialTheme.typography.bodyMedium)
                    Slider(
                        value = sliderRadius,
                        onValueChange = { sliderRadius = it },
                        valueRange = 10f..200f,
                        steps = 18,
                        colors = SliderDefaults.colors(thumbColor = Accent, activeTrackColor = Accent),
                    )
                    Button(
                        onClick = { onPinLocation(sliderRadius.toInt()) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Accent),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Default.MyLocation, contentDescription = null, tint = Color.Black)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            if (door.latitude == null) "PIN MY CURRENT LOCATION" else "RE-PIN AT MY LOCATION",
                            color = Color.Black, fontWeight = FontWeight.Bold,
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        "Or pin by address",
                        color = TextSecondary,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = addressQuery,
                            onValueChange = { addressQuery = it },
                            placeholder = {
                                Text("Reeperbahn 1, Hamburg", color = TextSecondary)
                            },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Accent,
                                unfocusedBorderColor = Color(0xFF27272A),
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                cursorColor = Accent,
                            ),
                            shape = RoundedCornerShape(10.dp),
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Words,
                                imeAction = ImeAction.Search,
                            ),
                        )
                        OutlinedButton(
                            onClick = {
                                if (addressQuery.isNotBlank() && !geocoding) onLookupAddress(addressQuery)
                            },
                            enabled = addressQuery.isNotBlank() && !geocoding,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Accent),
                        ) {
                            if (geocoding) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    color = Accent,
                                    modifier = Modifier.size(16.dp),
                                )
                            } else {
                                Text("LOOK UP", fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    geocodePreview?.let { p ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            color = BgObsidian,
                            shape = RoundedCornerShape(10.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Accent.copy(alpha = 0.4f)),
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Text(
                                    p.displayName ?: "%.5f, %.5f".format(p.latitude, p.longitude),
                                    color = Color.White,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                p.confidence?.let {
                                    Text(
                                        "Match confidence: ${"%.0f".format(it * 100)}%",
                                        color = TextSecondary,
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(
                                        onClick = onClearGeocode,
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(8.dp),
                                    ) { Text("CANCEL", color = TextSecondary) }
                                    Button(
                                        onClick = { onApplyGeocode(sliderRadius.toInt()) },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(8.dp),
                                        colors = ButtonDefaults.buttonColors(containerColor = Accent),
                                    ) {
                                        Text("USE THIS LOCATION", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }

                Divider(color = Color(0xFF27272A))

                // ----- Ringtone -----
                Column {
                    Text("Ringtone", color = Accent, style = MaterialTheme.typography.labelLarge)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "Pick the sound that plays when this door rings.",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    val options = listOf(
                        null to "Default (bundled)",
                        "bundled:soft" to "Soft chime",
                        "bundled:chime" to "Classic chime",
                        "bundled:buzz" to "Buzzer",
                        "system:default" to "System default",
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        options.forEach { (id, label) ->
                            val selected = door.ringtoneResource == id
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { if (!selected) onSetRingtone(id) }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(
                                    selected = selected,
                                    onClick = { if (!selected) onSetRingtone(id) },
                                    colors = RadioButtonDefaults.colors(
                                        selectedColor = Accent,
                                        unselectedColor = TextSecondary,
                                    ),
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    label,
                                    color = if (selected) Color.White else TextSecondary,
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                        }
                    }
                }

                Divider(color = Color(0xFF27272A))

                // ----- QR rotation -----
                Column {
                    Text("QR code", color = Accent, style = MaterialTheme.typography.labelLarge)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "Rotated ${door.qrRotationCount} time(s). If a photo of the sticker has been shared, rotate now — the old QR becomes inactive instantly.",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    if (!confirmRotate) {
                        OutlinedButton(
                            onClick = { confirmRotate = true },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFCA5A5)),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFCA5A5)),
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("ROTATE QR TOKEN")
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = { confirmRotate = false },
                                modifier = Modifier.weight(1f),
                            ) { Text("CANCEL", color = TextSecondary) }
                            Button(
                                onClick = { onRotateQr(); confirmRotate = false },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB91C1C)),
                            ) { Text("CONFIRM ROTATE", color = Color.White, fontWeight = FontWeight.Bold) }
                        }
                    }
                }

                Divider(color = Color(0xFF27272A))

                // ----- DND -----
                Column {
                    Text("Do Not Disturb", color = Accent, style = MaterialTheme.typography.labelLarge)
                    Spacer(modifier = Modifier.height(4.dp))
                    val dndText = door.dndUntil?.takeIf { it.isNotBlank() }
                        ?.let { "Paused until $it" } ?: "Active. Rings will arrive."
                    Text(dndText, color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(15 to "15m", 60 to "1h", 8 * 60 to "8h", 0 to "Clear").forEach { (mins, label) ->
                            OutlinedButton(
                                onClick = { onSetDnd(mins) },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp),
                            ) { Text(label, color = TextSecondary) }
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        "Auto-pause: after ${door.autoDndAfterUnanswered} unanswered rings in ${door.autoDndWindowMinutes} min, the bell will pause itself for an hour. " +
                            "Hard cap: ${door.maxRingsPerHour} rings/hour total across all visitors.",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("DONE", color = Accent)
            }
        },
    )
}

@Composable
fun InfoDialog(doorName: String, description: String, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Info, contentDescription = null, tint = Accent)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Instructions", color = Color.White)
            }
        },
        text = {
            Column {
                Text(doorName, style = MaterialTheme.typography.labelLarge, color = Accent)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    description.ifBlank { "No instructions provided." },
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("CLOSE", color = Accent)
            }
        }
    )
}

@Composable
fun EditDoorDialog(
    door: DoorPoint,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit
) {
    var name by remember { mutableStateOf(door.name) }
    var desc by remember { mutableStateOf(door.description ?: "") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        title = { Text("Edit Location", color = Accent, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= 13) name = it },
                    label = { Text("Name", color = TextSecondary) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF27272A),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    )
                )
                OutlinedTextField(
                    value = desc,
                    onValueChange = { desc = it },
                    label = { Text("Instructions", color = TextSecondary) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF27272A),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    )
                )
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(name, desc) }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
                Text("SAVE", color = Color.Black)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", color = TextSecondary)
            }
        }
    )
}

@Composable
fun MemberManagementDialog(
    doorName: String,
    doorId: String,
    members: List<DoorMember>,
    onDismiss: () -> Unit,
    onInvite: (String) -> Unit,
    onRemove: (String) -> Unit,
    onMute: (String, Boolean) -> Unit,
    onLoad: () -> Unit
) {
    var inviteName by remember { mutableStateOf("") }
    
    LaunchedEffect(Unit) { onLoad() }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        title = { Text("Channel Members", color = Accent, fontWeight = FontWeight.Bold) },
        text = {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = inviteName,
                        onValueChange = { inviteName = it },
                        placeholder = { Text("Username", color = TextSecondary) },
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )
                    IconButton(
                        onClick = { 
                            if (inviteName.isNotBlank()) {
                                onInvite(inviteName)
                                inviteName = ""
                            }
                        },
                        modifier = Modifier.background(Accent, RoundedCornerShape(8.dp)).size(52.dp)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = Color.Black)
                    }
                }
                
                Text("Current Members", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    members.forEach { member ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(BgObsidian, RoundedCornerShape(8.dp))
                                .padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.AccountCircle, contentDescription = null, tint = Accent)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(member.profile?.username ?: "User", color = Color.White)
                            }
                            IconButton(onClick = { onRemove(member.userId) }) {
                                Icon(Icons.Default.PersonRemove, contentDescription = null, tint = Color.Red.copy(alpha = 0.7f))
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("CLOSE", color = Accent)
            }
        }
    )
}

@Composable
fun QrDialog(
    doorName: String,
    qrUrl: String,
    onDismiss: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            colors = CardDefaults.cardColors(containerColor = BgElevated),
            shape = RoundedCornerShape(24.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(doorName, style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = null, tint = Color.White)
                    }
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Box(
                    modifier = Modifier
                        .size(240.dp)
                        .background(Color.White, RoundedCornerShape(16.dp))
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    val encodedUrl = URLEncoder.encode(qrUrl, StandardCharsets.UTF_8.toString())
                    AsyncImage(
                        model = "https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=$encodedUrl",
                        contentDescription = "Guest QR Code",
                        modifier = Modifier.fillMaxSize()
                    )
                }
                
                Spacer(modifier = Modifier.height(16.dp))
                Text("QR VAULT", style = MaterialTheme.typography.labelLarge, color = Color.White, letterSpacing = 4.sp)

                Spacer(modifier = Modifier.height(24.dp))

                // Share PNG (Batch M #13) — encrypts nothing, just packages
                // the door URL as a PNG and hands it to any installed app.
                Button(
                    onClick = {
                        com.hamburgbuzz.qrvault.util.ShareHelper.shareQrPng(context, doorName, qrUrl)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.Share, contentDescription = null, tint = Color.Black)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("SHARE QR", color = Color.Black, fontWeight = FontWeight.Bold)
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Export PDF (Batch P #15) — for printing a real sticker.
                OutlinedButton(
                    onClick = {
                        com.hamburgbuzz.qrvault.util.QrPdfExport.exportAndShare(
                            ctx = context,
                            entries = listOf(
                                com.hamburgbuzz.qrvault.util.QrPdfExport.Entry(
                                    label = doorName,
                                    url   = qrUrl,
                                    instructions = "Scan this code to ring the bell.",
                                ),
                            ),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A)),
                ) {
                    Icon(Icons.Default.PictureAsPdf, contentDescription = null, tint = Accent)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("EXPORT PDF", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
fun DoorCard(
    door: DoorPoint,
    onToggle: (Boolean) -> Unit,
    onDelete: () -> Unit,
    onShowQr: () -> Unit,
    onEdit: () -> Unit,
    onMembers: () -> Unit,
    onShowInfo: () -> Unit,
    onShowSecurity: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(if (door.isActive) 1f else 0.5f),
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(16.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A))
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.DoorSliding, contentDescription = null, tint = Accent, modifier = Modifier.size(24.dp))
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                door.name,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontSize = 16.sp,
                                textDecoration = if (door.isActive) null else TextDecoration.LineThrough
                            )
                            if (!door.description.isNullOrBlank()) {
                                IconButton(onClick = onShowInfo, modifier = Modifier.size(24.dp).padding(start = 4.dp)) {
                                    Icon(Icons.Default.Info, contentDescription = "Info", tint = Accent, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
                
                IconButton(onClick = { onToggle(!door.isActive) }) {
                    Icon(
                        imageVector = if (door.isActive) Icons.Default.PowerSettingsNew else Icons.Default.PowerOff,
                        contentDescription = "Toggle",
                        tint = if (door.isActive) Accent else TextSecondary,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            Divider(color = Color(0xFF27272A), thickness = 0.5.dp)
            Spacer(modifier = Modifier.height(12.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ActionBtn(icon = Icons.Default.QrCode, onClick = onShowQr, modifier = Modifier.weight(1f))
                ActionBtn(icon = Icons.Default.Group, onClick = onMembers, modifier = Modifier.weight(1f))
                ActionBtn(
                    icon = Icons.Outlined.Shield,
                    onClick = onShowSecurity,
                    modifier = Modifier.weight(1f),
                    // Highlight in amber when the door is unpinned (geofence inactive).
                    tint = if (door.latitude == null) Color(0xFFFCA5A5) else Accent
                )
                ActionBtn(icon = Icons.Default.Edit, onClick = onEdit, modifier = Modifier.weight(1f), tint = TextSecondary)
                ActionBtn(icon = Icons.Default.Delete, onClick = onDelete, modifier = Modifier.weight(0.5f), tint = Color.Red.copy(alpha = 0.7f))
            }

            // Subtle status line so the owner sees at a glance whether the
            // geofence is active and whether DND is currently in effect.
            val parts = mutableListOf<String>()
            if (door.latitude == null) parts += "⚠ Geofence not pinned"
            if (!door.dndUntil.isNullOrBlank()) parts += "● DND active"
            if (parts.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    parts.joinToString("  ·  "),
                    color = if (door.latitude == null) Color(0xFFFCA5A5) else TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
fun ActionBtn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Color.White
) {
    Surface(
        modifier = modifier
            .height(44.dp)
            .clickable { onClick() },
        color = Color.White.copy(alpha = 0.05f),
        shape = RoundedCornerShape(8.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.05f))
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        }
    }
}
