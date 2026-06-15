# QR Doorbell — Pro Edition

A professional smart QR doorbell system with three deliverables that work
together end-to-end:

| Layer | Tech | What it does |
| --- | --- | --- |
| **Guest web** | Vanilla JS + PWA (`public/`) | Visitor scans the QR sticker on the door, lands on a no-install page, rings the bell, optionally chats with the occupant. Captures geolocation for the geofence gate and ChaCha20-encrypts messages to the owner's public key. |
| **Owner app** | Native Kotlin / Jetpack Compose (`QRVault/`) | Android-only owner app. Receives FCM ring pushes with priority `high`, shows a CallStyle full-screen incoming-call UI, decrypts the guest message locally, supports inline Answer / Decline, mute, audit log. |
| **Backend** | Supabase Postgres + Edge Functions (`supabase/`) | RLS-locked schema with token-gated guest RPCs, server-side geofence + rate-limit + Turnstile verify, pg_net trigger → Edge Function fan-out to FCM HTTP v1 with HMAC-signed webhooks. |

## ✨ Implemented features

Everything below is actually wired up in code. The list is exhaustive
within reason — features added past the original three-pillar scope are
called out by category.

### Guest experience
- **Zero install** — vanilla-JS PWA, works in any modern mobile browser.
- **Location-aware QR** — owner pins each door's GPS anchor with
  FusedLocationProvider, or by address via the `geocode-address` Edge
  Function (OpenStreetMap Nominatim, 30-day cache). Server-side haversine
  check rejects scans outside `radius + capped GPS accuracy`. Radius
  10–200 m; default 50 m.
- **End-to-end encrypted messages** — owner devices publish a Curve25519
  public key (libsodium / `crypto_box_seal`); the guest seals the message
  once per active owner pubkey so multi-device works. The DB row stores
  ciphertext only; Edge Functions never see plaintext.
- **Passphrase-wrapped key backup** — Argon2id-derived key + `crypto_secretbox`,
  passphrase never leaves the device; restore on a new phone with the
  passphrase only.
- **Threaded chat** — Supabase Realtime + token-bound polling fallback,
  TTL enforced server-side.
- **Layered anti-spam (six defences stack)**:
  1. Geofence (above)
  2. Cloudflare Turnstile invisible captcha
  3. Per-IP rolling rate limit (3 rings / 60 s)
  4. Per-door global cap (default 12 rings / hour, configurable)
  5. Auto-DND (default: 5 unanswered rings in 10 min → 1 h pause)
  6. **Per-door quiet hours** with wrapping ranges (e.g. 22:00 → 07:00)
  Plus **one-tap QR token rotation** from QRVault — instantly kills a
  leaked sticker without reprinting.

### Owner app (Android, Kotlin / Compose / Hilt / WorkManager)

**Ring delivery — six tiers of defence so rings always arrive**
- FCM HTTP v1 with `priority: HIGH` + data-only payload (Doze bypass).
- `foregroundServiceType="specialUse"` (NOT phoneCall — avoids Telecom).
- CallStyle full-screen-intent + WearableExtender.
- Dedicated `IMPORTANCE_HIGH` channel with own ringtone.
- **Runtime tone synth fallback** — synthesizes a westminster ding-dong
  via `AudioTrack` if the bundled raw resource and the system ringtone
  both fail. App always makes sound.
- **OEM autostart router** — heuristic routes for MIUI / ColorOS / Funtouch
  / OnePlus / Huawei / Samsung. Auto-detected; shown in Power-User wizard
  and HealthScreen.

**Account & auth**
- Email + password sign-in / sign-up (Supabase Auth).
- **Forgot-password flow** — deep-link `qrvault://auth/reset` opens the
  app at the reset screen after the recovery email is tapped.
- **Email verification UX** — amber banner on Home until `email_confirmed_at`
  is set, with one-tap RESEND.
- **Email change** — confirmation link sent to the new address; change
  only applies after the user taps it.
- **Account deletion** (GDPR Art. 17) — server-side cascade then local
  key wipe + sign-out.
- **App-lock** — opt-in BiometricPrompt + device PIN gate on cold start
  and after 60 s in the background. Toggle in Settings → Security.
- **In-UI rate-limit** — 5 sign-in attempts / 60 s → 30 s cooldown,
  surfaced as "Try again in Ns".

**Owner UX**
- Multi-house, multi-door with role-based member management
  (`owner` / `manager` / `viewer`).
- **House switcher pill** in the top bar (hidden when only one house).
- **Per-door geofence anchor**: pin from current GPS *or* from address.
- **Per-door ringtone picker** — bundled chimes + system default
  (extensible to custom files).
- **Per-door DND** (manual + auto + quiet hours).
- **Quick-replies editor** — 5 customisable canned replies on the
  incoming-ring screen.
- **QR Factory** — generates printable A4 PDFs with cut marks; share PNG;
  self-scan a printed sticker to verify what it resolves to.
- **Settings export / import** — JSON, via Storage Access Framework.
- **Webhooks CRUD** — outbound webhooks with HMAC-signed payloads.
- **Devices screen** — list / revoke this account's other devices.
- **Invitations screen** — accept / decline incoming house invites.
- **Health screen** — diagnoses notifications permission, channel state,
  Doze whitelist, Play services, FCM token, full-screen-intent grant,
  and OEM autostart, with one-tap fix intents.
- **Power-User wizard** — sequential steps for battery, overlay, and
  (on aggressive OEMs) vendor autostart.
- **Audit log** with date-range filter and house-scoped purge.
- **Feedback submission** in-app (bug / feature / question / praise),
  auto-tags device label and app version.
- **In-app updates** — Play Core flexible/immediate update flow.
- **AboutLibraries** — real OSS license screen generated at build time.

**Localisation**
- en (base), de, es, fr, pl, tr.

**Security & privacy**
- `EncryptedSharedPreferences` for session blob, keypair, and quick-reply
  cache; `allowBackup="false"`; signed-release-only.
- TLS pinning via `network_security_config.xml`.
- **Crashlytics is opt-in** (Settings → Diagnostics → Send crash reports),
  off by default. EU-friendly.

### Backend (Supabase: Postgres + Edge Functions + Realtime + pg_net + pg_cron)
- **Tight RLS** — every table row-locked; `anon` cannot SELECT
  `doorbell_rings`. Guests reach data only through token-gated RPCs.
- **HMAC-signed pg_net webhook** — `Authorization: Bearer <secret>` +
  `X-Webhook-Timestamp` + `X-Webhook-Signature` (HMAC-SHA256). Edge
  Function rejects without a valid, fresh signature.
- **FCM HTTP v1 fan-out** — OAuth tokens minted from
  `FIREBASE_SERVICE_ACCOUNT_JSON` in Edge Function secrets; dead tokens
  auto-deactivated on `UNREGISTERED`.
- **Push DLQ + retry** — `record_push_dispatch`, `enqueue_push_dispatch_failure`,
  `retry_pending_push_dispatch` keep failed deliveries observable.
- **GDPR retention** — `pg_cron` purges rings + audit > 90 days; PII
  redacted from `audit_log.details`; `delete_my_account` cascades across
  `public.*` and `auth.users`.
- **Outbound webhooks** — `dispatch_outbound_webhooks` job signs and
  retries; `outbound_webhooks` table is RLS-scoped per house.
- **Versioned migrations** — 19 timestamped files in `supabase/migrations/`;
  one-shot deploy via `supabase db push`.
- **Edge Functions**:
  - `push-ring-notification` — HMAC-verified FCM fan-out.
  - `verify-ring` — Turnstile + geofence + rate-limit verifier.
  - `geocode-address` — OSM Nominatim proxy with 30-day cache.

## 🚀 Quick start

### Prerequisites
- Supabase project with the **pg_net** + **pgcrypto** + **pg_cron** extensions enabled
- Firebase project (for FCM); service-account JSON kept ONLY in Supabase
  Edge Function secrets — never on disk, never in the repo
- Cloudflare Turnstile site key + secret
- Android Studio Iguana (2025.1+) and JDK 21

### One-time setup
1. Walk through every step in [`USER_ACTIONS.md`](USER_ACTIONS.md). It is
   the source of truth for things the code cannot do for you (key rotation,
   secret distribution, Play Console declarations, branch protection).
2. From the repo root:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push          # applies supabase/migrations/
   supabase functions deploy push-ring-notification
   supabase functions deploy verify-ring                  # Turnstile + geofence verifier
   ```
3. In QRVault, edit `QRVault/local.properties`:
   ```
   sdk.dir=<your android sdk path>
   SUPABASE_URL=https://<your-ref>.supabase.co
   SUPABASE_KEY=<your anon key>
   GUEST_BASE_URL=https://<your-domain>/
   ```
4. Build + install on a device:
   ```bash
   cd QRVault && ./gradlew :app:installDebug
   ```
5. Host the guest site (any static host). Inject the Supabase URL + anon
   key + Turnstile site key into `public/config.js` at deploy time. Vercel
   or GitHub Pages works fine.

## 📦 Project layout

```
.
├── QRVault/                       # Native Kotlin Android owner app
│   ├── PLAY_STORE_CHECKLIST.md    # Pre-submission checklist (assets, Data Safety, perms)
│   └── app/src/main/
│       ├── java/.../ui/screens    # 16 Compose screens — Login, Home, Doors,
│       │                          #   Settings, About, Devices, Health,
│       │                          #   Invitations, Webhooks, QRFactory,
│       │                          #   Audit, Licenses, PowerUserWizard,
│       │                          #   ForgotPassword, ResetPassword
│       ├── java/.../util          # ToneSynth, BiometricGate, OemAutostart,
│       │                          #   RingHealthCheck, QrPdfExport, …
│       └── res/                   # values + values-{de,es,fr,pl,tr}
├── public/                        # Guest web (PWA, vanilla JS)
├── supabase/
│   ├── migrations/                # 19 versioned SQL files
│   ├── functions/                 # push-ring-notification, verify-ring, geocode-address
│   └── config.toml
├── docs/
│   ├── ADR-001-no-kmp-shared-crypto.md
│   └── SELF_HOSTING.md
├── .github/                       # CI workflows + branch protection
├── legacy/                        # Archived experiments — do NOT build
├── USER_ACTIONS.md                # External steps the code can't perform
└── SECURITY.md                    # Responsible disclosure
```

## 🛡 Security model

See [SECURITY.md](SECURITY.md). High-level invariants:

- The `anon` role can only call four whitelisted RPCs; it has no direct
  table SELECT on anything that holds PII
- All guest-originated rings go through a single chokepoint RPC that
  validates token, geofence, rate-limit, and captcha — fail-closed
- The Edge Function authenticates the database webhook via HMAC; it
  cannot be called from the open internet without a valid signature +
  fresh timestamp
- Owner private keys live in Android Keystore (StrongBox if available);
  the server never has the means to decrypt guest messages

## 📄 License

MIT — see [LICENSE](LICENSE).

Built for secure, frictionless guest management.
