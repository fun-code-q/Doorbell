-- =========================================================================
-- 20260518000400_rpc_guest.sql
-- Guest-facing (anon) RPCs. These are the ONLY public surface area. Every
-- one verifies the per-door qr_token; the ring-create path also enforces
-- geofence (Phase 3A) and rate limiting (Phase 3C). Plaintext or ciphertext
-- messages are both supported via the guest_message_encrypted flag.
-- =========================================================================

-- =========================================================================
-- resolve_qr_token: look up the door for a given QR token. Returns the
-- door name, house id, geofence center+radius (so the guest UI can size
-- the geolocation prompt), and the active owner public key for
-- end-to-end encryption.
-- =========================================================================
DROP FUNCTION IF EXISTS public.resolve_qr_token(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_qr_token(p_qr_token TEXT)
RETURNS TABLE(
  door_point_id      UUID,
  door_name          TEXT,
  house_id           UUID,
  latitude           DOUBLE PRECISION,
  longitude          DOUBLE PRECISION,
  geofence_radius_m  INTEGER,
  owner_public_key   TEXT,
  encryption_algorithm TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF p_qr_token IS NULL OR length(trim(p_qr_token)) < 8 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dp.id, dp.name, dp.house_id,
    dp.latitude, dp.longitude, dp.geofence_radius_m,
    opk.public_key, opk.algorithm
  FROM public.door_points dp
  -- Pick any active key for the house. If multiple owners published keys,
  -- the guest UI MUST encrypt to all of them, but for a v1 single-owner
  -- household one key is sufficient. We pick the most recently created.
  LEFT JOIN LATERAL (
    SELECT k.public_key, k.algorithm
    FROM public.owner_public_keys k
    WHERE k.house_id = dp.house_id AND k.is_active = true
    ORDER BY k.created_at DESC
    LIMIT 1
  ) opk ON true
  WHERE dp.qr_token = p_qr_token
    AND dp.is_active = true
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_qr_token(TEXT) TO anon, authenticated;

-- =========================================================================
-- Internal: haversine distance in meters between two lat/lon points.
-- Avoids the PostGIS dependency for a 50m geofence check.
-- =========================================================================
CREATE OR REPLACE FUNCTION public._haversine_meters(
  lat1 DOUBLE PRECISION, lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_temp
AS $$
DECLARE
  r CONSTANT DOUBLE PRECISION := 6371000.0; -- Earth radius (m)
  dLat DOUBLE PRECISION;
  dLon DOUBLE PRECISION;
  a DOUBLE PRECISION;
  c DOUBLE PRECISION;
BEGIN
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
    RETURN NULL;
  END IF;
  dLat := radians(lat2 - lat1);
  dLon := radians(lon2 - lon1);
  a := sin(dLat / 2) ^ 2
     + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon / 2) ^ 2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  RETURN r * c;
END;
$$;

-- =========================================================================
-- create_doorbell_ring_by_token (Phase 3A + 3B + 3C):
--   * verifies qr_token resolves to an active door
--   * enforces geofence: if door has lat/lon set, the guest_latitude/
--     guest_longitude must be within geofence_radius_m + the GPS accuracy
--   * enforces per-(qr_token, ip_hash) rate limit (server-side, not just
--     a client constant)
--   * accepts ciphertext or plaintext message via p_guest_message_encrypted
--   * returns a per-ring guest_secret which the guest must keep in
--     sessionStorage and present back on every follow-up RPC. The qr_token
--     alone is no longer sufficient to read or write someone else's ring.
-- =========================================================================
DROP FUNCTION IF EXISTS public.create_doorbell_ring_by_token(TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_doorbell_ring_by_token(TEXT, TEXT, BOOLEAN, TEXT) CASCADE;
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
  -- Rate limit: 3 rings per 60-second rolling window per (qr_token, ip_hash).
  RATE_LIMIT_WINDOW  CONSTANT INTERVAL := INTERVAL '60 seconds';
  RATE_LIMIT_MAX     CONSTANT INTEGER  := 3;

  v_dp_id            UUID;
  v_house_id         UUID;
  v_door_name        TEXT;
  v_door_lat         DOUBLE PRECISION;
  v_door_lon         DOUBLE PRECISION;
  v_door_radius      INTEGER;
  v_distance_m       DOUBLE PRECISION;
  v_now              TIMESTAMPTZ := timezone('utc', now());
  v_ip_hash          TEXT := nullif(trim(coalesce(p_user_agent_hash, '')), '');
  v_window_start     TIMESTAMPTZ := date_trunc('minute', v_now);
  v_current_count    INTEGER;
  v_clean_msg        TEXT;
  v_history          JSONB := '[]'::jsonb;
  v_new_id           UUID;
  v_secret           TEXT;
BEGIN
  -- 1. Resolve the door.
  SELECT dp.id, dp.house_id, dp.name, dp.latitude, dp.longitude, dp.geofence_radius_m
  INTO v_dp_id, v_house_id, v_door_name, v_door_lat, v_door_lon, v_door_radius
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token AND dp.is_active = true
  LIMIT 1;
  IF v_dp_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive QR code' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Rate limit: count rings from this (token, ip_hash) in the past window.
  --    Use an upsert into ring_rate_limit keyed by the truncated window start.
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

  -- 3. Geofence: only enforced when the door has both lat and lon set.
  IF v_door_lat IS NOT NULL AND v_door_lon IS NOT NULL THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Location required for this door' USING ERRCODE = 'P0003';
    END IF;
    v_distance_m := public._haversine_meters(v_door_lat, v_door_lon, p_latitude, p_longitude);
    -- Allow geofence + reported accuracy (capped) to absorb noisy GPS fixes.
    IF v_distance_m > (v_door_radius + LEAST(COALESCE(p_geo_accuracy_m, 0), 100)) THEN
      RAISE EXCEPTION 'Outside the door''s allowed area' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- 4. Normalise message.
  v_clean_msg := nullif(trim(coalesce(p_guest_message, '')), '');
  IF v_clean_msg IS NOT NULL AND length(v_clean_msg) > 2000 THEN
    -- Ciphertext can be ~33% larger than plaintext.
    RAISE EXCEPTION 'Message too long' USING ERRCODE = 'P0005';
  END IF;
  IF v_clean_msg IS NOT NULL THEN
    v_history := jsonb_build_array(
      jsonb_build_object('role','guest','text', v_clean_msg, 'time', v_now,
                         'encrypted', p_guest_message_encrypted)
    );
  END IF;

  -- 5. Insert.
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
  FROM public.doorbell_rings r
  WHERE r.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_doorbell_ring_by_token(
  TEXT, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) TO anon, authenticated;

-- =========================================================================
-- append_ring_message: guests use p_guest_secret (per-ring); owners are
-- authenticated and need has_house_role or door membership.
-- =========================================================================
DROP FUNCTION IF EXISTS public.append_ring_message(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.append_ring_message(UUID, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.append_ring_message(
  p_ring_id      UUID,
  p_role         TEXT,
  p_message      TEXT,
  p_guest_secret TEXT DEFAULT NULL,
  p_encrypted    BOOLEAN DEFAULT false
)
RETURNS TABLE(id UUID, owner_reply TEXT, status TEXT, replied_at TIMESTAMPTZ, chat_history JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_role TEXT := lower(trim(coalesce(p_role, '')));
  v_message TEXT := trim(coalesce(p_message, ''));
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_ring RECORD;
BEGIN
  IF p_ring_id IS NULL THEN RAISE EXCEPTION 'Ring id is required'; END IF;
  IF v_role NOT IN ('guest','owner') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF v_message = '' THEN RAISE EXCEPTION 'Message is required'; END IF;
  IF length(v_message) > 2000 THEN RAISE EXCEPTION 'Message exceeds 2000 characters'; END IF;

  SELECT r.id, r.house_id, r.door_point_id, r.owner_reply, r.status, r.replied_at,
         r.guest_secret, COALESCE(r.chat_history, '[]'::jsonb) AS chat_history
  INTO v_ring
  FROM public.doorbell_rings r
  WHERE r.id = p_ring_id
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ring not found'; END IF;

  IF v_role = 'guest' THEN
    IF p_guest_secret IS NULL OR v_ring.guest_secret IS NULL
       OR trim(p_guest_secret) <> v_ring.guest_secret THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
    -- Enforce a soft per-ring message ceiling to bound storage.
    IF jsonb_array_length(v_ring.chat_history) >= 100 THEN
      RAISE EXCEPTION 'Conversation full';
    END IF;
  ELSE
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
    IF NOT (
      public.has_house_role(v_ring.house_id, ARRAY['owner','manager'])
      OR public.check_user_is_door_member(v_ring.door_point_id)
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  UPDATE public.doorbell_rings r
  SET
    chat_history = v_ring.chat_history || jsonb_build_array(
      jsonb_build_object('role', v_role, 'text', v_message, 'time', v_now, 'encrypted', p_encrypted)
    ),
    owner_reply = CASE WHEN v_role = 'owner' THEN v_message ELSE r.owner_reply END,
    replied_at  = CASE WHEN v_role = 'owner' THEN v_now ELSE r.replied_at END,
    status      = CASE WHEN v_role = 'owner' THEN 'responded' ELSE r.status END,
    updated_at  = v_now
  WHERE r.id = p_ring_id
  RETURNING r.id, r.owner_reply, r.status, r.replied_at, r.chat_history
  INTO id, owner_reply, status, replied_at, chat_history;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_ring_message(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- =========================================================================
-- get_guest_ring_reply_by_secret: token-bound read for guests.
-- Replaces the prior get_guest_ring_reply_by_token, which keyed off the
-- shared per-door qr_token (allowing cross-guest chat reads).
-- =========================================================================
DROP FUNCTION IF EXISTS public.get_guest_ring_reply_by_token(UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.get_guest_ring_reply_by_secret(
  p_ring_id      UUID,
  p_guest_secret TEXT
)
RETURNS TABLE(owner_reply TEXT, status TEXT, replied_at TIMESTAMPTZ, chat_history JSONB)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF p_ring_id IS NULL OR p_guest_secret IS NULL OR trim(p_guest_secret) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.owner_reply, r.status, r.replied_at, COALESCE(r.chat_history, '[]'::jsonb)
  FROM public.doorbell_rings r
  WHERE r.id = p_ring_id
    AND r.guest_secret = trim(p_guest_secret)
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_ring_reply_by_secret(UUID, TEXT) TO anon, authenticated;
