package com.hamburgbuzz.qrvault.service

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

object RingEventBus {
    private val _events = MutableSharedFlow<Map<String, String>>(extraBufferCapacity = 1)
    val events = _events.asSharedFlow()

    fun post(data: Map<String, String>) {
        _events.tryEmit(data)
    }
}
