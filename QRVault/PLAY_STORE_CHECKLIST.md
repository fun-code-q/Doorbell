# Play Store submission checklist — QR Vault

Things the code can't ship by itself. Tick them off before uploading.

## 1. Real audio assets

The bundled doorbell tones are placeholder `.txt` files. The app has a
runtime synth fallback (so it always rings), but for a polished v1 drop
real `.ogg` files into `app/src/main/res/raw/`:

| Resource           | Used when                                            |
|--------------------|------------------------------------------------------|
| `doorbell_ring`    | Default (`ringtone_resource = null`)                 |
| `doorbell_soft`    | SecurityDialog → "Soft chime" (`bundled:soft`)       |
| `doorbell_chime`   | SecurityDialog → "Classic chime" (`bundled:chime`)   |
| `doorbell_buzz`    | SecurityDialog → "Buzzer" (`bundled:buzz`)           |

Specs:
- OGG Vorbis or OPUS, mono or stereo
- 44.1 kHz or 48 kHz, 16-bit
- 2–5 s loopable (fade-in 5 ms, fade-out 50 ms to avoid loop clicks)
- Target loudness ~ −14 LUFS short-term
- Royalty-free license (Mixkit, Pixabay, kwahmah_02 on freesound).
  Document the license URL in `README.md`.

Confirm bundle size stays under the 200 MB AAB limit after adding.

## 2. Play Console listing assets

The store requires PNG/JPEG you can't generate from code.

- **App icon** — 512×512 PNG. Source: same vector as `res/drawable/app_icon`,
  exported at 512 with the foreground inset already applied.
- **Feature graphic** — 1024×500 PNG. Hamburg Buzz brand strip with the
  bell glyph; no text smaller than 24 pt.
- **Phone screenshots** — minimum 2, maximum 8, 1080×1920 portrait.
  Required scenes:
  1. Incoming-ring full-screen UI
  2. Home dashboard with stats + activity log
  3. SecurityDialog open on a door
  4. QR Factory screen with a generated sticker
  5. (Optional) Multi-device DevicesScreen showing key publication
- **Tablet screenshots** — only if we declare tablet support; we don't.
- **Short description** — 80 chars: *"Doorbell rings on your phone when
  someone scans the QR code at your door."*
- **Full description** — 4 000 chars; lift from `public/index.html`'s
  hero copy + feature list.

## 3. Data Safety form

This is the section that catches teams off guard.

Collected data (be honest):
- **Email address** — account creation; not shared; encrypted in transit and at rest.
- **Approximate location** — only the *door* coordinates the owner pins.
  Guest location is checked client-side and discarded.
- **App interactions** — anonymous crash traces, opt-in only (Crashlytics
  toggle in Settings → Diagnostics).
- **Device or other IDs** — FCM registration token, scoped to account.

Encryption:
- "Data is encrypted in transit" — ✅ (TLS via OkHttp + Supabase).
- "Data is encrypted at rest" — ✅ for keys (EncryptedSharedPreferences),
  ✅ for server-side rings (libsodium sealed boxes per recipient pubkey).
- "Users can request data deletion" — ✅ (AboutScreen → Delete account →
  `delete_my_account` RPC).

## 4. Permissions justifications

Play Console asks for prose on each. Use these:

| Permission                              | Justification                                                                 |
|----------------------------------------|-------------------------------------------------------------------------------|
| `USE_FULL_SCREEN_INTENT`               | Required to show the call-style ringing UI over the lock screen so the owner doesn't miss a visitor while the phone is idle. Triggered only by an authenticated FCM push from our backend after a verified guest scan. |
| `FOREGROUND_SERVICE_SPECIAL_USE`       | The ring service plays the doorbell tone and renders the CallStyle notification until the owner accepts or declines. Subtype `doorbell_incoming_ring` is declared in the manifest's `<property>`. |
| `MANAGE_OWN_CALLS`                     | Enables CallStyle full-screen-intent on Android 14+. We do not integrate Telecom; no ConnectionService is implemented. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Power-User wizard offers (optionally) to whitelist the app so Doze doesn't delay rings. The user makes the choice. |
| `ACCESS_FINE_LOCATION`                 | Owner taps "Pin location" on a door to set the geofence anchor. The fix never leaves the device; we send only the chosen lat/lon to the server. |
| `CAMERA`                               | "Scan a QR" in QR Factory lets the owner self-verify a printed sticker. |
| `POST_NOTIFICATIONS`                   | Required to deliver the doorbell push on Android 13+. |

## 5. Privacy policy + Terms URLs

- Privacy: `https://qrvault.hamburgbuzz.com/privacy.html` (verify deployed)
- Terms:   `https://qrvault.hamburgbuzz.com/terms.html`
- Security model: `https://qrvault.hamburgbuzz.com/security.html`
- DPA:     `https://qrvault.hamburgbuzz.com/dpa.html`

The AboutScreen rows link to these via `BuildConfig.GUEST_BASE_URL`.
Before submission, `curl -I` each URL to confirm 200 OK.

## 6. Pre-submission smoke tests on real hardware

These are the bugs that only show up post-submission if you don't catch
them in QA:

- [ ] Cold-boot phone, leave app un-launched for 24 h, scan a QR → ring
      arrives within 10 s (OEM Doze killer test).
- [ ] Lock phone, scan QR → CallStyle UI replaces the lock screen and
      tone plays (USE_FULL_SCREEN_INTENT smoke test).
- [ ] Forgot-password email link reopens the app at ResetPasswordScreen
      (`qrvault://auth/reset` deep-link smoke test).
- [ ] Toggle Settings → Require unlock ON → background → foreground:
      BiometricPrompt fires.
- [ ] Sign up with a fresh email, do NOT confirm: HomeScreen shows the
      amber "Verify your email" banner; tap RESEND → toast confirms.
- [ ] On a Xiaomi / OnePlus device: PowerUserWizard shows the OEM
      auto-start step; tapping it opens the vendor screen.

## 7. Release variant config

- `signingConfig` must reference an upload keystore *not* committed to git.
- `gradle.properties` (or CI secret) supplies `SUPABASE_URL`, `SUPABASE_KEY`,
  `GUEST_BASE_URL`. Confirm `BuildConfig.GUEST_BASE_URL` resolves to the
  production host, not a preview/staging domain.
- `R8` must be on (already wired); test the AAB locally with
  `bundletool build-apks` before upload — minification has bitten this
  app twice (Hilt module entries, kotlinx-serialization classes).

## 8. Required device declarations

- Min SDK 26 (Android 8) — verified by Play.
- Target SDK must be the latest required by Play for the submission
  window (Play raises this annually).
- `LeanbackLauncher`/`Wear` — not declared; we're phone-only.
