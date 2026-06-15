package com.hamburgbuzz.qrvault.util

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await

/**
 * Pulls a single high-accuracy GPS reading using Google's
 * FusedLocationProviderClient. This is significantly better than
 * navigator.geolocation in the browser because:
 *   * it fuses GPS + GLONASS + Galileo + WiFi + cell-tower triangulation
 *   * it honours `Priority.PRIORITY_HIGH_ACCURACY` reliably on Pixel + Samsung
 *   * it doesn't fall back to a city-level fix on first call
 *
 * The result becomes the door's anchor; we pin it once when the owner is
 * physically standing at the door and never re-derive it.
 */
data class LocationFix(
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double,
)

object LocationCapture {

    fun hasFinePermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    suspend fun current(ctx: Context): LocationFix? {
        if (!hasFinePermission(ctx)) return null
        val client = LocationServices.getFusedLocationProviderClient(ctx)
        return try {
            // We use getCurrentLocation, not getLastLocation, so a stale fix
            // from a previous app does not pollute the door anchor.
            val cancelToken = CancellationTokenSource()
            val loc = client.getCurrentLocation(
                Priority.PRIORITY_HIGH_ACCURACY,
                cancelToken.token,
            ).await() ?: return null
            LocationFix(
                latitude  = loc.latitude,
                longitude = loc.longitude,
                accuracyM = loc.accuracy.toDouble(),
            )
        } catch (_: SecurityException) {
            null
        } catch (_: Throwable) {
            null
        }
    }
}
