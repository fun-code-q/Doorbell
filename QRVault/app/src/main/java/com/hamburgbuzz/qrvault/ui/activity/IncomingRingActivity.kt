package com.hamburgbuzz.qrvault.ui.activity

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.data.repository.RingRepository
import com.hamburgbuzz.qrvault.notification.RingNotifier
import com.hamburgbuzz.qrvault.service.RingForegroundService
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.BgSurface
import com.hamburgbuzz.qrvault.ui.theme.QRVaultTheme
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.theme.Typography
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Full-screen incoming-ring UI. Shows up over the lock screen via the
 * combination of `showWhenLocked + turnScreenOn` in the manifest plus the
 * NotificationCompat.CallStyle full-screen-intent that brought us here.
 *
 * Responsibilities:
 *   * Play the system ringtone for up to 45s (or until the user acts).
 *   * On Answer/Decline: ack the ring in Supabase, stop the foreground
 *     service, dismiss the heads-up notification.
 */
@AndroidEntryPoint
class IncomingRingActivity : ComponentActivity() {

    @Inject lateinit var rings: RingRepository
    @Inject lateinit var supabase: io.github.jan.supabase.SupabaseClient

    private var ringtone: Ringtone? = null
    private var mediaPlayer: MediaPlayer? = null
    private var toneSynth: com.hamburgbuzz.qrvault.util.ToneSynth? = null
    private var savedVolume: Int = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON,
        )

        val ringId = intent.getStringExtra(EXTRA_RING_ID) ?: run { finish(); return }
        val houseId = intent.getStringExtra(EXTRA_HOUSE_ID) ?: run { finish(); return }
        val doorLocation = intent.getStringExtra(EXTRA_DOOR_LOCATION)
            ?: getString(R.string.visitor_at_door)

        enableEdgeToEdge()
        startRinging()

        // Resolve quick replies: prefer the owner's custom list (Batch M #3),
        // fall back to the bundled localized defaults.
        val customReplies = com.hamburgbuzz.qrvault.util.QuickReplyCache.load(this)

        setContent {
            QRVaultTheme {
                IncomingRingScreen(
                    doorName = doorLocation,
                    guestMessage = null,
                    customQuickReplies = customReplies,
                    onAccept = { handleAnswer(ringId, houseId) },
                    onDecline = { handleDecline(ringId, houseId) },
                    onQuickReply = { templateText ->
                        com.hamburgbuzz.qrvault.worker.ReplyDispatchWorker.enqueue(
                            this@IncomingRingActivity,
                            ringId,
                            templateText,
                        )
                        handleAnswer(ringId, houseId)
                    },
                )
            }
        }

        // Auto-decline after 45s if neither button is pressed.
        lifecycleScope.launch {
            delay(45_000L)
            if (!isFinishing) handleDecline(ringId, houseId)
        }
    }

    private fun handleAnswer(ringId: String, houseId: String) {
        stopRinging()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager)
                .requestDismissKeyguard(this, null)
        }
        lifecycleScope.launch {
            rings.acknowledge(ringId)
            RingForegroundService.stop(this@IncomingRingActivity, ringId)
            RingNotifier.cancel(this@IncomingRingActivity, ringId)
            startActivity(
                Intent(this@IncomingRingActivity, com.hamburgbuzz.qrvault.MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    putExtra("deep_link_ring_id", ringId)
                }
            )
            finish()
        }
    }

    private fun handleDecline(ringId: String, houseId: String) {
        stopRinging()
        lifecycleScope.launch {
            rings.dismiss(ringId)
            RingForegroundService.stop(this@IncomingRingActivity, ringId)
            RingNotifier.cancel(this@IncomingRingActivity, ringId)
            finish()
        }
    }

    /**
     * Three-tier ringtone strategy:
     *   1. Try the bundled raw/doorbell_ring.ogg — guaranteed audible
     *      because we ship it; doesn't depend on the user's system
     *      ringtone or DND state.
     *   2. Fall back to the system default ringtone (may be silent if
     *      the user muted system ringtone).
     *   3. As a last resort, force the ring volume up briefly so the
     *      doorbell is audible even on devices in silent ringer mode.
     *
     * MediaPlayer with USAGE_NOTIFICATION_RINGTONE lets the stream
     * survive lock-screen audio policies the way Ringtone alone doesn't.
     */
    private fun startRinging() {
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        // Tier 0: per-door ringtone identifier (Batch M #4). Owner picked
        // a sound for this specific door — that wins.
        val custom = intent.getStringExtra(EXTRA_RINGTONE_RESOURCE)
        if (!custom.isNullOrBlank()) {
            when {
                custom.startsWith("bundled:") -> {
                    val name = "doorbell_${custom.removePrefix("bundled:")}"
                    val id = resources.getIdentifier(name, "raw", packageName)
                    if (id != 0 && playRawLooping(attrs, id)) {
                        bumpRingerVolumeIfNeeded(); return
                    }
                }
                custom == "system:default" -> {
                    if (playSystemDefault(attrs)) { bumpRingerVolumeIfNeeded(); return }
                }
            }
        }

        // Tier 1: bundled doorbell_ring resource.
        val bundled = resources.getIdentifier("doorbell_ring", "raw", packageName)
        if (bundled != 0 && playRawLooping(attrs, bundled)) {
            bumpRingerVolumeIfNeeded(); return
        }

        // Tier 2: system default ringtone.
        if (playSystemDefault(attrs)) {
            bumpRingerVolumeIfNeeded(); return
        }

        // Tier 3 (last resort): synthesize a westminster ding-dong with
        // AudioTrack. Always works — no asset, no system ringtone needed.
        // This guarantees we make sound on a stripped device even if a
        // power user removed every system tone.
        toneSynth = com.hamburgbuzz.qrvault.util.ToneSynth().also {
            if (it.start(attrs)) bumpRingerVolumeIfNeeded()
        }
    }

    private fun playRawLooping(attrs: AudioAttributes, rawId: Int): Boolean {
        return try {
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(attrs)
                setDataSource(
                    applicationContext,
                    Uri.parse("android.resource://$packageName/$rawId"),
                )
                isLooping = true
                setOnPreparedListener { start() }
                prepareAsync()
            }
            true
        } catch (_: Throwable) {
            mediaPlayer?.release(); mediaPlayer = null
            false
        }
    }

    private fun playSystemDefault(attrs: AudioAttributes): Boolean = try {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ringtone = RingtoneManager.getRingtone(applicationContext, uri).apply {
            audioAttributes = attrs
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
            play()
        }
        true
    } catch (_: Throwable) { false }

    /**
     * Force a minimum audible volume on STREAM_RING for the duration of
     * the ring. The original volume is restored in stopRinging().
     * We only bump UP, never down — never lower someone's volume.
     */
    private fun bumpRingerVolumeIfNeeded() {
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val cur = am.getStreamVolume(AudioManager.STREAM_RING)
            val max = am.getStreamMaxVolume(AudioManager.STREAM_RING)
            val target = (max * 0.6f).toInt().coerceAtLeast(1)
            if (cur < target) {
                savedVolume = cur
                am.setStreamVolume(AudioManager.STREAM_RING, target, 0)
            }
        } catch (_: Throwable) { /* ignore — best-effort */ }
    }

    private fun stopRinging() {
        ringtone?.runCatching { stop() }
        ringtone = null
        mediaPlayer?.runCatching { stop(); release() }
        mediaPlayer = null
        toneSynth?.runCatching { stop() }
        toneSynth = null
        if (savedVolume >= 0) {
            try {
                (getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                    .setStreamVolume(AudioManager.STREAM_RING, savedVolume, 0)
            } catch (_: Throwable) {}
            savedVolume = -1
        }
    }

    override fun onDestroy() {
        stopRinging()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RING_ID            = "ring_id"
        const val EXTRA_HOUSE_ID           = "house_id"
        const val EXTRA_DOOR_POINT_ID      = "door_point_id"
        const val EXTRA_DOOR_LOCATION      = "door_location"
        /** Per-door ringtone identifier (Batch M #4). See OwnerSettings docs. */
        const val EXTRA_RINGTONE_RESOURCE  = "ringtone_resource"
    }
}

@Composable
private fun IncomingRingScreen(
    doorName: String,
    guestMessage: String?,
    customQuickReplies: List<String>? = null,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onQuickReply: (String) -> Unit = {},
) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val bundledQuickReplyKeys = listOf(
        R.string.quick_reply_coming,
        R.string.quick_reply_leave_at_door,
        R.string.quick_reply_busy_call_back,
    )
    // Use the owner's custom list when present, falling back to the
    // bundled localized defaults. Cap at 3 visible buttons regardless.
    val resolvedQuickReplies: List<String> =
        customQuickReplies?.take(3)
            ?: bundledQuickReplyKeys.map { ctx.getString(it) }
    val pulse = rememberInfiniteTransition(label = "PulseTransition")
    val scale by pulse.animateFloat(
        initialValue = 1f,
        targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "PulseScale",
    )
    val alpha by pulse.animateFloat(
        initialValue = 0.3f,
        targetValue = 0.1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "PulseAlpha",
    )

    Surface(modifier = Modifier.fillMaxSize(), color = BgObsidian) {
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Spacer(modifier = Modifier.height(64.dp))

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "INCOMING VISIT",
                    style = MaterialTheme.typography.labelLarge,
                    color = Accent,
                    letterSpacing = 4.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = doorName.uppercase(),
                    style = MaterialTheme.typography.headlineLarge,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(top = 16.dp),
                )
                if (!guestMessage.isNullOrBlank()) {
                    Text(
                        text = "\"$guestMessage\"",
                        style = MaterialTheme.typography.bodyLarge,
                        fontStyle = FontStyle.Italic,
                        color = TextSecondary,
                        modifier = Modifier.padding(top = 16.dp),
                        textAlign = TextAlign.Center,
                    )
                }
            }

            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(280.dp)) {
                Box(
                    modifier = Modifier
                        .size(240.dp)
                        .scale(scale * 1.1f)
                        .background(Accent.copy(alpha = alpha / 2), CircleShape),
                )
                Box(
                    modifier = Modifier
                        .size(200.dp)
                        .scale(scale)
                        .background(Accent.copy(alpha = alpha), CircleShape),
                )
                Surface(
                    shape = CircleShape,
                    color = BgSurface,
                    border = BorderStroke(2.dp, Accent.copy(alpha = 0.5f)),
                    modifier = Modifier.size(140.dp),
                ) {
                    androidx.compose.foundation.Image(
                        painter = painterResource(id = R.drawable.app_icon),
                        contentDescription = null,
                        modifier = Modifier.padding(24.dp).fillMaxSize(),
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                    )
                }
            }

            Column(
                modifier = Modifier.fillMaxWidth().padding(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Quick replies: owner-customised first, fall back to bundled.
                resolvedQuickReplies.forEach { text ->
                    OutlinedButton(
                        onClick = { onQuickReply(text) },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = Accent, containerColor = Color.Transparent,
                        ),
                        border = BorderStroke(1.dp, Accent.copy(alpha = 0.4f)),
                    ) {
                        Text(
                            text = text,
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                            maxLines = 1,
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    OutlinedButton(
                        onClick = onDecline,
                        modifier = Modifier.weight(1f).height(64.dp),
                        shape = RoundedCornerShape(20.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = TextPrimary, containerColor = Color.Transparent,
                        ),
                        border = BorderStroke(1.dp, Color(0xFF27272A)),
                    ) {
                        Icon(Icons.Rounded.CallEnd, contentDescription = stringResource(R.string.decline_ring), tint = Color.Red)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = stringResource(R.string.decline_ring),
                            style = Typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        )
                    }
                    Button(
                        onClick = onAccept,
                        modifier = Modifier.weight(1f).height(64.dp),
                        shape = RoundedCornerShape(20.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = BgObsidian),
                    ) {
                        Icon(Icons.Rounded.Call, contentDescription = stringResource(R.string.accept_ring))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = stringResource(R.string.accept_ring),
                            style = Typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        )
                    }
                }
            }
        }
    }
}
