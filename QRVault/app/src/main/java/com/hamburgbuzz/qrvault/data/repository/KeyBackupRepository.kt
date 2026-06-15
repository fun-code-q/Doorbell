package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.data.crypto.Sodium
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Passphrase-wrapped private-key backups. The cipher contract:
 *   * Wrapping key = Argon2id(passphrase, salt, ops, mem)  (32 bytes)
 *   * Wrapped blob = crypto_secretbox(privkey, nonce, wrapping_key)
 *
 * The passphrase NEVER leaves the device. Only Argon2id parameters +
 * salt + nonce + ciphertext are uploaded. An attacker who steals the
 * row still has to brute-force the passphrase against Argon2id
 * (sensitive cost: ~1 GiB RAM, ~3 s per attempt on modern hardware).
 */
@Singleton
class KeyBackupRepository @Inject constructor(
    private val supabase: SupabaseClient,
    private val sodium: Sodium,
) {

    @Serializable
    data class Backup(
        val id: String? = null,
        @SerialName("house_id")            val houseId: String,
        @SerialName("public_key")          val publicKey: String,
        @SerialName("algorithm")           val algorithm: String = "argon2id+secretbox",
        @SerialName("kdf_salt_b64")        val kdfSaltB64: String,
        @SerialName("kdf_ops_limit")       val kdfOpsLimit: Int,
        @SerialName("kdf_mem_limit_kib")   val kdfMemLimitKib: Int,
        @SerialName("secretbox_nonce_b64") val secretboxNonceB64: String,
        @SerialName("secretbox_wrapped_key_b64") val secretboxWrappedKeyB64: String,
        @SerialName("device_label")        val deviceLabel: String? = null,
        @SerialName("created_at")          val createdAt: String? = null,
    )

    /**
     * Wrap the local device's private key with `passphrase` and upload.
     * Caller is responsible for zeroing the passphrase char[] after.
     */
    suspend fun publishBackup(
        houseId: String,
        passphrase: CharArray,
        deviceLabel: String? = null,
    ): Outcome<Unit> = runCatchingOutcome {
        val wrap = sodium.wrapPrivateKeyForBackup(passphrase)
        val row = Backup(
            houseId = houseId,
            publicKey = wrap.publicKeyB64,
            kdfSaltB64 = wrap.kdfSaltB64,
            kdfOpsLimit = wrap.kdfOpsLimit,
            kdfMemLimitKib = wrap.kdfMemLimitKib,
            secretboxNonceB64 = wrap.secretboxNonceB64,
            secretboxWrappedKeyB64 = wrap.secretboxWrappedKeyB64,
            deviceLabel = deviceLabel,
        )
        supabase.from("owner_keypair_backups").upsert(row) {
            onConflict = "user_id,house_id,public_key"
        }
        Unit
    }

    /** All backups visible to the current user (across all their houses). */
    suspend fun listBackups(): Outcome<List<Backup>> = runCatchingOutcome {
        supabase.postgrest.rpc("list_keypair_backups").decodeList<Backup>()
    }

    /**
     * Try to unwrap the supplied backup with `passphrase`. On success
     * we import the keypair into local storage so subsequent rings
     * decrypt with this key. Returns the new public key on success.
     */
    suspend fun restoreFromBackup(
        backup: Backup,
        passphrase: CharArray,
    ): Outcome<String> = runCatchingOutcome {
        val kp = sodium.unwrapBackup(
            passphrase = passphrase,
            publicKeyB64 = backup.publicKey,
            kdfSaltB64 = backup.kdfSaltB64,
            kdfOpsLimit = backup.kdfOpsLimit,
            kdfMemLimitKib = backup.kdfMemLimitKib,
            secretboxNonceB64 = backup.secretboxNonceB64,
            secretboxWrappedKeyB64 = backup.secretboxWrappedKeyB64,
        ) ?: error("Wrong passphrase or corrupted backup")
        sodium.importKeyPair(kp.publicKey, kp.privateKey)
        kp.publicKey
    }
}
