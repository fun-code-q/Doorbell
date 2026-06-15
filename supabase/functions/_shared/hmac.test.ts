// Deno test for the HMAC webhook verifier. Run with:
//   deno test supabase/functions/_shared/hmac.test.ts

import { verifyHmacSignature } from './hmac.ts';
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const SECRET = 'unit-test-secret';

async function signWith(ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${body}`));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('verifyHmacSignature accepts a fresh, correctly-signed request', async () => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ ring_id: 'abc' });
  const sig = await signWith(ts, body);
  assert(await verifyHmacSignature({
    secret: SECRET, timestamp: ts, body, signatureHex: sig,
  }));
});

Deno.test('verifyHmacSignature rejects wrong signature', async () => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ ring_id: 'abc' });
  const sig = await signWith(ts, JSON.stringify({ ring_id: 'tampered' }));
  assertEquals(await verifyHmacSignature({
    secret: SECRET, timestamp: ts, body, signatureHex: sig,
  }), false);
});

Deno.test('verifyHmacSignature rejects stale timestamp', async () => {
  const ts = (Math.floor(Date.now() / 1000) - 999).toString();
  const body = JSON.stringify({ ring_id: 'abc' });
  const sig = await signWith(ts, body);
  assertEquals(await verifyHmacSignature({
    secret: SECRET, timestamp: ts, body, signatureHex: sig, maxAgeSec: 60,
  }), false);
});

Deno.test('verifyHmacSignature rejects non-numeric timestamp', async () => {
  const body = JSON.stringify({ ring_id: 'abc' });
  const sig = await signWith('abc', body);
  assertEquals(await verifyHmacSignature({
    secret: SECRET, timestamp: 'abc', body, signatureHex: sig,
  }), false);
});
