package com.hamburgbuzz.qrvault.di

import android.content.Context
import com.hamburgbuzz.qrvault.BuildConfig
import com.hamburgbuzz.qrvault.data.remote.EncryptedSessionStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import javax.inject.Singleton

/**
 * Hilt module wiring the singleton Supabase client. The client is wrapped
 * around an EncryptedSharedPreferences-backed SessionManager so refresh
 * tokens live behind AES-GCM at rest.
 *
 * BuildConfig values come from local.properties / CI env (see
 * QRVault/app/build.gradle.kts). They are never checked into git.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideSupabaseClient(@ApplicationContext context: Context): SupabaseClient {
        require(BuildConfig.SUPABASE_URL.isNotBlank()) {
            "SUPABASE_URL missing in BuildConfig. Set it in local.properties."
        }
        require(BuildConfig.SUPABASE_KEY.isNotBlank()) {
            "SUPABASE_KEY missing in BuildConfig. Set it in local.properties."
        }
        val store = EncryptedSessionStore(context)
        return createSupabaseClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseKey = BuildConfig.SUPABASE_KEY,
        ) {
            install(Postgrest)
            install(Realtime)
            install(Auth) {
                sessionManager = store
                autoLoadFromStorage = true
                alwaysAutoRefresh   = true
            }
        }
    }

    /**
     * General-purpose Ktor HttpClient for direct REST calls to our Edge
     * Functions (geocode-address, feedback, etc.) that we don't route
     * through the Supabase SDK because they're not table operations.
     * The OkHttp engine reuses Android's existing socket pool.
     */
    @Provides
    @Singleton
    fun provideHttpClient(): HttpClient = HttpClient(OkHttp) {
        install(HttpTimeout) {
            requestTimeoutMillis = 15_000
            connectTimeoutMillis = 5_000
            socketTimeoutMillis  = 15_000
        }
    }
}
