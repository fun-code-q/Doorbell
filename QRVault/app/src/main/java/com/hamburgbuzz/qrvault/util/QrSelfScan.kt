package com.hamburgbuzz.qrvault.util

import android.app.Activity
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode

/**
 * Wraps Google's on-device Code Scanner (no app-side camera or UI code).
 * The system shows its own scanning surface; we just receive the result.
 *
 * Usage in Compose:
 *   val activity = LocalContext.current as Activity
 *   IconButton(onClick = { QrSelfScan.scan(activity, ::onResult) }) { ... }
 *
 * Returns the raw scanned value (URL or text), null if cancelled / failed.
 */
object QrSelfScan {

    fun scan(activity: Activity, onResult: (String?) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()   // Helpful when scanning a small QR sticker far away
            .build()
        val scanner: GmsBarcodeScanner = GmsBarcodeScanning.getClient(activity, options)
        val task: Task<Barcode> = scanner.startScan()
        task
            .addOnSuccessListener { onResult(it.rawValue) }
            .addOnCanceledListener { onResult(null) }
            .addOnFailureListener { onResult(null) }
    }
}
