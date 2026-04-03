import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

type RingPayload = {
  ring_id?: string;
  house_id?: string;
  door_location?: string;
  created_at?: string;
};

type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: Record<string, string>;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') || '';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isExpoPushToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      { error: 'Missing function secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' },
      500
    );
  }

  let payload: RingPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const ringId = (payload.ring_id || '').trim();
  if (!ringId) {
    return jsonResponse({ error: 'ring_id is required' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ringResult = await admin
    .from('doorbell_rings')
    .select('id,house_id,door_location,guest_message')
    .eq('id', ringId)
    .maybeSingle();

  if (ringResult.error) {
    return jsonResponse({ error: ringResult.error.message }, 500);
  }
  if (!ringResult.data) {
    return jsonResponse({ ok: true, skipped: 'ring_not_found', ring_id: ringId });
  }

  const ring = ringResult.data;

  const membersResult = await admin
    .from('house_members')
    .select('user_id')
    .eq('house_id', ring.house_id);

  if (membersResult.error) {
    return jsonResponse({ error: membersResult.error.message }, 500);
  }

  const userIds = Array.from(new Set((membersResult.data || []).map((m) => m.user_id).filter(Boolean)));
  if (!userIds.length) {
    return jsonResponse({ ok: true, ring_id: ringId, sent: 0, skipped: 'no_house_members' });
  }

  const subsResult = await admin
    .from('push_subscriptions')
    .select('expo_push_token,user_id')
    .in('user_id', userIds)
    .eq('is_active', true);

  if (subsResult.error) {
    return jsonResponse({ error: subsResult.error.message }, 500);
  }

  const subscriptions = (subsResult.data || []).filter((s) => isExpoPushToken(s.expo_push_token));
  if (!subscriptions.length) {
    return jsonResponse({ ok: true, ring_id: ringId, sent: 0, skipped: 'no_push_subscriptions' });
  }

  const doorLocation = (ring.door_location || 'Doorbell').toString();
  const bodyText = (ring.guest_message || 'Someone is at the door.') as string;

  const messages: PushMessage[] = subscriptions.map((sub) => ({
    to: sub.expo_push_token,
    title: `Doorbell: ${doorLocation}`,
    body: bodyText.length > 160 ? `${bodyText.slice(0, 157)}...` : bodyText,
    sound: 'default',
    priority: 'high',
    channelId: 'doorbell-rings',
    data: {
      type: 'ring_call',
      ring_id: ring.id,
      house_id: ring.house_id,
      door_location: doorLocation,
      url: `qrvault://incoming?ring_id=${encodeURIComponent(ring.id)}&house_id=${encodeURIComponent(
        ring.house_id
      )}`,
    },
  }));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  let sent = 0;
  const invalidTokens: string[] = [];
  const chunks = chunk(messages, EXPO_CHUNK_SIZE);

  for (const part of chunks) {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(part),
    });

    const result = await res.json().catch(() => ({}));
    const tickets = Array.isArray(result?.data) ? result.data : [];

    sent += part.length;

    tickets.forEach((ticket: any, idx: number) => {
      if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
        invalidTokens.push(part[idx].to);
      }
    });
  }

  if (invalidTokens.length) {
    await admin
      .from('push_subscriptions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('expo_push_token', invalidTokens);
  }

  return jsonResponse({
    ok: true,
    ring_id: ringId,
    sent,
    invalid_tokens_deactivated: invalidTokens.length,
  });
});
