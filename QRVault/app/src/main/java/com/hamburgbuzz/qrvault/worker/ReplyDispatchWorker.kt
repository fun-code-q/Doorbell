package com.hamburgbuzz.qrvault.worker

import android.content.Context
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
import com.hamburgbuzz.qrvault.data.repository.RingRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Sends an owner reply through the existing append_ring_message RPC, but
 * survives offline windows and double-tap retries. The `idempotency_key`
 * pinned at enqueue time means the server short-circuits if WorkManager
 * fires the same task twice.
 *
 * Each reply gets its own unique worker name so users can fire multiple
 * replies in quick succession without one cancelling the other.
 */
@HiltWorker
class ReplyDispatchWorker @AssistedInject constructor(
    @Assisted ctx: Context,
    @Assisted params: WorkerParameters,
    private val rings: RingRepository,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val ringId = inputData.getString(KEY_RING_ID) ?: return Result.failure()
        val message = inputData.getString(KEY_MESSAGE) ?: return Result.failure()
        val idempotencyKey = inputData.getString(KEY_IDEMPOTENCY) ?: UUID.randomUUID().toString()

        val outcome = rings.sendReply(ringId, message, idempotencyKey)
        return when (outcome) {
            is com.hamburgbuzz.qrvault.util.Outcome.Success -> Result.success()
            is com.hamburgbuzz.qrvault.util.Outcome.Failure -> {
                // Retry up to ~6 attempts (~ exponential 15s, 30s, 1m, 2m, 4m, 8m).
                if (runAttemptCount >= 6) Result.failure() else Result.retry()
            }
        }
    }

    companion object {
        private const val KEY_RING_ID = "ring_id"
        private const val KEY_MESSAGE = "message"
        private const val KEY_IDEMPOTENCY = "idempotency_key"

        fun enqueue(ctx: Context, ringId: String, message: String): String {
            val idempotency = UUID.randomUUID().toString()
            val req = OneTimeWorkRequestBuilder<ReplyDispatchWorker>()
                .setInputData(
                    Data.Builder()
                        .putString(KEY_RING_ID, ringId)
                        .putString(KEY_MESSAGE, message)
                        .putString(KEY_IDEMPOTENCY, idempotency)
                        .build()
                )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx)
                .enqueueUniqueWork(
                    "reply.$ringId.$idempotency",
                    ExistingWorkPolicy.KEEP,  // KEEP because the idempotency key is unique
                    req,
                )
            return idempotency
        }
    }
}
