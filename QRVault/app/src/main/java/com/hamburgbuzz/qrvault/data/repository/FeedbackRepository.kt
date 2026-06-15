package com.hamburgbuzz.qrvault.data.repository

import android.os.Build
import com.hamburgbuzz.qrvault.BuildConfig
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In-app feedback submission (Batch O #16). The user picks a category
 * (bug / feature / question / praise) and types a message. We attach
 * the device label + app version automatically so the maintainer can
 * triage without asking.
 */
@Singleton
class FeedbackRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    enum class Category(val wire: String) {
        BUG("bug"), FEATURE("feature"), QUESTION("question"), PRAISE("praise"),
    }

    suspend fun submit(category: Category, message: String): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "submit_feedback",
            buildJsonObject {
                put("p_category", JsonPrimitive(category.wire))
                put("p_message", JsonPrimitive(message.trim()))
                put("p_device_label", JsonPrimitive("${Build.MANUFACTURER} ${Build.MODEL}"))
                put("p_app_version", JsonPrimitive("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"))
                put("p_android_sdk", JsonPrimitive(Build.VERSION.SDK_INT))
            }
        )
        Unit
    }
}
