// =========================================================================
// push-ring-notification
// Called by the pg_net trigger on doorbell_rings INSERT. Authenticates via
// HMAC over (timestamp || '.' || body) using a shared secret in
// PUSH_WEBHOOK_SECRET, then fans the ring out over FCM HTTP v1 to every
// active push subscription matching the ring (mute / push_enabled honored
// by ring_push_dispatch SQL).
//
// Required env (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL                  (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
//   PUSH_WEBHOOK_SECRET           (you set; same value stored in system_settings)
//   FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON; new key minted in USER_ACTIONS step 1)
//
// Optional env:
//   FIREBASE_PROJECT_ID           (defaults to project_id in the service-account JSON)
//   ALLOWED_WEBHOOK_CLOCK_DRIFT_SEC (default 300)
// =========================================================================

// @ts-nocheck — Deno globals, type-checked at deploy time
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { verifyHmacSignature } from '../_shared/hmac.ts';
import {
  parseServiceAccount,
  sendFcmMessage,
  type FcmMessage,
  type ServiceAccount,
} from '../_shared/fcm.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
const FIREBASE_SA_RAW = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? '';
const PROJECT_ID_OVERRIDE = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';
const CLOCK_DRIFT_SEC = parseInt(
  Deno.env.get('ALLOWED_WEBHOOK_CLOCK_DRIFT_SEC') ?? '300',
  10,
);

const CHANNEL_ID = 'doorbell_rings';
const TTL_SECONDS = 300;
const PRIORITY = 'HIGH' as const;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bootCheck() {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SERVICE_ROLE) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!PUSH_WEBHOOK_SECRET) missing.push('PUSH_WEBHOOK_SECRET');
  if (!FIREBASE_SA_RAW) missing.push('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (missing.length) {
    return json(
      { error: 'Edge Function not configured', missing },
      500,
    );
  }
  return null;
}

let serviceAccount: ServiceAccount | null = null;
function getServiceAccount(): ServiceAccount {
  if (!serviceAccount) {
    serviceAccount = parseServiceAccount(FIREBASE_SA_RAW);
    if (PROJECT_ID_OVERRIDE) serviceAccount.project_id = PROJECT_ID_OVERRIDE;
  }
  return serviceAccount;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const cfgErr = bootCheck();
  if (cfgErr) return cfgErr;

  const bodyText = await req.text();
  const ts = req.headers.get('x-webhook-timestamp') ?? '';
  const sig = req.headers.get('x-webhook-signature') ?? '';
  const bearer = req.headers.get('authorization') ?? '';

  // Belt + suspenders: bearer match is cheap, HMAC verifies body integrity.
  if (bearer !== `Bearer ${PUSH_WEBHOOK_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const sigOk = await verifyHmacSignature({
    secret: PUSH_WEBHOOK_SECRET,
    timestamp: ts,
    body: bodyText,
    signatureHex: sig,
    maxAgeSec: CLOCK_DRIFT_SEC,
  });
  if (!sigOk) return json({ error: 'Bad signature' }, 401);

  let payload: {
    // Ring event (default; ring_id present, no event_type)
    ring_id?: string;
    door_location?: string;
    guest_message_encrypted?: boolean;
    // Invitation event
    event_type?: 'invitation' | 'ring';
    invitation_id?: string;
    house_id?: string;
    invited_email?: string;
  };
  try { payload = JSON.parse(bodyText); } catch { return json({ error: 'Bad JSON' }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Invitation push fan-out.
  if (payload.event_type === 'invitation') {
    const invId = (payload.invitation_id ?? '').trim();
    if (!invId) return json({ error: 'invitation_id required' }, 400);
    const inv = await admin.rpc('invitation_push_dispatch', { p_invitation_id: invId });
    if (inv.error) return json({ error: inv.error.message }, 500);
    const rows = (inv.data ?? []) as Array<{ invitation_id: string; house_id: string; house_name: string; fcm_token: string }>;
    if (!rows.length) return json({ ok: true, invitation_id: invId, sent: 0, skipped: 'no_recipients' });

    const sa = getServiceAccount();
    const result = await Promise.all(rows.map((r) => sendFcmMessage(sa, {
      token: r.fcm_token,
      data: {
        type: 'invitation',
        invitation_id: r.invitation_id,
        house_id: r.house_id,
        house_name: r.house_name,
      },
      android: { priority: 'NORMAL', ttl: '86400s' },
    })));
    const sent = result.filter((x) => x.ok).length;
    return json({ ok: true, invitation_id: invId, sent });
  }

  const ringId = (payload.ring_id ?? '').trim();
  if (!ringId) return json({ error: 'ring_id required' }, 400);

  // One round-trip: SECURITY DEFINER RPC returns the join across rings,
  // members, mute, push_enabled and active tokens.
  const dispatch = await admin.rpc('ring_push_dispatch', { p_ring_id: ringId });
  if (dispatch.error) return json({ error: dispatch.error.message }, 500);
  const rows = (dispatch.data ?? []) as Array<{
    ring_id: string;
    house_id: string;
    door_point_id: string | null;
    door_location: string;
    guest_message_encrypted: boolean;
    ringtone_resource: string | null;
    fcm_token: string;
    user_id: string;
    platform: string;
  }>;
  if (!rows.length) {
    return json({ ok: true, ring_id: ringId, sent: 0, skipped: 'no_recipients' });
  }

  // Build minimal, data-only FCM payloads. The owner app constructs the
  // CallStyle notification natively because FCM "notification" payloads are
  // routed to the system tray when the app is killed, but we want the
  // FcmService to wake first so it can post a CallStyle + start the
  // IncomingRingActivity. Data-only payloads with priority=HIGH wake the
  // app even from Doze on Android 14+ (Play policy permitting; users must
  // have granted exact-alarm / battery exemption — see PowerUserWizard).
  const sa = getServiceAccount();
  const t0 = Date.now();
  const result = await Promise.all(rows.map(async (r) => {
    const msg: FcmMessage = {
      token: r.fcm_token,
      data: {
        type: 'ring_call',
        ring_id: r.ring_id,
        house_id: r.house_id,
        door_point_id: r.door_point_id ?? '',
        door_location: r.door_location,
        encrypted: String(r.guest_message_encrypted ?? false),
        channel_id: CHANNEL_ID,
        priority: PRIORITY,
        // Batch M #4: per-door ringtone identifier carried to the device.
        ringtone_resource: r.ringtone_resource ?? '',
      },
      android: {
        priority: PRIORITY,
        ttl: `${TTL_SECONDS}s`,
        direct_boot_ok: false,
      },
    };
    const send = await sendFcmMessage(sa, msg);
    return { row: r, send };
  }));
  const totalLatency = Date.now() - t0;

  const sent = result.filter((x) => x.send.ok).length;
  const failed = result.filter((x) => !x.send.ok);
  const unregistered = failed
    .filter((x) => !x.send.ok && (
      (x.send as { errorCode?: string }).errorCode === 'UNREGISTERED'
      || (x.send as { errorCode?: string }).errorCode === 'NOT_FOUND'
    ))
    .map((x) => (x.send as { token: string }).token);

  if (unregistered.length) {
    await admin.rpc('mark_tokens_unregistered', { p_tokens: unregistered });
  }

  // Batch C #16: record every send attempt for monitoring.
  await admin.rpc('record_push_dispatch', {
    p_rows: result.map((x) => ({
      ring_id: x.row.ring_id,
      user_id: x.row.user_id,
      fcm_token_tail: x.row.fcm_token.slice(-8),
      outcome: x.send.ok
        ? 'sent'
        : ((x.send as { errorCode?: string }).errorCode === 'UNREGISTERED'
            || (x.send as { errorCode?: string }).errorCode === 'NOT_FOUND')
          ? 'unregistered'
          : 'failed',
      error_code: (x.send as { errorCode?: string }).errorCode ?? null,
      http_status: (x.send as { status?: number }).status ?? (x.send.ok ? 200 : null),
      latency_ms: Math.round(totalLatency / Math.max(1, result.length)),
    })),
  }).catch(() => { /* monitoring write is best-effort; never fail a delivery for it */ });

  // Batch C #6: if EVERYTHING failed (likely FCM/network outage, not a per-token
  // problem), enqueue the original payload for retry by the cron worker.
  if (sent === 0 && failed.length > 0 && unregistered.length === 0) {
    await admin.rpc('enqueue_push_dispatch_failure', {
      p_payload: { ring_id: ringId, retry: true },
      p_error: failed[0]?.send && (failed[0].send as { errorCode?: string }).errorCode
        ? (failed[0].send as { errorCode?: string }).errorCode
        : 'all_failed',
    }).catch(() => { /* best-effort */ });
  }

  // If this is a retry attempt that finally succeeded, mark the DLQ row.
  if (req.headers.get('x-webhook-retry') === 'true' && sent > 0) {
    await admin
      .from('push_dispatch_failures')
      .update({ status: 'sent', last_attempt_at: new Date().toISOString() })
      .eq('ring_id', ringId)
      .in('status', ['retrying', 'pending']);
  }

  return json({
    ok: true,
    ring_id: ringId,
    sent,
    failed: failed.length,
    unregistered: unregistered.length,
    errors: failed.slice(0, 10).map((f) => ({
      token: (f.send as { token: string }).token.slice(0, 16) + '…',
      code: (f.send as { errorCode?: string }).errorCode ?? 'UNKNOWN',
    })),
  });
});
