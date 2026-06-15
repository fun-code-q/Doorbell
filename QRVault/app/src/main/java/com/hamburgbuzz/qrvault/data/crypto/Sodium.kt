package com.hamburgbuzz.qrvault.data.crypto

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.interfaces.Box
import com.goterl.lazysodium.interfaces.PwHash
import com.goterl.lazysodium.interfaces.SecretBox
import com.sun.jna.NativeLong
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Curve25519 / XSalsa20-Poly1305 sealed-box keypair store.
 *
 * Goal: a fresh public key is published to Supabase on first launch; the
 * matching private key never leaves the device. The guest browser pulls
 * the public key via the `resolve_qr_token` RPC and uses libsodium
 * `crypto_box_seal` (anonymous sender) to encrypt the message. The owner
 * app uses `crypto_box_seal_open` to decrypt.
 *
 * Why not Android Keystore EC keys directly?
 *   Keystore EC keys cannot do X25519 ECDH in a portable way pre-API 33.
 *   Storing the libsodium private key inside EncryptedSharedPreferences
 *   (which is AES-GCM-wrapped by a master key in the Android Keystore)
 *   gives us the same defence-at-rest with broader minSdk coverage.
 *
 * Crypto contract:
 *   * Ciphertext on the wire is base64(crypto_box_seal output)
 *   * Algorithm tag stored in owner_public_keys.algorithm = "x25519-xsalsa20-poly1305-sealed"
 *   * If a guest sends plaintext (legacy or geofenced low-stakes path),
 *     the encrypted flag in the FCM data is "false" and we skip decryption.
 */
@Singleton
class Sodium @Inject constructor(@ApplicationContext private val context: Context) {

    private val sodium: LazySodiumAndroid = LazySodiumAndroid(SodiumAndroid())

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            PREF_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Returns the existing keypair or generates a fresh one. Both keys are
     * persisted; only the public part is ever uploaded to the server.
     */
    fun keypair(): KeyPair {
        prefs.getString(KEY_PRIV, null)?.let { p ->
            val pub = prefs.getString(KEY_PUB, null)
            if (pub != null) return KeyPair(publicKey = pub, privateKey = p)
        }
        val pubBytes = ByteArray(Box.PUBLICKEYBYTES)
        val privBytes = ByteArray(Box.SECRETKEYBYTES)
        if (!sodium.cryptoBoxKeypair(pubBytes, privBytes)) {
            error("Failed to generate libsodium keypair")
        }
        val pub = Base64.encodeToString(pubBytes, Base64.NO_WRAP)
        val priv = Base64.encodeToString(privBytes, Base64.NO_WRAP)
        prefs.edit()
            .putString(KEY_PUB, pub)
            .putString(KEY_PRIV, priv)
            .apply()
        return KeyPair(publicKey = pub, privateKey = priv)
    }

    /**
     * Decrypts a sealed-box ciphertext. Returns null on any failure so the
     * caller can decide whether to render `[encrypted]` placeholder.
     */
    fun openSealed(ciphertextBase64: String): String? {
        return try {
            val kp = keypair()
            val cipher = Base64.decode(ciphertextBase64, Base64.DEFAULT)
            val pub = Base64.decode(kp.publicKey, Base64.DEFAULT)
            val priv = Base64.decode(kp.privateKey, Base64.DEFAULT)
            if (cipher.size <= Box.SEALBYTES) return null
            val out = ByteArray(cipher.size - Box.SEALBYTES)
            val ok = sodium.cryptoBoxSealOpen(out, cipher, cipher.size.toLong(), pub, priv)
            if (!ok) null else String(out, Charsets.UTF_8)
        } catch (t: Throwable) {
            null
        }
    }

    /**
     * One-shot wipe used on sign-out. Forces a new keypair on next launch,
     * which forces the guest UI to re-fetch a current key.
     */
    fun rotate() {
        prefs.edit().clear().apply()
    }

    /**
     * Overwrite the local keypair with a known one. Used when restoring
     * from an owner_keypair_backups blob after the user enters their
     * passphrase on a fresh device.
     */
    fun importKeyPair(publicKeyB64: String, privateKeyB64: String) {
        prefs.edit()
            .putString(KEY_PUB, publicKeyB64)
            .putString(KEY_PRIV, privateKeyB64)
            .apply()
    }

    data class KeyPair(val publicKey: String, val privateKey: String)

    // ---- Passphrase-wrapped backup (Batch A #2) ---------------------------

    /**
     * Wrap the device's libsodium private key with a key derived from the
     * supplied passphrase via Argon2id. Returns the parameters and the
     * sealed blob; everything except the passphrase is uploaded to Supabase.
     * The passphrase NEVER leaves the device.
     */
    fun wrapPrivateKeyForBackup(passphrase: CharArray): WrappedBackup {
        require(passphrase.isNotEmpty()) { "Passphrase required" }
        val kp = keypair()
        val priv = Base64.decode(kp.privateKey, Base64.DEFAULT)

        val salt = ByteArray(PwHash.ARGON2ID_SALTBYTES)
        SecureRandom().nextBytes(salt)
        val nonce = ByteArray(SecretBox.NONCEBYTES)
        SecureRandom().nextBytes(nonce)

        // Moderate cost: ~256 MiB of memory and ~1 s on a modern phone.
        // SENSITIVE (1 GiB) OOMs on entry-level devices; INTERACTIVE is
        // too cheap to resist a determined offline brute force on the
        // stolen-database scenario.
        val opsLimit: Long = PwHash.OPSLIMIT_MODERATE.toLong()
        val memLimitBytes: Long = PwHash.MEMLIMIT_MODERATE.toLong()
        val pwBytes = charsToUtf8(passphrase)

        val derived = ByteArray(SecretBox.KEYBYTES)
        try {
            val ok = sodium.cryptoPwHash(
                derived, derived.size,
                pwBytes, pwBytes.size,
                salt,
                opsLimit, NativeLong(memLimitBytes),
                PwHash.Alg.PWHASH_ALG_ARGON2ID13,
            )
            if (!ok) error("Argon2id derivation failed")

            val sealed = ByteArray(priv.size + SecretBox.MACBYTES)
            val sealOk = sodium.cryptoSecretBoxEasy(
                sealed, priv, priv.size.toLong(), nonce, derived
            )
            if (!sealOk) error("secretbox seal failed")

            return WrappedBackup(
                publicKeyB64           = kp.publicKey,
                kdfSaltB64             = Base64.encodeToString(salt, Base64.NO_WRAP),
                kdfOpsLimit            = opsLimit.toInt(),
                kdfMemLimitKib         = (memLimitBytes / 1024L).toInt(),
                secretboxNonceB64      = Base64.encodeToString(nonce, Base64.NO_WRAP),
                secretboxWrappedKeyB64 = Base64.encodeToString(sealed, Base64.NO_WRAP),
            )
        } finally {
            derived.fill(0)
            pwBytes.fill(0)
            priv.fill(0)
        }
    }

    /**
     * Reverse the above. Returns the recovered (public, private) keypair
     * or null if the passphrase is wrong (poly1305 auth tag mismatch).
     */
    fun unwrapBackup(
        passphrase: CharArray,
        publicKeyB64: String,
        kdfSaltB64: String,
        kdfOpsLimit: Int,
        kdfMemLimitKib: Int,
        secretboxNonceB64: String,
        secretboxWrappedKeyB64: String,
    ): KeyPair? {
        require(passphrase.isNotEmpty()) { "Passphrase required" }
        val salt   = Base64.decode(kdfSaltB64, Base64.DEFAULT)
        val nonce  = Base64.decode(secretboxNonceB64, Base64.DEFAULT)
        val sealed = Base64.decode(secretboxWrappedKeyB64, Base64.DEFAULT)

        val pwBytes = charsToUtf8(passphrase)
        val derived = ByteArray(SecretBox.KEYBYTES)
        return try {
            val ok = sodium.cryptoPwHash(
                derived, derived.size,
                pwBytes, pwBytes.size,
                salt,
                kdfOpsLimit.toLong(), NativeLong(kdfMemLimitKib.toLong() * 1024L),
                PwHash.Alg.PWHASH_ALG_ARGON2ID13,
            )
            if (!ok) return null

            val privOut = ByteArray(sealed.size - SecretBox.MACBYTES)
            val openOk = sodium.cryptoSecretBoxOpenEasy(
                privOut, sealed, sealed.size.toLong(), nonce, derived
            )
            if (!openOk) return null

            val privB64 = Base64.encodeToString(privOut, Base64.NO_WRAP)
            privOut.fill(0)
            KeyPair(publicKey = publicKeyB64, privateKey = privB64)
        } finally {
            derived.fill(0)
            pwBytes.fill(0)
        }
    }

    /**
     * Encode `chars` as UTF-8 bytes WITHOUT allocating an intermediate
     * String (which can't be zeroed). Caller is responsible for zeroing
     * both the input CharArray and the returned ByteArray when done.
     */
    private fun charsToUtf8(chars: CharArray): ByteArray {
        val cb = java.nio.CharBuffer.wrap(chars)
        val bb = Charsets.UTF_8.newEncoder().encode(cb)
        val out = ByteArray(bb.remaining())
        bb.get(out)
        return out
    }

    data class WrappedBackup(
        val publicKeyB64: String,
        val kdfSaltB64: String,
        val kdfOpsLimit: Int,
        val kdfMemLimitKib: Int,
        val secretboxNonceB64: String,
        val secretboxWrappedKeyB64: String,
    )

    private companion object {
        const val PREF_FILE = "qrvault.sodium"
        const val KEY_PUB = "x25519_pub_b64"
        const val KEY_PRIV = "x25519_priv_b64"
    }
}
