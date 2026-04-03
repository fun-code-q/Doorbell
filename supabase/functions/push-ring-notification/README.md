# push-ring-notification

Sends Expo push notifications to owner devices when a new `doorbell_rings` row is inserted.

## Deploy

1. Set function secrets:

```bash
supabase secrets set SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
# Optional (only if your Expo project uses access tokens):
supabase secrets set EXPO_ACCESS_TOKEN="YOUR_EXPO_ACCESS_TOKEN"
```

2. Deploy the function without JWT verification (required for DB trigger webhook calls):

```bash
supabase functions deploy push-ring-notification --no-verify-jwt
```

3. Run SQL migration:

- `supabase-hotfix-push-pipeline.sql` (quick patch), or
- full `supabase-final-master.sql` (contains the same section).

## Payload expected by function

```json
{
  "ring_id": "uuid",
  "house_id": "uuid",
  "door_location": "Front Door",
  "created_at": "timestamp"
}
```

## Deep link format sent to app

`qrvault://incoming?ring_id=<RING_ID>&house_id=<HOUSE_ID>`

