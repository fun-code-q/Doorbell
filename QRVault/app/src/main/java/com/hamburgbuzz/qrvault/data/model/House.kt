package com.hamburgbuzz.qrvault.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
data class House(
    val id: String,
    val name: String,
    @SerialName("is_active")
    val isActive: Boolean = true,
    @SerialName("owner_user_id")
    val ownerUserId: String,
    @SerialName("created_at")
    val createdAt: String
)
