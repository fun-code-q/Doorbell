-- =========================================================================
-- 20260518000600_anti_spam_layers.sql
--
-- Defence-in-depth around the per-IP rate limit and the geofence:
--   * Per-door GLOBAL cap (max N rings/hour total, across all IPs). Defeats
--     "flash mob" coordination where many distinct phones each ring once
--     and the per-IP limit never triggers.
--   * Per-door auto-DND after K unanswered rings in M minutes. Prevents
--     the owner's phone from screaming all night while they're asleep / away.
--   * One-tap QR token rotation. A leaked QR sticker becomes harmless the
--     moment the owner taps Rotate; the old token is dead and any rings
--     posted with it 404 cleanly.
--   * set_door_location: the owner's QRVault sends their FusedLocationProvider
--     reading here so the door's anchor is pinned exactly once, at create
--     time, while the owner is physically standing at the door.
-- =========================================================================

-- New per-door tuning columns. All have sensible defaults; existing rows
-- get them automatically.
ALTER TABLE public.door_points
  ADD COLUMN IF NOT EXISTS max_rings_per_hour INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS auto_dnd_after_unanswered INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS auto_dnd_window_minutes INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS dnd_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_rotation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_set_at TIMESTAMPTZ;

-- =========================================================================
-- enforce_door_throttle: helper called from inside create_doorbell_ring_by_token.
-- Encapsulates the global cap + DND check + auto-DND escalation.
-- Raises with a specific ERRCODE the Edge Function can translate to HTTP 429.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_door_throttle(
  p_door_point_id UUID,
  p_max_per_hour INTEGER,
  p_auto_dnd_after INTEGER,
  p_auto_dnd_window_min INTEGER,
  p_dnd_until TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_now           TIMESTAMPTZ := timezone('utc', now());
  v_hour_ago      TIMESTAMPTZ := v_now - INTERVAL '1 hour';
  v_window_ago    TIMESTAMPTZ;
  v_total_rings   INTEGER;
  v_unanswered    INTEGER;
BEGIN
  -- 1. Owner-issued DND wins immediately. Don't even count.
  IF p_dnd_until IS NOT NULL AND p_dnd_until > v_now THEN
    RAISE EXCEPTION 'Door is in Do Not Disturb mode' USING ERRCODE = 'P0006';
  END IF;

  -- 2. Global per-door cap (per hour, total, across all visitors).
  --    Note this excludes "dismissed" because dismissed rings include
  --    the owner-initiated cleanup of spam — we don't double-count those
  --    against future legitimate visitors.
  SELECT COUNT(*) INTO v_total_rings
  FROM public.doorbell_rings r
  WHERE r.door_point_id = p_door_point_id
    AND r.created_at >= v_hour_ago
    AND r.status <> 'dismissed';
  IF v_total_rings >= p_max_per_hour THEN
    RAISE EXCEPTION 'Doorbell paused — too many rings recently' USING ERRCODE = 'P0007';
  END IF;

  -- 3. Auto-DND escalation: K unanswered rings in M minutes -> trip DND for 1h.
  --    "Unanswered" = status='waiting' (owner never opened, never replied).
  IF p_auto_dnd_after IS NOT NULL AND p_auto_dnd_after > 0
     AND p_auto_dnd_window_min IS NOT NULL AND p_auto_dnd_window_min > 0 THEN
    v_window_ago := v_now - make_interval(mins => p_auto_dnd_window_min);
    SELECT COUNT(*) INTO v_unanswered
    FROM public.doorbell_rings r
    WHERE r.door_point_id = p_door_point_id
      AND r.created_at >= v_window_ago
      AND r.status = 'waiting';
    IF v_unanswered >= p_auto_dnd_after THEN
      UPDATE public.door_points
      SET dnd_until = v_now + INTERVAL '1 hour'
      WHERE id = p_door_point_id;
      RAISE EXCEPTION 'Doorbell auto-paused for 1 hour' USING ERRCODE = 'P0008';
    END IF;
  END IF;
END;
$$;

-- =========================================================================
-- Replace create_doorbell_ring_by_token to call enforce_door_throttle.
-- Same signature so the Edge Function does not need to change.
-- =========================================================================
DROP FUNCTION IF EXISTS public.create_doorbell_ring_by_token(
  TEXT, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) CASCADE;

CREATE OR REPLACE FUNCTION public.create_doorbell_ring_by_token(
  p_qr_token                TEXT,
  p_guest_message           TEXT DEFAULT NULL,
  p_guest_message_encrypted BOOLEAN DEFAULT false,
  p_user_agent_hash         TEXT DEFAULT NULL,
  p_latitude                DOUBLE PRECISION DEFAULT NULL,
  p_longitude               DOUBLE PRECISION DEFAULT NULL,
  p_geo_accuracy_m          DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE(
  id            UUID,
  house_id      UUID,
  door_point_id UUID,
  guest_secret  TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  RATE_LIMIT_WINDOW   CONSTANT INTERVAL := INTERVAL '60 seconds';
  RATE_LIMIT_MAX      CONSTANT INTEGER  := 3;

  v_dp_id             UUID;
  v_house_id          UUID;
  v_door_name         TEXT;
  v_door_lat          DOUBLE PRECISION;
  v_door_lon          DOUBLE PRECISION;
  v_door_radius       INTEGER;
  v_max_per_hour      INTEGER;
  v_auto_dnd_after    INTEGER;
  v_auto_dnd_window   INTEGER;
  v_dnd_until         TIMESTAMPTZ;
  v_distance_m        DOUBLE PRECISION;
  v_now               TIMESTAMPTZ := timezone('utc', now());
  v_ip_hash           TEXT := nullif(trim(coalesce(p_user_agent_hash, '')), '');
  v_window_start      TIMESTAMPTZ := date_trunc('minute', v_now);
  v_current_count     INTEGER;
  v_clean_msg         TEXT;
  v_history           JSONB := '[]'::jsonb;
  v_new_id            UUID;
  v_secret            TEXT;
BEGIN
  -- 1. Resolve.
  SELECT dp.id, dp.house_id, dp.name, dp.latitude, dp.longitude, dp.geofence_radius_m,
         dp.max_rings_per_hour, dp.auto_dnd_after_unanswered, dp.auto_dnd_window_minutes,
         dp.dnd_until
  INTO v_dp_id, v_house_id, v_door_name, v_door_lat, v_door_lon, v_door_radius,
       v_max_per_hour, v_auto_dnd_after, v_auto_dnd_window, v_dnd_until
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token AND dp.is_active = true
  LIMIT 1;
  IF v_dp_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive QR code' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Anti-spam: door-level throttle (global cap + DND).
  PERFORM public.enforce_door_throttle(
    v_dp_id, v_max_per_hour, v_auto_dnd_after, v_auto_dnd_window, v_dnd_until
  );

  -- 3. Per-visitor rolling-window rate limit.
  IF v_ip_hash IS NOT NULL THEN
    INSERT INTO public.ring_rate_limit (qr_token, ip_hash, window_start, count)
    VALUES (p_qr_token, v_ip_hash, v_window_start, 1)
    ON CONFLICT (qr_token, ip_hash, window_start)
    DO UPDATE SET count = public.ring_rate_limit.count + 1
    RETURNING count INTO v_current_count;
    IF v_current_count > RATE_LIMIT_MAX THEN
      RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 4. Geofence (only when the door has a pinned location).
  IF v_door_lat IS NOT NULL AND v_door_lon IS NOT NULL THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Location required for this door' USING ERRCODE = 'P0003';
    END IF;
    v_distance_m := public._haversine_meters(v_door_lat, v_door_lon, p_latitude, p_longitude);
    IF v_distance_m > (v_door_radius + LEAST(COALESCE(p_geo_accuracy_m, 0), 100)) THEN
      RAISE EXCEPTION 'Outside the door''s allowed area' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- 5. Normalise message.
  v_clean_msg := nullif(trim(coalesce(p_guest_message, '')), '');
  IF v_clean_msg IS NOT NULL AND length(v_clean_msg) > 2000 THEN
    RAISE EXCEPTION 'Message too long' USING ERRCODE = 'P0005';
  END IF;
  IF v_clean_msg IS NOT NULL THEN
    v_history := jsonb_build_array(
      jsonb_build_object('role','guest','text', v_clean_msg, 'time', v_now,
                         'encrypted', p_guest_message_encrypted)
    );
  END IF;

  -- 6. Insert.
  v_secret := public.generate_qr_token();
  INSERT INTO public.doorbell_rings (
    house_id, door_point_id, door_location,
    guest_message, chat_history, guest_message_encrypted,
    guest_secret, ip_hash,
    guest_latitude, guest_longitude, guest_geo_accuracy_m
  ) VALUES (
    v_house_id, v_dp_id, v_door_name,
    v_clean_msg, v_history, p_guest_message_encrypted,
    v_secret, v_ip_hash,
    p_latitude, p_longitude, p_geo_accuracy_m
  )
  RETURNING doorbell_rings.id INTO v_new_id;

  RETURN QUERY
  SELECT r.id, r.house_id, r.door_point_id, r.guest_secret, r.created_at
  FROM public.doorbell_rings r WHERE r.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_doorbell_ring_by_token(
  TEXT, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) TO anon, authenticated;

-- =========================================================================
-- rotate_door_qr_token: owner one-tap regenerates the qr_token. Old QR
-- stickers go dead instantly because resolve_qr_token only matches the
-- current token. Increments qr_rotation_count for audit visibility.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rotate_door_qr_token(p_door_point_id UUID)
RETURNS TABLE(id UUID, qr_token TEXT, qr_rotation_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
  v_new_token TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF v_house IS NULL OR NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_new_token := public.generate_qr_token();

  UPDATE public.door_points
  SET qr_token = v_new_token,
      qr_rotation_count = qr_rotation_count + 1,
      updated_at = timezone('utc', now())
  WHERE id = p_door_point_id
  RETURNING door_points.id, door_points.qr_token, door_points.qr_rotation_count
  INTO id, qr_token, qr_rotation_count;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rotate_door_qr_token(UUID) TO authenticated;

-- =========================================================================
-- set_door_location: the QRVault app sends a captured GPS reading here.
-- Validates the radius is sensible (clamp 10..500m). The accuracy stays
-- as audit info but does not change the geofence check.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_door_location(
  p_door_point_id   UUID,
  p_latitude        DOUBLE PRECISION,
  p_longitude       DOUBLE PRECISION,
  p_radius_m        INTEGER DEFAULT 50,
  p_accuracy_m      DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geofence_radius_m INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
  v_radius INTEGER := GREATEST(10, LEAST(COALESCE(p_radius_m, 50), 500));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF v_house IS NULL OR NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Coordinates required';
  END IF;
  IF abs(p_latitude) > 90 OR abs(p_longitude) > 180 THEN
    RAISE EXCEPTION 'Coordinates out of range';
  END IF;

  UPDATE public.door_points
  SET latitude            = p_latitude,
      longitude           = p_longitude,
      geofence_radius_m   = v_radius,
      location_accuracy_m = p_accuracy_m,
      location_set_at     = timezone('utc', now())
  WHERE id = p_door_point_id
  RETURNING door_points.id, door_points.latitude, door_points.longitude, door_points.geofence_radius_m
  INTO id, latitude, longitude, geofence_radius_m;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_door_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, DOUBLE PRECISION) TO authenticated;

-- =========================================================================
-- set_door_dnd: owner manually pauses the door for a duration.
-- Useful for "going to bed", "on holiday", "noisy neighbour event".
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_door_dnd(
  p_door_point_id UUID,
  p_minutes       INTEGER
)
RETURNS TABLE(id UUID, dnd_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
  v_minutes INTEGER := GREATEST(0, LEAST(COALESCE(p_minutes, 0), 24 * 60));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF v_house IS NULL OR NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE public.door_points
  SET dnd_until = CASE WHEN v_minutes = 0 THEN NULL
                       ELSE timezone('utc', now()) + make_interval(mins => v_minutes)
                  END
  WHERE id = p_door_point_id
  RETURNING door_points.id, door_points.dnd_until INTO id, dnd_until;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_door_dnd(UUID, INTEGER) TO authenticated;
