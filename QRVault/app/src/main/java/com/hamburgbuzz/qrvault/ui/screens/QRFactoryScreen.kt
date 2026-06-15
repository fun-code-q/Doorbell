package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.hamburgbuzz.qrvault.ui.theme.*
import com.hamburgbuzz.qrvault.ui.viewmodel.QRFactoryViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QRFactoryScreen(
    onNavigateBack: () -> Unit,
    viewModel: QRFactoryViewModel = hiltViewModel()
) {
    val doorPoints by viewModel.doorPoints.collectAsStateWithLifecycle()
    val selectedDoor by viewModel.selectedDoor.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    val context = LocalContext.current
    LaunchedEffect(error) {
        error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
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
                    title = { Text("QR FACTORY", fontWeight = FontWeight.Bold, letterSpacing = 1.sp) },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = Color.White)
                        }
                    },
                    actions = {
                        // Self-scan (Batch P #19) — verify what your printed
                        // sticker actually resolves to without opening a
                        // separate scanner app.
                        IconButton(onClick = {
                            val activity = (context as? android.app.Activity) ?: return@IconButton
                            com.hamburgbuzz.qrvault.util.QrSelfScan.scan(activity) { scanned ->
                                if (!scanned.isNullOrBlank()) {
                                    Toast.makeText(
                                        context,
                                        "Scanned: " + scanned.take(80),
                                        Toast.LENGTH_LONG,
                                    ).show()
                                }
                            }
                        }) {
                            Icon(Icons.Outlined.QrCodeScanner, contentDescription = "Scan a QR", tint = Accent)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = BgObsidian,
                        titleContentColor = Accent
                    )
                )
            }
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                Spacer(modifier = Modifier.height(8.dp))

                // Selection Header
                Column {
                    Text(
                        text = "SELECT A DOOR POINT",
                        style = MaterialTheme.typography.labelMedium,
                        color = Accent,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        items(doorPoints) { door ->
                            val active = selectedDoor?.id == door.id
                            Surface(
                                modifier = Modifier.clickable { viewModel.selectDoor(door) },
                                shape = RoundedCornerShape(12.dp),
                                color = if (active) Accent.copy(alpha = 0.1f) else BgElevated,
                                border = androidx.compose.foundation.BorderStroke(1.dp, if (active) Accent else Color(0xFF27272A))
                            ) {
                                Text(
                                    text = door.name,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                                    color = if (active) Accent else Color.White,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp
                                )
                            }
                        }
                    }
                }

                // QR Output
                if (selectedDoor != null) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = BgElevated),
                            shape = RoundedCornerShape(24.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A))
                        ) {
                            Column(
                                modifier = Modifier.padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Text(
                                    text = selectedDoor!!.name.uppercase(),
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = Accent,
                                    letterSpacing = 2.sp
                                )
                                Text(
                                    text = "Ready for Print",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondary
                                )
                                
                                Spacer(modifier = Modifier.height(24.dp))
                                
                                val guestUrl = viewModel.guestUrl(selectedDoor!!.qrToken)
                                val qrImageUrl = viewModel.qrImageUrl(guestUrl)
                                
                                Surface(
                                    modifier = Modifier.size(260.dp).padding(8.dp),
                                    shape = RoundedCornerShape(16.dp),
                                    color = Color.White
                                ) {
                                    AsyncImage(
                                        model = qrImageUrl,
                                        contentDescription = "QR Code",
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Fit
                                    )
                                }
                                
                                Spacer(modifier = Modifier.height(24.dp))
                                
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    // SAVE PNG — uses the same share helper which
                                    // produces a file the user can save from the
                                    // chooser; native gallery-save needs WRITE
                                    // permission we don't request.
                                    Button(
                                        onClick = {
                                            com.hamburgbuzz.qrvault.util.ShareHelper.shareQrPng(
                                                context, selectedDoor!!.name, guestUrl,
                                            )
                                        },
                                        modifier = Modifier.weight(1f),
                                        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color.Black),
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Icon(Icons.Default.Download, contentDescription = null)
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("SAVE PNG")
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            com.hamburgbuzz.qrvault.util.QrPdfExport.exportAndShare(
                                                ctx = context,
                                                entries = listOf(
                                                    com.hamburgbuzz.qrvault.util.QrPdfExport.Entry(
                                                        label = selectedDoor!!.name,
                                                        url = guestUrl,
                                                        instructions = "Scan this code to ring the bell.",
                                                    ),
                                                ),
                                            )
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A)),
                                    ) {
                                        Icon(Icons.Outlined.PictureAsPdf, contentDescription = null, tint = Accent)
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("PDF")
                                    }
                                    IconButton(
                                        onClick = {
                                            com.hamburgbuzz.qrvault.util.ShareHelper.shareText(
                                                context, selectedDoor!!.name, guestUrl,
                                            )
                                        },
                                        modifier = Modifier
                                            .size(48.dp)
                                            .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(12.dp))
                                    ) {
                                        Icon(Icons.Default.Share, contentDescription = "Share link", tint = Color.White)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Empty State
                    Column(
                        modifier = Modifier.fillMaxWidth().height(300.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Outlined.QrCode2, contentDescription = null, modifier = Modifier.size(64.dp), tint = Color(0xFF27272A))
                        Spacer(modifier = Modifier.height(16.dp))
                        Text("No door point selected", color = TextSecondary)
                        Text("Select a door above to generate its code", color = TextSecondary.copy(alpha = 0.6f), fontSize = 12.sp)
                    }
                }

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}
