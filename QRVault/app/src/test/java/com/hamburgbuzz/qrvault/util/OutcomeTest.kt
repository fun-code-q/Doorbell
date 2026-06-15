package com.hamburgbuzz.qrvault.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class OutcomeTest {

    @Test
    fun success_map_transforms_value() {
        val r = Outcome.Success(42).map { it.toString() }
        assertEquals("42", (r as Outcome.Success).value)
    }

    @Test
    fun failure_map_propagates_error() {
        val err = AppError.Validation("nope")
        val r: Outcome<Int> = Outcome.Failure(err)
        val mapped = r.map { it.toString() }
        assertSame(err, (mapped as Outcome.Failure).error)
    }

    @Test
    fun runCatchingOutcome_wraps_throw() {
        val r = runCatchingOutcome<Int> { throw IllegalStateException("boom") }
        val err = (r as Outcome.Failure).error
        assertEquals("boom", err.message)
    }

    @Test
    fun success_getOrNull_returns_value() {
        assertEquals(7, Outcome.Success(7).getOrNull())
    }

    @Test
    fun failure_getOrNull_is_null() {
        val r: Outcome<Int> = Outcome.Failure(AppError.Unknown("x"))
        assertNull(r.getOrNull())
    }
}
