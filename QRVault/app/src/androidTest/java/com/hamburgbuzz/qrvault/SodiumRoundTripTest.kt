package com.hamburgbuzz.qrvault

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hamburgbuzz.qrvault.data.crypto.Sodium
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumentation test for the libsodium pipeline. We exercise the full
 * round-trip the production code uses:
 *   * generate keypair (or reuse cached)
 *   * seal a plaintext via crypto_box_seal to our own pubkey
 *   * decrypt it with openSealed
 * Plus the backup wrap/unwrap path with a passphrase.
 *
 * Requires a connected device or emulator (NDK libsodium binaries).
 */
@RunWith(AndroidJUnit4::class)
class SodiumRoundTripTest {

    private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun seal_then_open_decrypts_back_to_original() {
        val sodium = Sodium(context)
        sodium.rotate()  // start from a clean slate
        val kp = sodium.keypair()
        assertNotNull(kp.publicKey)
        assertNotNull(kp.privateKey)

        val pt = "Hello at the door 🚪"
        val ct = sealUsingSodiumJs(sodium, pt, kp.publicKey)
        val opened = sodium.openSealed(ct)
        assertEquals(pt, opened)
    }

    @Test
    fun openSealed_returns_null_for_garbage() {
        val sodium = Sodium(context)
        sodium.rotate()
        val garbage = android.util.Base64.encodeToString(
            ByteArray(48) { 0 }, android.util.Base64.NO_WRAP,
        )
        assertNull(sodium.openSealed(garbage))
    }

    @Test
    fun wrap_then_unwrap_recovers_keypair() {
        val sodium = Sodium(context)
        sodium.rotate()
        val kp = sodium.keypair()
        val passphrase = "correct horse battery staple".toCharArray()
        val backup = sodium.wrapPrivateKeyForBackup(passphrase.copyOf())
        sodium.rotate()  // pretend the device was wiped
        val recovered = sodium.unwrapBackup(
            passphrase = passphrase,
            publicKeyB64 = backup.publicKeyB64,
            kdfSaltB64 = backup.kdfSaltB64,
            kdfOpsLimit = backup.kdfOpsLimit,
            kdfMemLimitKib = backup.kdfMemLimitKib,
            secretboxNonceB64 = backup.secretboxNonceB64,
            secretboxWrappedKeyB64 = backup.secretboxWrappedKeyB64,
        )
        assertNotNull(recovered)
        assertEquals(kp.publicKey, recovered!!.publicKey)
        assertEquals(kp.privateKey, recovered.privateKey)
    }

    @Test
    fun wrap_then_unwrap_fails_with_wrong_passphrase() {
        val sodium = Sodium(context)
        sodium.rotate()
        sodium.keypair()
        val backup = sodium.wrapPrivateKeyForBackup("right".toCharArray())
        val recovered = sodium.unwrapBackup(
            passphrase = "wrong".toCharArray(),
            publicKeyB64 = backup.publicKeyB64,
            kdfSaltB64 = backup.kdfSaltB64,
            kdfOpsLimit = backup.kdfOpsLimit,
            kdfMemLimitKib = backup.kdfMemLimitKib,
            secretboxNonceB64 = backup.secretboxNonceB64,
            secretboxWrappedKeyB64 = backup.secretboxWrappedKeyB64,
        )
        assertNull(recovered)
    }

    /**
     * Helper: seal a plaintext to the device's own public key using the same
     * libsodium primitive the guest browser uses (crypto_box_seal). Returns
     * base64 ciphertext.
     */
    private fun sealUsingSodiumJs(sodium: Sodium, plaintext: String, pubB64: String): String {
        // Reach inside via the LazySodium binding directly. Acceptable in a
        // test where we already trust the library.
        val lazy = com.goterl.lazysodium.LazySodiumAndroid(com.goterl.lazysodium.SodiumAndroid())
        val pub = android.util.Base64.decode(pubB64, android.util.Base64.DEFAULT)
        val pt = plaintext.toByteArray(Charsets.UTF_8)
        val out = ByteArray(pt.size + com.goterl.lazysodium.interfaces.Box.SEALBYTES)
        lazy.cryptoBoxSeal(out, pt, pt.size.toLong(), pub)
        return android.util.Base64.encodeToString(out, android.util.Base64.NO_WRAP)
    }
}
