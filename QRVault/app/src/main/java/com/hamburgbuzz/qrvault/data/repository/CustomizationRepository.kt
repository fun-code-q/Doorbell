package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owner-side personalisation RPCs (Batch M).
 *
 * Centralised here because none of the existing repositories owns the
 * cross-cutting "this is who I am / what my doors sound like / what
 * my guests see" surface. Cheap to combine because the four endpoints
 * never grow into a domain of their own.
 */
@Singleton
class CustomizationRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    /** Up to 5 entries; null clears and reverts to bundled defaults. */
    suspend fun setQuickReplies(replies: List<String>?): Outcome<Unit> = runCatchingOutcome {
        val arr = if (replies == null) null else buildJsonArray {
            replies.take(5).forEach { add(JsonPrimitive(it.trim().take(200))) }
        }
        supabase.postgrest.rpc(
            "set_quick_replies",
            buildJsonObject {
                if (arr == null) put("p_replies", kotlinx.serialization.json.JsonNull)
                else put("p_replies", arr)
            }
        )
        Unit
    }

    /**
     * Per-door ringtone identifier (`bundled:<name>` or `system:default` or null).
     * Null reverts to the bundled default.
     */
    suspend fun setDoorRingtone(doorPointId: String, ringtone: String?): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "set_door_ringtone",
            buildJsonObject {
                put("p_door_point_id", JsonPrimitive(doorPointId))
                if (ringtone == null) put("p_ringtone", kotlinx.serialization.json.JsonNull)
                else put("p_ringtone", JsonPrimitive(ringtone))
            }
        )
        Unit
    }

    suspend fun setDisplayName(name: String?): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "set_profile_display_name",
            buildJsonObject {
                if (name == null) put("p_name", kotlinx.serialization.json.JsonNull)
                else put("p_name", JsonPrimitive(name))
            }
        )
        Unit
    }

    suspend fun setHouseWelcome(houseId: String, welcome: String?): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "set_house_welcome",
            buildJsonObject {
                put("p_house_id", JsonPrimitive(houseId))
                if (welcome == null) put("p_welcome", kotlinx.serialization.json.JsonNull)
                else put("p_welcome", JsonPrimitive(welcome))
            }
        )
        Unit
    }
}
