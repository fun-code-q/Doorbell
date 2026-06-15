package com.hamburgbuzz.qrvault.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Ring(
    val id: String,
    @SerialName("house_id")
    val houseId: String,
    @SerialName("door_point_id")
    val doorPointId: String? = null,
    @SerialName("door_location")
    val doorLocation: String,
    @SerialName("guest_message")
    val guestMessage: String? = null,
    @SerialName("guest_message_encrypted")
    val guestMessageEncrypted: Boolean? = false,
    /**
     * One ciphertext per active owner public key, written by the guest at
     * ring time. The owner app iterates these and uses its own private key
     * to decrypt the one addressed to it. Falls back to `guestMessage`
     * for backwards-compatibility with older rings.
     */
    @SerialName("guest_message_ciphertexts")
    val guestMessageCiphertexts: List<String>? = null,
    @SerialName("owner_reply")
    val ownerReply: String? = null,
    @SerialName("chat_history")
    val chatHistory: List<ChatMessage>? = null,
    val status: String,
    @SerialName("created_at")
    val createdAt: String,
    @SerialName("replied_at")
    val repliedAt: String? = null,
    @SerialName("guest_latitude")
    val guestLatitude: Double? = null,
    @SerialName("guest_longitude")
    val guestLongitude: Double? = null,
)

@Serializable
data class ChatMessage(
    val role: String,
    val text: String,
    val time: String,
    val encrypted: Boolean? = false,
    /**
     * Multi-recipient ciphertexts attached to a guest message in the
     * chat_history JSON. Same semantics as Ring.guestMessageCiphertexts.
     */
    val ciphertexts: List<String>? = null,
)
