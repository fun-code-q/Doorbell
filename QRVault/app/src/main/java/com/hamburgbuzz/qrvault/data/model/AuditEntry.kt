package com.hamburgbuzz.qrvault.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
data class AuditEntry(
    val id: String,
    @SerialName("house_id")
    val houseId: String,
    val action: String,
    val entity: String? = null,
    val details: String? = null,
    @SerialName("created_at")
    val createdAt: String
)
