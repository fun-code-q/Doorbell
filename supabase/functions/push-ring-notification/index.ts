// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

type RingPayload = {
  ring_id?: string;
  house_id?: string;
  door_location?: string;
  created_at?: string;
};

type PushMessage = {
  to: string;
  title?: string;
  body?: string;
  sound?: 'default';
  priority: 'default' | 'normal' | 'high';
  channelId?: string;
  ttl?: number;
  data: Record<string, string>;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') || '';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;
const RING_NOTIFICATION_CHANNEL_ID = 'doorbell-rings';
const RING_NOTIFICATION_TTL_SECONDS = 300;

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

Deno.serve(async (req: Request) => {
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
    .select('id,house_id,door_point_id,door_location,guest_message')
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

  const userIds = Array.from(new Set((membersResult.data || []).map((m: any) => m.user_id).filter(Boolean)));
  if (!userIds.length) {
    return jsonResponse({ ok: true, ring_id: ringId, sent: 0, skipped: 'no_house_members' });
  }

  let mutedUserIds = new Set<string>();
  if (ring.door_point_id) {
    const mutedResult = await admin
      .from('door_point_members')
      .select('user_id,is_muted')
      .eq('door_point_id', ring.door_point_id)
      .in('user_id', userIds);

    if (mutedResult.error) {
      return jsonResponse({ error: mutedResult.error.message }, 500);
    }

    mutedUserIds = new Set(
      (mutedResult.data || [])
        .filter((entry: any) => entry.is_muted === true)
        .map((entry: any) => entry.user_id)
        .filter(Boolean)
    );
  }

  const settingsResult = await admin
    .from('owner_settings')
    .select('user_id,push_enabled')
    .in('user_id', userIds);

  if (settingsResult.error) {
    return jsonResponse({ error: settingsResult.error.message }, 500);
  }

  const pushEnabledMap = new Map<string, boolean>();
  (settingsResult.data || []).forEach((entry: any) => {
    pushEnabledMap.set(entry.user_id, entry.push_enabled !== false);
  });

  const eligibleUserIds = (userIds as string[]).filter((userId: string) => {
    if (mutedUserIds.has(userId)) return false;
    const pushEnabled = pushEnabledMap.get(userId);
    return pushEnabled !== false;
  });

  if (!eligibleUserIds.length) {
    return jsonResponse({ ok: true, ring_id: ringId, sent: 0, skipped: 'no_eligible_recipients' });
  }

  const subsResult = await admin
    .from('push_subscriptions')
    .select('expo_push_token,user_id,platform')
    .in('user_id', eligibleUserIds)
    .eq('is_active', true);

  if (subsResult.error) {
    return jsonResponse({ error: subsResult.error.message }, 500);
  }

  const subscriptions = (subsResult.data || []).filter((s: any) => isExpoPushToken(s.expo_push_token));
  if (!subscriptions.length) {
    return jsonResponse({ ok: true, ring_id: ringId, sent: 0, skipped: 'no_push_subscriptions' });
  }
  const androidSubscriptions = subscriptions.filter(
    (sub: any) => String(sub.platform || '').toLowerCase() === 'android'
  );

  const doorLocation = (ring.door_location || 'Doorbell').toString();
  const bodyText = (ring.guest_message || 'Someone is at the door.') as string;

  const visibleMessages: PushMessage[] = subscriptions.map((sub: any) => ({
    to: sub.expo_push_token,
    title: `Doorbell: ${doorLocation}`,
    body: bodyText,
    sound: 'default',
    priority: 'high',
    channelId: RING_NOTIFICATION_CHANNEL_ID,
    ttl: RING_NOTIFICATION_TTL_SECONDS,
    data: {
      type: 'ring_call',
      ring_id: ring.id,
      house_id: ring.house_id,
      door_location: doorLocation,
      delivery: 'visible',
      url: `qrvault://incoming?ring_id=${encodeURIComponent(ring.id)}&house_id=${encodeURIComponent(
        ring.house_id
      )}`,
    },
  }));

  // Dual-send strategy:
  // 1) visible ring notification for guaranteed user-facing alert.
  // 2) headless wake payload to run JS task for call-style/full-screen flow when possible.
  const headlessWakeMessages: PushMessage[] = androidSubscriptions.map((sub: any) => ({
    to: sub.expo_push_token,
    priority: 'high',
    ttl: RING_NOTIFICATION_TTL_SECONDS,
    data: {
      type: 'ring_call',
      ring_id: ring.id,
      house_id: ring.house_id,
      door_location: doorLocation,
      delivery: 'headless',
      url: `qrvault://incoming?ring_id=${encodeURIComponent(ring.id)}&house_id=${encodeURIComponent(
        ring.house_id
      )}`,
    },
  }));

  const messages: PushMessage[] = [...visibleMessages, ...headlessWakeMessages];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  let sent = 0;
  const invalidTokens = new Set<string>();
  const chunks = chunk(messages, EXPO_CHUNK_SIZE);

  for (const part of chunks) {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(part),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      return jsonResponse(
        {
          error: 'Expo push request failed',
          status: res.status,
          details: result,
        },
        502
      );
    }

    const tickets = Array.isArray(result?.data) ? result.data : [];

    sent += part.length;

    tickets.forEach((ticket: any, idx: number) => {
      if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
        invalidTokens.add(part[idx].to);
      }
    });
  }

  if (invalidTokens.size) {
    await admin
      .from('push_subscriptions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('expo_push_token', Array.from(invalidTokens));
  }

  return jsonResponse({
    ok: true,
    ring_id: ringId,
    sent,
    sent_visible: visibleMessages.length,
    sent_headless: headlessWakeMessages.length,
    invalid_tokens_deactivated: invalidTokens.size,
  });
});
