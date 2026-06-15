// Constant-time HMAC-SHA256 verify helper shared by Edge Functions.
// Used to authenticate the pg_net database webhook.

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyHmacSignature(opts: {
  secret: string;
  timestamp: string;
  body: string;
  signatureHex: string;
  // Reject signatures older than this many seconds (replay protection).
  maxAgeSec?: number;
}): Promise<boolean> {
  const { secret, timestamp, body, signatureHex } = opts;
  const maxAge = opts.maxAgeSec ?? 300;

  const tsInt = parseInt(timestamp, 10);
  if (!Number.isFinite(tsInt) || tsInt <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsInt) > maxAge) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = new Uint8Array(macBuf);
  const got = hexToBytes(signatureHex);
  return constantTimeEqual(expected, got);
}
