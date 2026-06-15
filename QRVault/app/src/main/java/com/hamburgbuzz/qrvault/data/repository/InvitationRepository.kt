package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class InvitationRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    @Serializable
    data class PendingInvitation(
        val id: String,
        @SerialName("house_id") val houseId: String,
        @SerialName("house_name") val houseName: String,
        @SerialName("invited_by") val invitedBy: String,
        @SerialName("invited_by_username") val invitedByUsername: String? = null,
        val role: String,
        @SerialName("expires_at") val expiresAt: String,
        @SerialName("created_at") val createdAt: String,
    )

    @Serializable
    data class CreatedInvite(
        val id: String,
        @SerialName("invited_email") val invitedEmail: String,
        val status: String,
        @SerialName("expires_at") val expiresAt: String,
    )

    suspend fun listPendingForMe(): Outcome<List<PendingInvitation>> = runCatchingOutcome {
        supabase.postgrest.rpc("list_pending_invitations_for_me").decodeList<PendingInvitation>()
    }

    suspend fun invite(houseId: String, email: String, role: String = "manager"): Outcome<CreatedInvite> = runCatchingOutcome {
        val r = supabase.postgrest.rpc(
            "create_house_invitation",
            buildJsonObject {
                put("p_house_id", JsonPrimitive(houseId))
                put("p_email",    JsonPrimitive(email))
                put("p_role",     JsonPrimitive(role))
            }
        )
        r.decodeList<CreatedInvite>().firstOrNull() ?: error("create_house_invitation returned no row")
    }

    suspend fun accept(invitationId: String): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "accept_house_invitation",
            buildJsonObject { put("p_invitation_id", JsonPrimitive(invitationId)) }
        )
        Unit
    }

    suspend fun decline(invitationId: String): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "decline_house_invitation",
            buildJsonObject { put("p_invitation_id", JsonPrimitive(invitationId)) }
        )
        Unit
    }
}
