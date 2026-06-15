package com.hamburgbuzz.qrvault.util

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * Last-resort doorbell synthesizer. Used by IncomingRingActivity when
 * neither the bundled `doorbell_*` raw resources nor the system ringtone
 * are playable — guarantees we make *some* sound even on a stripped-down
 * device with no media files and a muted system ringer (we can't bump a
 * stream that has nothing to play).
 *
 * The tone is a westminster-style "ding-dong" — a D5 (587 Hz) followed
 * by a Bb4 (466 Hz), each shaped with a fast attack and exponential
 * decay so it doesn't sound like a square-wave alarm clock. We loop
 * forever via a dedicated AudioTrack on a background thread; the caller
 * stops it by calling stop().
 */
class ToneSynth {

    private var track: AudioTrack? = null
    @Volatile private var stopped = false
    private var feeder: Thread? = null

    /** Start playing the doorbell ding-dong on a loop. Idempotent. */
    fun start(attrs: AudioAttributes): Boolean {
        if (track != null) return true
        stopped = false
        return try {
            val sampleRate = 44_100
            val bufferSize = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            ).coerceAtLeast(4_096)

            val cycle = buildCycle(sampleRate)

            track = AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            track?.play()
            feeder = Thread {
                while (!stopped) {
                    val written = track?.write(cycle, 0, cycle.size, AudioTrack.WRITE_BLOCKING)
                        ?: break
                    if (written < 0) break // device gone, stop quietly
                }
            }.apply { isDaemon = true; name = "ToneSynth-Feeder"; start() }
            true
        } catch (_: Throwable) {
            stop()
            false
        }
    }

    fun stop() {
        stopped = true
        feeder?.runCatching { interrupt() }
        feeder = null
        track?.runCatching { stop() }
        track?.runCatching { release() }
        track = null
    }

    private fun buildCycle(sampleRate: Int): ShortArray {
        // Two notes ~ 0.4 s each + 0.7 s silence between cycles.
        val notes = listOf(587.33 /* D5 */, 466.16 /* Bb4 */)
        val noteSec = 0.40
        val silenceSec = 0.70
        val noteSamples = (sampleRate * noteSec).toInt()
        val silenceSamples = (sampleRate * silenceSec).toInt()
        val out = ShortArray(noteSamples * notes.size + silenceSamples)

        var off = 0
        notes.forEach { freq ->
            for (i in 0 until noteSamples) {
                val t = i.toDouble() / sampleRate
                // Exponential decay envelope, attack ~5 ms.
                val attack = (t / 0.005).coerceAtMost(1.0)
                val decay = exp(-6.0 * t)
                val sample = sin(2.0 * PI * freq * t) * attack * decay
                // Mix in a soft third-harmonic for warmth (bell-like).
                val warm = 0.15 * sin(2.0 * PI * (freq * 3) * t) * attack * decay
                val v = ((sample + warm) * 0.45 * Short.MAX_VALUE).toInt()
                out[off++] = v.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
            }
        }
        // Trailing silence is already zero-filled by ShortArray.
        return out
    }

    companion object {
        /** Convenience: build attributes that wake the lock screen. */
        fun defaultAttrs(): AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setLegacyStreamType(AudioManager.STREAM_RING)
            .build()
    }
}
