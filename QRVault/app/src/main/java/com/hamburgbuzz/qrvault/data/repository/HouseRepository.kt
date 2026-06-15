package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

/**
 * House-scoped queries. Beyond `myHouseIds()` for the realtime filter
 * (Batch F #12) we now also expose:
 *   * listHouses() — the multi-house switcher's data (Batch N #9)
 *   * switchActiveHouse(id) — single RPC for the switch action
 */
@Singleton
class HouseRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    @Serializable
    private data class HouseIdRow(@SerialName("house_id") val houseId: String)

    @Serializable
    data class HouseSummary(
        val id: String,
        val name: String,
        @SerialName("is_active") val isActive: Boolean = true,
    )

    suspend fun myHouseIds(): Outcome<List<String>> = runCatchingOutcome {
        supabase.postgrest.rpc("list_my_house_ids")
            .decodeList<HouseIdRow>()
            .map { it.houseId }
    }

    /** All houses visible to the current user. Used by the switcher dropdown. */
    suspend fun listHouses(): Outcome<List<HouseSummary>> = runCatchingOutcome {
        supabase.from("houses").select().decodeList<HouseSummary>()
    }

    /** Atomically set the user's active_house_id. */
    suspend fun switchActiveHouse(houseId: String): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "switch_active_house",
            buildJsonObject { put("p_house_id", JsonPrimitive(houseId)) }
        )
        Unit
    }
}
