package com.hamburgbuzz.qrvault.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class DoorMember(
    val id: String,
    @SerialName("door_point_id")
    val doorPointId: String,
    @SerialName("house_id")
    val houseId: String? = null,
    @SerialName("user_id")
    val userId: String,
    @SerialName("is_muted")
    val isMuted: Boolean = false,
    @SerialName("created_at")
    val createdAt: String? = null,
    val profile: UserProfile? = null
)

@Serializable
data class UserProfile(
    val id: String,
    val username: String,
    @SerialName("avatar_url")
    val avatarUrl: String? = null
)
