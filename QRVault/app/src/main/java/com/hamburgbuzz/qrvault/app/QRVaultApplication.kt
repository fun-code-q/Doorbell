package com.hamburgbuzz.qrvault.app

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.hamburgbuzz.qrvault.notification.RingChannels
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * Entry point. Registers Hilt, declares NotificationChannels on cold start,
 * and wires the WorkManager factory so background token-sync workers can
 * receive injected dependencies.
 */
@HiltAndroidApp
class QRVaultApplication : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        RingChannels.ensure(nm, this)
        // Crashlytics: respect the opt-in flag set in Settings (Batch O #7).
        com.hamburgbuzz.qrvault.util.CrashReporting.init(this)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()
}
