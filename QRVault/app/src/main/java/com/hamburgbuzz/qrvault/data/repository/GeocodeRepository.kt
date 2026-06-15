package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.BuildConfig
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Forward-geocoding via the `geocode-address` Edge Function (Batch N #2).
 * The owner can type an address ("Reeperbahn 1, Hamburg") and we get
 * lat/lon to pre-fill the geofence pin without walking to the door.
 *
 * Uses the Supabase client's already-configured Ktor HTTP client so the
 * Authorization header (the user's JWT) is attached automatically.
 */
@Singleton
class GeocodeRepository @Inject constructor(
    private val supabase: SupabaseClient,
    private val http: HttpClient,
) {

    @Serializable
    data class GeocodeResult(
        val latitude: Double,
        val longitude: Double,
        @SerialName("display_name") val displayName: String? = null,
        val confidence: Double? = null,
        val cached: Boolean = false,
    )

    @Serializable
    private data class GeocodeRequest(
        val address: String,
        @SerialName("country_code") val countryCode: String? = null,
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    suspend fun geocode(address: String, countryCode: String? = null): Outcome<GeocodeResult> =
        runCatchingOutcome {
            val accessToken = supabase.auth.currentSessionOrNull()?.accessToken
                ?: error("Sign in required")
            val url = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/geocode-address"
            val payload = json.encodeToString(
                GeocodeRequest.serializer(),
                GeocodeRequest(address = address.trim(), countryCode = countryCode),
            )
            val res: HttpResponse = http.post(url) {
                contentType(ContentType.Application.Json)
                headers { append("Authorization", "Bearer $accessToken") }
                setBody(payload)
            }
            val body = res.bodyAsText()
            if (res.status != HttpStatusCode.OK) {
                error("Geocoder returned ${res.status}: $body")
            }
            json.decodeFromString(GeocodeResult.serializer(), body)
        }
}
