# Manual User Actions — DO THESE IN THIS ORDER

These are the steps the code cannot perform for you. They involve external
consoles (Google Cloud, Supabase Dashboard, Play Console, GitHub). Treat
this file as a checklist and tick items as you complete them.

> Status legend: `[ ]` = todo · `[x]` = done · `[-]` = N/A

---

## 1. Rotate the Firebase Admin SDK service-account key (CRITICAL)

Your repo previously contained
`QRVault/qr-vault-14abb-firebase-adminsdk-fbsvc-94c52a5916.json` — a Google
RSA private key with **full Firebase Admin** on project `qr-vault-14abb`.
The file has been deleted from disk and the gitignore now blocks any
re-add. The key itself is still valid in GCP until you revoke it.

- [ ] Open https://console.cloud.google.com/iam-admin/serviceaccounts?project=qr-vault-14abb
- [ ] Click `firebase-adminsdk-fbsvc@qr-vault-14abb.iam.gserviceaccount.com`
- [ ] Tab **Keys** → find key ID `94c52a5916907c5df0a605dc7230f0f65d40d830`
- [ ] Click **Disable** (don't delete yet — first watch 24h of audit logs)
- [ ] Open https://console.cloud.google.com/logs/query?project=qr-vault-14abb and
      filter for `protoPayload.authenticationInfo.principalEmail="firebase-adminsdk-fbsvc@qr-vault-14abb.iam.gserviceaccount.com"`
      — look for unexpected calls in the last 90 days
- [ ] Also review Firebase Cloud Messaging send history for unfamiliar payloads
- [ ] After 24h with no breakage, return to the Keys tab and **Delete** the
      disabled key permanently

### Mint a new key for the Edge Function (only after revoke)

The new push pipeline (`supabase/functions/push-ring-notification`) calls
the FCM HTTP v1 API directly. It needs a fresh service account key, but
that key must live in Supabase Edge Function secrets — NEVER in the repo
or on disk.

- [ ] In the same Service Account page click **Keys → Add key → JSON**
- [ ] Save the downloaded JSON to a temporary location (e.g. `~/Downloads`)
- [ ] In a terminal:
      ```
      supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON --env-file <(echo "FIREBASE_SERVICE_ACCOUNT_JSON=$(cat ~/Downloads/qr-vault-*.json | jq -c .)")
      ```
      or in the Supabase Dashboard → Project Settings → Edge Functions →
      Secrets, paste the full JSON content into a secret named
      `FIREBASE_SERVICE_ACCOUNT_JSON`
- [ ] Also set `FIREBASE_PROJECT_ID=qr-vault-14abb`
- [ ] Shred the local copy: `shred -u ~/Downloads/qr-vault-*.json` (Linux/macOS)
      or `Remove-Item -Force <path>` (Windows)

---

## 2. Move the Android production keystore off your laptop (CRITICAL)

`qr-doorbell.keystore` is in the project working tree. It's gitignored
so it never reached GitHub, but living on a laptop is still wrong.

- [ ] Decide where the source of truth lives. Options:
  - **GitHub Actions secret** (easiest for this repo's CI pipeline). Encode the keystore as base64:
    ```powershell
    [Convert]::ToBase64String([IO.File]::ReadAllBytes("d:\Hamburg\Hamburg Buzz\Digital\QR Door Bell\qr-doorbell.keystore")) | Set-Clipboard
    ```
    Then add it as `ANDROID_KEYSTORE_B64` in GitHub repo → Settings → Secrets and variables → Actions.
    Also add `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
  - **GCP Secret Manager** if you want one source of truth for all secrets.
- [ ] Verify CI can build a release APK after the secret is in place (Phase 6B sets up this workflow).
- [ ] Once verified, delete the local keystore: `Remove-Item "d:\Hamburg\Hamburg Buzz\Digital\QR Door Bell\qr-doorbell.keystore"`
- [ ] Confirm via `git status` and `git check-ignore qr-doorbell.keystore` that nothing leaks.

> ⚠️ If you ever lose this keystore, you can't ship updates to the existing
> Play Store listing. Back up to a second secret store (1Password / GCP
> Secret Manager / hardware token).

---

## 3. Rotate Supabase anon key + set Edge Function secrets

The current anon key was committed in `mobile-owner/.env` once (now
archived). Anon keys are public by design, but rotation is good hygiene
once RLS is hardened (Phase 1B in this repo does that).

- [ ] Supabase Dashboard → Project → Settings → API → **Reset anon key**
- [ ] Update `public/config.js` (if hard-coded) and any deployment env vars
- [ ] Update `mobile-owner/.env` if you keep the archived Expo app running
- [ ] Update QRVault: edit `QRVault/local.properties` `SUPABASE_KEY=` with the new key

### Edge Function secrets

The push pipeline now requires four secrets. Set them via
Supabase Dashboard → Edge Functions → `push-ring-notification` → Secrets:

- [ ] `SUPABASE_URL` — your project URL (auto-injected by Supabase but verify)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — auto-injected; verify it's there
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` — from step 1 above
- [ ] `FIREBASE_PROJECT_ID` — `qr-vault-14abb`
- [ ] `PUSH_WEBHOOK_SECRET` — generate one: `openssl rand -hex 32`

### Save the webhook secret into Postgres too

So the database trigger can include it as `Authorization: Bearer …`:

```sql
-- Run once in the Supabase SQL editor
UPDATE public.system_settings
SET setting_value = '<paste the same PUSH_WEBHOOK_SECRET value>'
WHERE setting_key = 'push_ring_webhook_secret';

UPDATE public.system_settings
SET setting_value = 'https://<your-project-ref>.functions.supabase.co/push-ring-notification'
WHERE setting_key = 'push_ring_webhook_url';
```

### Edge Function secrets for verify-ring

In Supabase Dashboard → Edge Functions → `verify-ring` → Secrets:

- [ ] `TURNSTILE_SECRET_KEY` — from Cloudflare Turnstile (same site as the site key in step 5)
- [ ] `IP_HASH_PEPPER` — `openssl rand -hex 32`. Rotate every 90 days.
- [ ] `ALLOWED_ORIGINS` — comma-separated, e.g. `https://your-domain.example,http://localhost:3000`

---

## 4. Enable branch protection on `main`

GitHub repo → Settings → Branches → Add rule for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: `ci`, `codeql`, `dependency-review`, `gitleaks`, `qrvault-android` (added in Phase 6)
- [ ] Require signed commits
- [ ] Require linear history
- [ ] Block force pushes
- [ ] Block deletions
- [ ] Include administrators (yes, you too)

---

## 5. Turnstile / hCaptcha site key (for guest rate limiting)

Phase 3C added a server-side captcha gate. You need a free Cloudflare
Turnstile site:

- [ ] https://dash.cloudflare.com/?to=/:account/turnstile → Add site → choose
      **Invisible** mode for `your-domain.example` (and `localhost` for dev)
- [ ] Copy the **Site Key** into `public/config.js` (`TURNSTILE_SITE_KEY`)
- [ ] Copy the **Secret Key** into Supabase Edge Function secrets as
      `TURNSTILE_SECRET_KEY` (used by the verify-ring edge function)

---

## 6. Confirm CodeQL has Kotlin coverage enabled

Repo → Settings → Code security and analysis → CodeQL analysis → Set up →
Advanced → ensure `java-kotlin` is in the matrix (Phase 6B does this in YAML).

---

## 7. GitHub Actions secrets (one-time setup)

These mirror the values you've already set elsewhere. Add them under
GitHub → repo → Settings → Secrets and variables → Actions:

| Name | Notes |
| --- | --- |
| `SUPABASE_URL` | `https://<your-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | rotated anon key from step 3 |
| `VERIFY_RING_URL` | `https://<your-ref>.functions.supabase.co/verify-ring` |
| `TURNSTILE_SITE_KEY` | from step 5 |
| `SUPABASE_ACCESS_TOKEN` | rotate quarterly |
| `SUPABASE_PROJECT_REF` | e.g. `abcdwxyz123` |
| `GUEST_BASE_URL` | e.g. `https://your-domain.example/` |
| `GOOGLE_SERVICES_JSON_B64` | base64 of `QRVault/app/google-services.json` (see below) |
| `ANDROID_KEYSTORE_B64` | from step 2 |
| `ANDROID_KEYSTORE_PASSWORD` | from step 2 |
| `ANDROID_KEY_ALIAS` | from step 2 |
| `ANDROID_KEY_PASSWORD` | from step 2 |

Also add a repository **variable** (not secret) named `EXPECTED_ORIGIN`
matching the public URL the guest PWA is served from. Variables are
displayed in workflow logs; secrets are masked.

### Generating `GOOGLE_SERVICES_JSON_B64`

Locally, after you download `google-services.json` from Firebase console
into `QRVault/app/google-services.json` (gitignored):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("QRVault\app\google-services.json")) | Set-Clipboard
```

Paste into the GitHub secret. The QRVault CI job restores it before
running Gradle.

---

## 8. Verify Play Console listing

For a smooth Aug 2026 deadline (Android 16 / targetSdk 36):

- [ ] Play Console → App → Policy → Declarations:
  - USE_FULL_SCREEN_INTENT (justify as "call-style doorbell")
  - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (justify as "guaranteed ring delivery")
  - POST_NOTIFICATIONS (auto-required)
  - SYSTEM_ALERT_WINDOW (REMOVED in Phase 2A — verify it's not in your latest upload)
- [ ] Confirm Play App Signing fingerprint is in
      `public/.well-known/assetlinks.json` (Phase 5B will scaffold the second slot)

---

## 9. Allowlist the password-recovery deep link in Supabase Auth

The forgot-password flow mails the user a link that opens the app at
`qrvault://auth/reset#access_token=…`. Supabase will REFUSE to email
that link unless the URL is in the project's redirect allowlist.

- [ ] Supabase Dashboard → Authentication → **URL Configuration** →
      **Redirect URLs** → add `qrvault://auth/reset`
- [ ] Save. There is no second confirmation step; the email templates
      pick up the new allowlist on the next send.
- [ ] (Optional but recommended) In **Email Templates → Reset Password**
      change the link text to something like "Open in QR Vault app" so
      users don't expect a web page.
- [ ] Test end-to-end on a real device: Login screen → FORGOT PASSWORD →
      enter your email → tap email link → app reopens at ResetPasswordScreen.
      If it bounces to the browser instead of the app, your
      AndroidManifest's `<intent-filter>` for `qrvault://auth` is missing
      or `MainActivity` isn't `singleTask`.

---

## 10. (Optional) Bundle real audio for the doorbell tone picker

The app ships a runtime synthesiser as a final fallback, so it always
makes sound. For a polished v1 you can drop real `.ogg` files into
`QRVault/app/src/main/res/raw/`:

| File                  | Picked from SecurityDialog when           |
|-----------------------|-------------------------------------------|
| `doorbell_ring.ogg`   | Default (`ringtone_resource = null`)      |
| `doorbell_soft.ogg`   | "Soft chime" (`bundled:soft`)             |
| `doorbell_chime.ogg`  | "Classic chime" (`bundled:chime`)         |
| `doorbell_buzz.ogg`   | "Buzzer" (`bundled:buzz`)                 |

Specs and license guidance are in
`QRVault/app/src/main/res/raw/doorbell_*.placeholder.txt`. Once you drop
real files in, **delete the matching placeholder .txt** so the package
stays clean.

---

## 11. Email-verification policy

Sign-up now sends a confirmation link by default (Supabase Auth's
"Confirm email" toggle). HomeScreen shows an amber banner until
`email_confirmed_at` is set, and exposes a RESEND button.

- [ ] Supabase Dashboard → Authentication → Providers → Email → confirm
      **Confirm email** is ON. If you turn it OFF, the banner never
      shows up because every user is auto-confirmed.
- [ ] If you want the banner to gate sensitive features (invitations,
      key publication), grep for `auth.isEmailConfirmed()` and add the
      check at the call site.

---

## 12. Verify the legal pages resolve

AboutScreen rows link to `<GUEST_BASE_URL>/privacy.html`, `/terms.html`,
`/security.html`, `/dpa.html`. The files exist under `public/`, but
production needs them deployed at the actual URLs.

- [ ] `curl -I https://<your-domain>/privacy.html` → 200
- [ ] `curl -I https://<your-domain>/terms.html`   → 200
- [ ] `curl -I https://<your-domain>/security.html`→ 200
- [ ] `curl -I https://<your-domain>/dpa.html`     → 200

---

## 13. Run through `QRVault/PLAY_STORE_CHECKLIST.md`

That file is the source of truth for the actual store submission:
listing assets, Data Safety form answers, permissions justifications,
release-variant config, and the on-device smoke tests every reviewer
expects to pass. Read it once cover-to-cover before uploading the AAB.
