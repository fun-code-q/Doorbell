# push-ring-notification

Edge Function that fans a `doorbell_rings` INSERT out over **FCM HTTP v1**
to every active push subscription matched to that ring.

## Architecture

```
Postgres trigger on doorbell_rings INSERT
   └─> notify_ring_push_webhook (PL/pgSQL)
        └─> net.http_post (pg_net)
             headers:
               Authorization:        Bearer <PUSH_WEBHOOK_SECRET>
               X-Webhook-Timestamp:  <unix seconds>
               X-Webhook-Signature:  hex(HMAC-SHA256(secret, ts.body))
             body:
               { ring_id, house_id, door_point_id, door_location, ... }
   └─> this Edge Function
        ├─> verifyHmacSignature (replay-protected, constant-time)
        ├─> public.ring_push_dispatch RPC (single round-trip)
        └─> Promise.all(sendFcmMessage(...)) — FCM HTTP v1
             └─> mark_tokens_unregistered for UNREGISTERED/NOT_FOUND
```

The Edge Function is intentionally callable only by the webhook caller.
JWT verification is off (`config.toml` `verify_jwt = false`) but the
bearer token + HMAC + timestamp drift check substitute for it.

## Required secrets

Set these in Supabase Dashboard → Edge Functions → `push-ring-notification`
→ Secrets:

| Name | Source |
| --- | --- |
| `SUPABASE_URL` | auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected |
| `PUSH_WEBHOOK_SECRET` | `openssl rand -hex 32`; ALSO store the same value in `public.system_settings.push_ring_webhook_secret` so the database trigger can sign requests |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | full JSON of a service account with role `roles/firebasecloudmessaging.serviceAgent`. Mint a fresh key per USER_ACTIONS.md step 1 — never reuse the one that was on disk |
| `FIREBASE_PROJECT_ID` *(optional)* | overrides `project_id` from the service-account JSON |
| `ALLOWED_WEBHOOK_CLOCK_DRIFT_SEC` *(optional)* | replay-window size in seconds; default 300 |

## Payload expected by the Edge Function

```json
{
  "ring_id": "uuid",
  "house_id": "uuid",
  "door_point_id": "uuid",
  "door_location": "Front Door",
  "guest_message_encrypted": true,
  "created_at": "2026-05-18T12:34:56Z"
}
```

## Data sent to the Android client

Data-only FCM payload (no `notification` block) so the native FcmService
wakes first and constructs the CallStyle notification + starts the
IncomingRingActivity:

```json
{
  "type":          "ring_call",
  "ring_id":       "<uuid>",
  "house_id":      "<uuid>",
  "door_point_id": "<uuid>",
  "door_location": "Front Door",
  "encrypted":     "true",
  "channel_id":    "doorbell_rings",
  "priority":      "HIGH"
}
```

with `android.priority = HIGH` and `android.ttl = 300s`.

## Local testing

```bash
supabase functions serve push-ring-notification --env-file ./supabase/.env.local
# In another shell, simulate a signed webhook:
ts=$(date +%s)
body='{"ring_id":"<uuid>","house_id":"<uuid>","door_location":"Front Door"}'
sig=$(printf '%s.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$PUSH_WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST http://localhost:54321/functions/v1/push-ring-notification \
  -H "Authorization: Bearer $PUSH_WEBHOOK_SECRET" \
  -H "X-Webhook-Timestamp: $ts" \
  -H "X-Webhook-Signature: $sig" \
  -H "Content-Type: application/json" \
  -d "$body"
```

## Deploy

```bash
supabase functions deploy push-ring-notification
```
