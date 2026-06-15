-- =========================================================================
-- 20260518001500_ring_dispatch_ringtone.sql
--
-- Extend `ring_push_dispatch` so the FCM fan-out carries the per-door
-- ringtone identifier through to the device, where it controls which
-- audio plays in IncomingRingActivity.
-- =========================================================================

DROP FUNCTION IF EXISTS public.ring_push_dispatch(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.ring_push_dispatch(p_ring_id UUID)
RETURNS TABLE(
  ring_id        UUID,
  house_id       UUID,
  door_point_id  UUID,
  door_location  TEXT,
  guest_message_encrypted BOOLEAN,
  ringtone_resource TEXT,
  fcm_token      TEXT,
  user_id        UUID,
  platform       TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.house_id, r.door_point_id, r.door_location, r.guest_message_encrypted,
    dp.ringtone_resource,
    ps.fcm_token, ps.user_id, ps.platform
  FROM public.doorbell_rings r
  LEFT JOIN public.door_points dp ON dp.id = r.door_point_id
  JOIN public.house_members hm ON hm.house_id = r.house_id
  LEFT JOIN public.door_point_members dpm
         ON dpm.user_id = hm.user_id AND dpm.door_point_id = r.door_point_id
  LEFT JOIN public.owner_settings os ON os.user_id = hm.user_id
  JOIN public.push_subscriptions ps
        ON ps.user_id = hm.user_id AND ps.is_active = true
  WHERE r.id = p_ring_id
    AND COALESCE(dpm.is_muted, false) = false
    AND COALESCE(os.push_enabled, true) = true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ring_push_dispatch(UUID) TO service_role;
