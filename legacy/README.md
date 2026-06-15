# Legacy / archived modules

Contents of this folder are NO LONGER MAINTAINED. They are kept for git
history and reference only.

## `mobile-owner-expo/`

Original Expo / React Native owner app (Expo SDK 54). Replaced May 2026 by
the native Kotlin app in `../QRVault/`. Reasons for archiving:

- Expo Go would not honor the required `USE_FULL_SCREEN_INTENT` reliably
- Triple-fire ring delivery from competing notification paths
- React Native bridge latency degraded the call-style UI
- Native Compose + direct Firebase Messaging gives a real CallStyle UX
- One codebase per platform target = less drift

DO NOT run this folder. It will not work without rotation of the secrets
that were previously baked in. If you need the Expo source for reference,
read it; do not build it.

Original entry point was `mobile-owner-expo/app/_layout.tsx`.
