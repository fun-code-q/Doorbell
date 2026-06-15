package com.hamburgbuzz.qrvault.util

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/**
 * Generates a printable PDF of one or more door QR codes (Batch P #15).
 * Each page is A4 portrait with one QR centred above the door label,
 * cut marks at the corners for the print shop, and a small instruction
 * line at the bottom so anyone who picks up the printout knows what to
 * do with it.
 *
 * Output goes into the cache/qr-pdfs/ directory and is shared via the
 * same FileProvider authority as the share-PNG path. Files are cleaned
 * up by Android's normal cache-eviction policy.
 */
object QrPdfExport {

    /** A4 at 72 dpi → 595 × 842 points (PDF native unit). */
    private const val PAGE_W = 595
    private const val PAGE_H = 842
    private const val MARGIN = 36   // 0.5"
    private const val QR_SIZE = 360 // ~5"

    data class Entry(val label: String, val url: String, val instructions: String?)

    fun exportAndShare(ctx: Context, entries: List<Entry>): Boolean {
        if (entries.isEmpty()) return false
        return try {
                val doc = PdfDocument()
            entries.forEachIndexed { idx, entry ->
                val info = PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, idx + 1).create()
                val page = doc.startPage(info)
                drawPage(page.canvas, entry)
                doc.finishPage(page)
            }
            val dir = File(ctx.cacheDir, "qr-pdfs").apply { mkdirs() }
            val file = File(dir, "qr-${System.currentTimeMillis()}.pdf")
            FileOutputStream(file).use { doc.writeTo(it) }
            doc.close()

            val uri = FileProvider.getUriForFile(
                ctx,
                "${ctx.packageName}.fileprovider",
                file,
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "Door QR codes")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(Intent.createChooser(send, "Export QR PDF").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun drawPage(canvas: Canvas, entry: Entry) {
        canvas.drawColor(Color.WHITE)

        // Cut marks
        val cut = Paint().apply {
            color = Color.LTGRAY
            style = Paint.Style.STROKE
            strokeWidth = 0.5f
        }
        val len = 14f
        // Four corners.
        canvas.drawLine(MARGIN.toFloat(),               MARGIN.toFloat(), MARGIN + len,             MARGIN.toFloat(), cut)
        canvas.drawLine(MARGIN.toFloat(),               MARGIN.toFloat(), MARGIN.toFloat(),         MARGIN + len, cut)
        canvas.drawLine((PAGE_W - MARGIN).toFloat(),    MARGIN.toFloat(), (PAGE_W - MARGIN - len).toFloat(), MARGIN.toFloat(), cut)
        canvas.drawLine((PAGE_W - MARGIN).toFloat(),    MARGIN.toFloat(), (PAGE_W - MARGIN).toFloat(),      MARGIN + len, cut)
        canvas.drawLine(MARGIN.toFloat(),               (PAGE_H - MARGIN).toFloat(), MARGIN + len, (PAGE_H - MARGIN).toFloat(), cut)
        canvas.drawLine(MARGIN.toFloat(),               (PAGE_H - MARGIN).toFloat(), MARGIN.toFloat(),      (PAGE_H - MARGIN - len).toFloat(), cut)
        canvas.drawLine((PAGE_W - MARGIN).toFloat(),    (PAGE_H - MARGIN).toFloat(), (PAGE_W - MARGIN - len).toFloat(), (PAGE_H - MARGIN).toFloat(), cut)
        canvas.drawLine((PAGE_W - MARGIN).toFloat(),    (PAGE_H - MARGIN).toFloat(), (PAGE_W - MARGIN).toFloat(),       (PAGE_H - MARGIN - len).toFloat(), cut)

        // QR (rendered via ShareHelper's pure-Kotlin renderer).
        val qr = ShareHelper.renderQrBitmap(entry.url, sizePx = QR_SIZE)
        val left = (PAGE_W - QR_SIZE) / 2
        val top  = 160
        canvas.drawBitmap(qr, null, Rect(left, top, left + QR_SIZE, top + QR_SIZE), null)

        // Title
        val title = Paint().apply {
            color = Color.BLACK
            textAlign = Paint.Align.CENTER
            textSize = 28f
            isAntiAlias = true
            isFakeBoldText = true
        }
        canvas.drawText(entry.label, (PAGE_W / 2).toFloat(), 110f, title)

        // Instruction text
        val sub = Paint().apply {
            color = Color.DKGRAY
            textAlign = Paint.Align.CENTER
            textSize = 14f
            isAntiAlias = true
        }
        val line = entry.instructions ?: "Scan this code to ring the bell."
        canvas.drawText(line, (PAGE_W / 2).toFloat(), (top + QR_SIZE + 40).toFloat(), sub)
        canvas.drawText("Powered by QR Doorbell", (PAGE_W / 2).toFloat(), (PAGE_H - MARGIN - 12).toFloat(), sub)
    }
}
