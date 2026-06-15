# ADR-001: We do not need a Kotlin Multiplatform module for shared crypto

**Status:** Accepted · **Date:** 2026-05-18

## Context

The QR Doorbell system has two clients that perform crypto:

- `public/` — the guest web app encrypts a message with libsodium's
  `crypto_box_seal` using owner public keys returned by the
  `resolve_qr_token` RPC.
- `QRVault/` — the native Android owner app decrypts those messages with
  `crypto_box_seal_open` using the libsodium-android (`lazysodium`)
  binding.

A shared Kotlin Multiplatform (KMP) module that bundled the crypto could
sit between them, with a Kotlin/JS target for the browser and a
Kotlin/JVM target for Android. The question is whether to build it.

## Decision

**No.** We do NOT build a KMP shared-crypto module.

## Reasoning

1. **The wire format is already shared.** Both clients use **the same
   underlying libsodium C library**:
   - browser: `libsodium-wrappers-sumo` (emscripten-compiled libsodium)
   - Android: `lazysodium-android` (JNI binding to libsodium .so)

   `crypto_box_seal` produces the same byte sequence regardless of
   binding. A ciphertext sealed in the browser decrypts on Android and
   vice versa today, without any shared Kotlin. A KMP module would
   re-wrap exactly the same primitive and not eliminate any duplication
   at the cryptographic-protocol level.

2. **The "shared" code would be a few hundred lines.** What we actually
   write per side is base64 codec + a thin helper around `crypto_box_seal`.
   That's ~50 LOC of meaningful logic per platform. KMP setup cost
   (build infrastructure, dual-platform tests, IDE indexing, dependency
   resolution) is materially higher than the savings.

3. **There is no iOS app and no plan to add one.** The user has stated
   Android-only. KMP's headline benefit is iOS reuse; we forgo it.

4. **The JS toolchain is a different shape than the JVM one.**
   `libsodium-wrappers-sumo` is async-loaded; lazysodium-android is sync.
   A KMP common surface would have to abstract over that — the abstraction
   is leaky, and we'd test both anyway.

## What we share instead

- **The error-code vocabulary.** Postgres ERRCODEs `P0001`..`P0008` are
  the contract. Both clients map them to localized strings. Duplication
  is acceptable — there are only 8 codes and they're stable.
- **The QR-token format.** 32-character hex; identical on both sides.
- **The chat-history JSON shape.** Documented in the SQL migration; the
  serialization libraries on each side handle it.

These contracts live in the SQL migration files as the single source of
truth. Both clients read from them.

## When to revisit

Revisit this decision if:
- An iOS app is added (KMP suddenly pays for itself).
- The crypto primitives become more elaborate than `crypto_box_seal` —
  e.g., session keys, ratcheting, or Noise protocol handshakes. Then a
  shared protocol implementation in KMP would be safer than duplicating
  it on each side.
- The error-code surface grows past ~30 entries with semantic data
  attached.
