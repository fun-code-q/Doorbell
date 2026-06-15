package com.hamburgbuzz.qrvault.util

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import androidx.core.content.FileProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.File
import java.io.FileOutputStream

/**
 * System-share for door QR codes (Batch M #13).
 *
 * shareText() — share just the guest URL (WhatsApp/SMS/email).
 * shareQrPng() — generate a 768×768 PNG of the QR and share it via the
 *                FileProvider so any app can receive it.
 *
 * We render the QR with ZXing locally so the PDF / share / save paths
 * don't depend on the external qrserver.com API (which we still use
 * for the in-app preview because it's smaller). The local renderer
 * is also what the print-to-PDF (#15) path uses.
 */
object ShareHelper {

    fun shareText(ctx: Context, label: String, url: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, label)
            putExtra(Intent.EXTRA_TEXT, "$label\n$url")
        }
        ctx.startActivity(Intent.createChooser(send, "Share door link").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    fun renderQrBitmap(content: String, sizePx: Int = 768, marginModules: Int = 4): Bitmap {
        val hints = mapOf(
            com.google.zxing.EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            com.google.zxing.EncodeHintType.MARGIN to marginModules,
            com.google.zxing.EncodeHintType.CHARACTER_SET to "UTF-8",
        )
        val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        for (y in 0 until sizePx) {
            for (x in 0 until sizePx) {
                bmp.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
            }
        }
        return bmp
    }

    fun shareQrPng(ctx: Context, label: String, url: String): Boolean = try {
        val bmp = renderQrBitmap(url)
        val dir = File(ctx.cacheDir, "qr-shares").apply { mkdirs() }
        val file = File(dir, "qr-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { out ->
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
        val uri = FileProvider.getUriForFile(
            ctx,
            "${ctx.packageName}.fileprovider",
            file,
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_SUBJECT, label)
            putExtra(Intent.EXTRA_TEXT, "$label\n$url")
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(send, "Share door QR").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
        true
    } catch (_: Throwable) { false }
}
