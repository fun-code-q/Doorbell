package com.hamburgbuzz.qrvault.util

/**
 * A discriminated success/failure type the whole app uses instead of
 * throwing across coroutine boundaries or returning nullable everywhere.
 * Named `Outcome` rather than `Result` to avoid shadowing kotlin.Result.
 */
sealed class Outcome<out T> {
    data class Success<T>(val value: T) : Outcome<T>()
    data class Failure(val error: AppError) : Outcome<Nothing>()

    inline fun <R> map(transform: (T) -> R): Outcome<R> = when (this) {
        is Success -> Success(transform(value))
        is Failure -> this
    }

    inline fun onSuccess(block: (T) -> Unit): Outcome<T> = also {
        if (this is Success) block(value)
    }

    inline fun onFailure(block: (AppError) -> Unit): Outcome<T> = also {
        if (this is Failure) block(error)
    }

    fun getOrNull(): T? = (this as? Success)?.value
    fun errorOrNull(): AppError? = (this as? Failure)?.error
}

sealed class AppError(open val message: String, open val cause: Throwable? = null) {
    data class Network(override val message: String, override val cause: Throwable? = null) : AppError(message, cause)
    data class Auth(override val message: String, override val cause: Throwable? = null)    : AppError(message, cause)
    data class Forbidden(override val message: String, override val cause: Throwable? = null): AppError(message, cause)
    data class NotFound(override val message: String, override val cause: Throwable? = null): AppError(message, cause)
    data class Crypto(override val message: String, override val cause: Throwable? = null)  : AppError(message, cause)
    data class Validation(override val message: String, override val cause: Throwable? = null): AppError(message, cause)
    data class Unknown(override val message: String, override val cause: Throwable? = null) : AppError(message, cause)
}

inline fun <T> runCatchingOutcome(block: () -> T): Outcome<T> = try {
    Outcome.Success(block())
} catch (t: Throwable) {
    Outcome.Failure(t.toAppError())
}

fun Throwable.toAppError(): AppError = when (this) {
    is io.github.jan.supabase.exceptions.RestException ->
        AppError.Network(message = message ?: "Network error", cause = this)
    is io.github.jan.supabase.exceptions.HttpRequestException ->
        AppError.Network(message = message ?: "Network unreachable", cause = this)
    else -> AppError.Unknown(message ?: "Unknown error", this)
}
