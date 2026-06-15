package com.hamburgbuzz.qrvault.worker

import android.content.Context
import android.os.Build
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.hamburgbuzz.qrvault.data.repository.PushRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/**
 * Durable, network-aware upsert of the FCM token into Supabase. Triggered:
 *   * on FirebaseMessagingService.onNewToken
 *   * on cold start when the cached token does not match the persisted token
 *   * on sign-in (so an anonymous device that later authenticates uploads)
 *
 * The previous design only synced when the user opened Settings; fresh
 * installs would silently miss every ring until then. With this worker
 * the system retries through exponential backoff for up to ~24h.
 */
@HiltWorker
class PushTokenSyncWorker @AssistedInject constructor(
    @Assisted ctx: Context,
    @Assisted params: WorkerParameters,
    private val push: PushRepository,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val token = inputData.getString(KEY_TOKEN) ?: return Result.success()
        val outcome = push.registerToken(
            token = token,
            platform = "android",
            deviceLabel = "${Build.MANUFACTURER} ${Build.MODEL}",
        )
        return outcome.fold(
            onSuccess = { Result.success() },
            onFailure = { Result.retry() },
        )
    }

    private inline fun <T> com.hamburgbuzz.qrvault.util.Outcome<T>.fold(
        onSuccess: (T) -> Result,
        onFailure: (com.hamburgbuzz.qrvault.util.AppError) -> Result,
    ): Result = when (this) {
        is com.hamburgbuzz.qrvault.util.Outcome.Success -> onSuccess(value)
        is com.hamburgbuzz.qrvault.util.Outcome.Failure -> onFailure(error)
    }

    companion object {
        private const val KEY_TOKEN = "token"
        private const val UNIQUE_NAME = "qrvault.push-token-sync"

        fun enqueue(ctx: Context, token: String) {
            val req = OneTimeWorkRequestBuilder<PushTokenSyncWorker>()
                .setInputData(Data.Builder().putString(KEY_TOKEN, token).build())
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx)
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
