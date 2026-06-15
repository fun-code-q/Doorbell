# verify-ring

Browser-facing Edge Function. Sits in front of `create_doorbell_ring_by_token`
and adds the protections you cannot do client-side:

- Cloudflare Turnstile (invisible captcha) verification
- Origin allow-listing (no random-origin abuse via the anon key)
- Pepper-salted IP hashing (the database row gets the hash, never the IP,
  so a database leak does not de-anonymize visitors)

## Required secrets

| Name | Source |
| --- | --- |
| `SUPABASE_URL` | auto |
| `SUPABASE_SERVICE_ROLE_KEY` | auto |
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard → Turnstile → site → secret key |
| `IP_HASH_PEPPER` | `openssl rand -hex 32`. Rotate every 90 days |
| `ALLOWED_ORIGINS` | comma-separated list, e.g. `https://your-domain.example,http://localhost:3000` |

## Request body

```json
{
  "qr_token":         "<32-hex>",
  "turnstile_token":  "<from cf-turnstile>",
  "message":          "<plaintext OR base64 ciphertext>",
  "message_encrypted": true,
  "latitude":         53.5511,
  "longitude":        9.9937,
  "accuracy_m":       12.5
}
```

## Response

`200 OK`:
```json
{
  "ok":           true,
  "ring_id":      "...",
  "house_id":     "...",
  "door_point_id":"...",
  "guest_secret": "<keep this in sessionStorage>",
  "created_at":   "..."
}
```

`403`: captcha or origin failed
`422`: outside geofence / location missing
`429`: rate limit exceeded
`400`: payload error

## Deploy

```bash
supabase functions deploy verify-ring
```
