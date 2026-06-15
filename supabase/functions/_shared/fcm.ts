// =========================================================================
// supabase/functions/_shared/fcm.ts
// FCM HTTP v1 helper: mints OAuth tokens from a service-account JSON kept
// in the function's secret store, then posts messages. Imported by
// push-ring-notification.
//
// Why FCM v1 and not Firebase Admin SDK on Deno?
// The Admin SDK has poor Deno support and ships a lot of Node-only code.
// FCM v1 is just HTTP + a JWT — easy to do natively in Deno.
// =========================================================================

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

export interface ServiceAccount {
  client_email: string;
  private_key: string;        // PEM
  project_id: string;
  token_uri?: string;
}

interface CachedToken {
  token: string;
  exp: number;  // unix seconds
}

let cachedAccessToken: CachedToken | null = null;

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function mintAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.exp - 60 > now) {
    return cachedAccessToken.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri || FCM_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned =
    base64UrlEncodeString(JSON.stringify(header)) + '.' +
    base64UrlEncodeString(JSON.stringify(claim));

  const key = await importPrivateKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = unsigned + '.' + base64UrlEncode(new Uint8Array(sigBuf));

  const res = await fetch(sa.token_uri || FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  cachedAccessToken = {
    token: body.access_token,
    exp: now + (body.expires_in ?? 3600),
  };
  return cachedAccessToken.token;
}

export interface FcmMessage {
  token: string;
  data: Record<string, string>;
  android?: {
    priority?: 'HIGH' | 'NORMAL';
    ttl?: string;           // e.g. '300s'
    direct_boot_ok?: boolean;
    notification?: Record<string, unknown>;
  };
  apns?: Record<string, unknown>;
}

export type FcmSendResult =
  | { ok: true; name: string }
  | { ok: false; status: number; errorCode?: string; raw: unknown; token: string };

export async function sendFcmMessage(
  sa: ServiceAccount,
  msg: FcmMessage,
): Promise<FcmSendResult> {
  const accessToken = await mintAccessToken(sa);
  const res = await fetch(FCM_SEND_URL(sa.project_id), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: msg }),
  });

  if (res.ok) {
    const body = await res.json();
    return { ok: true, name: body.name };
  }
  const raw = await res.json().catch(() => ({}));
  // FCM v1 error codes: UNREGISTERED / NOT_FOUND / INVALID_ARGUMENT / UNAVAILABLE / INTERNAL
  const errorCode =
    raw?.error?.details?.find((d: any) => d?.errorCode)?.errorCode
    ?? raw?.error?.status
    ?? `HTTP_${res.status}`;
  return { ok: false, status: res.status, errorCode, raw, token: msg.token };
}

export function parseServiceAccount(raw: string): ServiceAccount {
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON missing required fields');
  }
  return sa;
}
