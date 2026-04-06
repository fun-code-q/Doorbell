export const DOORBELL_RING_CHANNEL_ID = 'doorbell-rings';
export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

export type RingNotificationPayload = {
  type?: string;
  ring_id?: string;
  house_id?: string;
  door_location?: string;
};

export function isRingNotificationPayload(payload: unknown): payload is RingNotificationPayload {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Record<string, unknown>;
  return value.type === 'ring_call' || typeof value.ring_id === 'string';
}

export function normalizeRingPayload(payload: unknown) {
  const data = (payload || {}) as RingNotificationPayload;
  return {
    ringId: typeof data.ring_id === 'string' ? data.ring_id : '',
    doorLocation:
      typeof data.door_location === 'string' && data.door_location.trim().length > 0
        ? data.door_location
        : 'Guest at Door',
    houseId: typeof data.house_id === 'string' ? data.house_id : undefined,
    type: typeof data.type === 'string' ? data.type : undefined,
  };
}
