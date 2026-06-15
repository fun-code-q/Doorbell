// =========================================================================
// verify-ring
// Browser-facing Edge Function that gates the create_doorbell_ring_by_token
// RPC. The function performs:
//   1) Cloudflare Turnstile token verification (invisible captcha)
//   2) Origin allow-list check
//   3) IP hashing using a server-side pepper (so the database never sees
//      raw IPs, only hashes — and the hash is unlinkable across rings if
//      the pepper rotates)
//   4) Forwarding to create_doorbell_ring_by_token via the service role
//
// The browser MUST NOT call create_doorbell_ring_by_token directly. The
// SQL grant gives anon EXECUTE on it for migration backwards-compatibility
// only; production should revoke that grant once everyone is on the new
// guest.js. (See migration 20260518000400_rpc_guest.sql for the function
// definition and the rate-limit / geofence enforcement.)
//
// Env:
//   SUPABASE_URL                  (auto)
//   SUPABASE_SERVICE_ROLE_KEY     (auto)
//   TURNSTILE_SECRET_KEY          (you set)
//   IP_HASH_PEPPER                (you set; rotate every 90d)
//   ALLOWED_ORIGINS               (comma-separated; e.g. https://example.com,http://localhost:3000)
// =========================================================================

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
const IP_PEPPER = Deno.env.get('IP_HASH_PEPPER') ?? '';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))
    ? origin
    : (ALLOWED_ORIGINS[0] ?? '');
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function json(payload: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? '0.0.0.0'
  );
}

async function verifyTurnstile(token: string, remoteip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) return false;
  if (!token) return false;
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip });
  const res = await fetch(TURNSTILE_URL, { method: 'POST', body });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data?.success);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (!SUPABASE_URL || !SERVICE_ROLE || !TURNSTILE_SECRET || !IP_PEPPER || !ALLOWED_ORIGINS.length) {
    return json({ error: 'Edge Function not configured' }, 500, origin);
  }
  if (origin && !ALLOWED_ORIGINS.includes('*') && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: 'Forbidden origin' }, 403, origin);
  }

  let payload: {
    qr_token?:        string;
    turnstile_token?: string;
    message?:         string;
    message_encrypted?: boolean;
    ciphertexts?:     string[];
    idempotency_key?: string;
    latitude?:        number;
    longitude?:       number;
    accuracy_m?:      number;
    // Batch H #19: encrypted image attachment.
    attachment?: {
      ciphertexts: string[];
      mime_type:   string;
      size_bytes:  number;
    };
    // Batch H #20: returning-visitor cookie token.
    visitor_token?: string;
  };
  try { payload = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, origin); }

  const qrToken = (payload.qr_token ?? '').trim();
  if (!qrToken || qrToken.length < 8) return json({ error: 'qr_token required' }, 400, origin);

  const ip = clientIp(req);
  const ipHash = await sha256Hex(`${IP_PEPPER}:${ip}`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Batch H #20: trusted-visitor short-circuit. If a valid visitor_token
  // is presented and the visitor isn't blocked, we skip Turnstile.
  let visitorHash: string | null = null;
  let visitorTrusted = false;
  if (typeof payload.visitor_token === 'string' && payload.visitor_token.length > 16) {
    const parsed = await verifyVisitorToken(payload.visitor_token, qrToken);
    if (parsed) {
      visitorHash = parsed.visitorHash;
      const obs = await admin.rpc('observe_visitor', {
        p_qr_token: qrToken,
        p_visitor_hash: visitorHash,
      });
      const r = (obs.data as Array<{ trust_score: number; blocked: boolean }> | null)?.[0];
      if (r?.blocked) return json({ error: 'Visitor blocked', code: 'BLOCKED' }, 403, origin);
      visitorTrusted = (r?.trust_score ?? 0) >= 3;
    }
  }

  if (!visitorTrusted) {
    const ok = await verifyTurnstile(payload.turnstile_token ?? '', ip);
    if (!ok) return json({ error: 'Captcha failed' }, 403, origin);
  }

  const ciphertexts = Array.isArray(payload.ciphertexts)
    ? payload.ciphertexts.filter((c) => typeof c === 'string' && c.length > 0)
    : null;

  const rpc = await admin.rpc('create_doorbell_ring_by_token', {
    p_qr_token:                qrToken,
    p_guest_message:           typeof payload.message === 'string' ? payload.message : null,
    p_guest_message_encrypted: Boolean(payload.message_encrypted),
    p_user_agent_hash:         ipHash,
    p_latitude:                typeof payload.latitude  === 'number' ? payload.latitude  : null,
    p_longitude:               typeof payload.longitude === 'number' ? payload.longitude : null,
    p_geo_accuracy_m:          typeof payload.accuracy_m === 'number' ? payload.accuracy_m : null,
    p_ciphertexts:             ciphertexts && ciphertexts.length ? ciphertexts : null,
    p_idempotency_key:         typeof payload.idempotency_key === 'string' ? payload.idempotency_key.slice(0, 64) : null,
  });

  if (rpc.error) {
    // Map Postgres error codes to HTTP status the browser UI can branch on.
    // See supabase/migrations/20260518000400 + 20260518000600 for the codes.
    const code = (rpc.error as { code?: string }).code ?? '';
    const status =
      code === 'P0001' ? 404 :   // invalid/inactive QR (rotated, deactivated)
      code === 'P0002' ? 429 :   // per-IP rate limit
      code === 'P0003' ? 422 :   // location required
      code === 'P0004' ? 422 :   // outside geofence
      code === 'P0005' ? 413 :   // message too long
      code === 'P0006' ? 423 :   // door in DND
      code === 'P0007' ? 429 :   // per-door global cap
      code === 'P0008' ? 423 :   // auto-DND tripped
      400;
    return json({ error: rpc.error.message, code }, status, origin);
  }
  const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;

  // Batch H #19: persist the encrypted attachment if the guest provided one.
  if (payload.attachment
      && Array.isArray(payload.attachment.ciphertexts)
      && payload.attachment.ciphertexts.length > 0) {
    await admin.rpc('attach_ring_payload', {
      p_ring_id:     row.id,
      p_ciphertexts: payload.attachment.ciphertexts,
      p_mime_type:   payload.attachment.mime_type,
      p_size_bytes:  payload.attachment.size_bytes,
    }).catch(() => { /* best-effort: don't fail the ring on attachment errors */ });
  }

  // Batch H #20: emit (or refresh) the visitor_token cookie. The visitor
  // hash is HMAC(pepper, qr_token || random nonce); the token is base64url
  // of (nonce || hmac). On the next ring we re-derive the hash and look it up.
  let visitorToken: string | null = null;
  if (!visitorHash) {
    visitorHash = await randomVisitorHash(qrToken);
    await admin.rpc('observe_visitor', {
      p_qr_token: qrToken,
      p_visitor_hash: visitorHash,
    }).catch(() => { /* visitor whitelisting is best-effort */ });
  }
  if (visitorHash) visitorToken = await signVisitorToken(qrToken, visitorHash);

  return json({
    ok:            true,
    ring_id:       row.id,
    house_id:      row.house_id,
    door_point_id: row.door_point_id,
    guest_secret:  row.guest_secret,
    created_at:    row.created_at,
    visitor_token: visitorToken,
  }, 200, origin);
});

// ---------------------------------------------------------------------------
// Visitor-token (signed cookie) helpers. The token format:
//   base64url( random_24_bytes || hmac_sha256(pepper, qr_token || token_bytes) )
// We embed enough randomness that the hash is unique per visitor; the
// cookie body contains only the random nonce, and the database stores
// the hash, so a leaked cookie still requires the matching pepper to be
// recognised (and the pepper rotates every 90 days).
// ---------------------------------------------------------------------------

async function randomVisitorHash(qrToken: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  return await hmacHex(`${qrToken}.${b64(nonce)}`);
}

async function signVisitorToken(qrToken: string, visitorHash: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const mac = await hmacHex(`${qrToken}.${visitorHash}.${b64(nonce)}`);
  return `${b64(nonce)}.${visitorHash.slice(0, 16)}.${mac}`;
}

async function verifyVisitorToken(token: string, qrToken: string): Promise<{ visitorHash: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [b64nonce, hashPrefix, presentedMac] = parts;
  if (b64nonce.length < 16 || hashPrefix.length !== 16 || presentedMac.length !== 64) return null;
  // We don't store the full visitor hash in the cookie (privacy), only the
  // 16-char prefix. The Edge Function looks up by prefix; collisions are
  // checked by HMAC re-derivation.
  const candidates = await fetchVisitorByPrefix(qrToken, hashPrefix);
  for (const fullHash of candidates) {
    const expected = await hmacHex(`${qrToken}.${fullHash}.${b64nonce}`);
    if (timingSafeEqual(expected, presentedMac)) return { visitorHash: fullHash };
  }
  return null;
}

let cachedKey: CryptoKey | null = null;
async function hmacKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(IP_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return cachedKey;
}
async function hmacHex(data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Lookup by the 16-char prefix of the visitor hash. Cheap (indexed scan)
// because (qr_token, visitor_hash) is the PK on visitor_whitelist.
async function fetchVisitorByPrefix(qrToken: string, hashPrefix: string): Promise<string[]> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const res = await admin
    .from('visitor_whitelist')
    .select('visitor_hash')
    .eq('qr_token', qrToken)
    .like('visitor_hash', `${hashPrefix}%`)
    .limit(8);
  if (res.error || !res.data) return [];
  return (res.data as Array<{ visitor_hash: string }>).map((r) => r.visitor_hash);
}
