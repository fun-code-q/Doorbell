-- =========================================================================
-- 20260518001100_gdpr_and_schedules.sql
--
-- Batch E:
--   * delete_my_account(): GDPR Article 17 right to erasure. Removes the
--     user's auth.users row; CASCADE handles every public.* table.
--   * Owner timezone column on owner_settings (defaults to 'UTC').
--   * Per-door active hours, evaluated server-side inside
--     enforce_door_throttle so a guest scanning the QR at 03:00 gets
--     a DND-style "occupant unavailable" without waking anyone.
-- =========================================================================

-- -------------------------------------------------------------------------
-- delete_my_account: invokes the Supabase auth admin API. Because the
-- function runs SECURITY DEFINER with the postgres role, we can delete
-- from auth.users; the schema's ON DELETE CASCADE chain handles the rest.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;

  -- Audit-trail the deletion. The user_id column is NULLable so the row
  -- survives the cascade (house_id can be NULL on system events).
  INSERT INTO public.audit_log (house_id, user_id, action, table_name, record_id, details)
  VALUES (NULL, v_user, 'delete_account', 'auth.users', v_user,
          jsonb_build_object('reason', 'self_initiated', 'at', timezone('utc', now())));

  -- Defensive: explicit cleanup of anything that doesn't CASCADE from
  -- auth.users (push_subscriptions, owner_public_keys, owner_keypair_backups,
  -- owner_settings, house_invitations(accepted_user_id), all CASCADE — but
  -- list them so the intent is auditable).
  DELETE FROM public.push_subscriptions   WHERE user_id = v_user;
  DELETE FROM public.owner_public_keys    WHERE user_id = v_user;
  DELETE FROM public.owner_keypair_backups WHERE user_id = v_user;
  DELETE FROM public.owner_settings       WHERE user_id = v_user;

  -- Houses owned solely by this user get deleted (CASCADE wipes their doors
  -- and rings). Houses where this user is only a member: drop the membership.
  DELETE FROM public.house_members WHERE user_id = v_user;
  DELETE FROM public.houses WHERE owner_user_id = v_user;

  -- Finally remove from auth.users; everything else falls via CASCADE.
  DELETE FROM auth.users WHERE id = v_user;

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- -------------------------------------------------------------------------
-- Owner timezone for evaluating quiet hours. Defaults to UTC so existing
-- rows behave consistently until the owner picks one.
-- -------------------------------------------------------------------------
ALTER TABLE public.owner_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- -------------------------------------------------------------------------
-- Per-door quiet hours. We model this as an inclusive start..exclusive end
-- pair of "minutes since local midnight". This is simple, robust across
-- DST, and easy to validate. Cross-midnight ranges are supported (e.g.
-- 22:00..07:00 wraps around).
--
-- quiet_hours_start / quiet_hours_end are NULL on doors with no schedule
-- (default behaviour: always live).
-- -------------------------------------------------------------------------
ALTER TABLE public.door_points
  ADD COLUMN IF NOT EXISTS quiet_hours_start_min INTEGER,  -- 0..1440
  ADD COLUMN IF NOT EXISTS quiet_hours_end_min   INTEGER;

ALTER TABLE public.door_points
  DROP CONSTRAINT IF EXISTS quiet_hours_range_chk;
ALTER TABLE public.door_points
  ADD CONSTRAINT quiet_hours_range_chk
  CHECK (
    (quiet_hours_start_min IS NULL AND quiet_hours_end_min IS NULL)
    OR (
      quiet_hours_start_min BETWEEN 0 AND 1440
      AND quiet_hours_end_min BETWEEN 0 AND 1440
      AND quiet_hours_start_min <> quiet_hours_end_min
    )
  );

-- -------------------------------------------------------------------------
-- Replace enforce_door_throttle to honour quiet hours. The new signature
-- adds the start/end/tz parameters. We refactor the call site in
-- create_doorbell_ring_by_token to pass them.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_door_throttle(
  p_door_point_id    UUID,
  p_max_per_hour     INTEGER,
  p_auto_dnd_after   INTEGER,
  p_auto_dnd_window_min INTEGER,
  p_dnd_until        TIMESTAMPTZ,
  p_quiet_start_min  INTEGER DEFAULT NULL,
  p_quiet_end_min    INTEGER DEFAULT NULL,
  p_timezone         TEXT    DEFAULT 'UTC'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_now          TIMESTAMPTZ := timezone('utc', now());
  v_hour_ago     TIMESTAMPTZ := v_now - INTERVAL '1 hour';
  v_window_ago   TIMESTAMPTZ;
  v_total        INTEGER;
  v_unanswered   INTEGER;
  v_local_min    INTEGER;
  v_local        TIMESTAMP;
BEGIN
  -- 0. Quiet hours (Batch E #8). Treated like DND but doesn't escalate.
  IF p_quiet_start_min IS NOT NULL AND p_quiet_end_min IS NOT NULL THEN
    BEGIN
      v_local := v_now AT TIME ZONE p_timezone;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_local := v_now AT TIME ZONE 'UTC';
    END;
    v_local_min := EXTRACT(HOUR FROM v_local)::INT * 60 + EXTRACT(MINUTE FROM v_local)::INT;

    IF p_quiet_start_min < p_quiet_end_min THEN
      -- Non-wrapping (e.g. 13:00..14:00): in-range = quiet.
      IF v_local_min >= p_quiet_start_min AND v_local_min < p_quiet_end_min THEN
        RAISE EXCEPTION 'Door is in quiet hours' USING ERRCODE = 'P0006';
      END IF;
    ELSE
      -- Wrapping (e.g. 22:00..07:00): outside [end..start) = quiet.
      IF v_local_min >= p_quiet_start_min OR v_local_min < p_quiet_end_min THEN
        RAISE EXCEPTION 'Door is in quiet hours' USING ERRCODE = 'P0006';
      END IF;
    END IF;
  END IF;

  -- 1. Owner-issued DND wins immediately.
  IF p_dnd_until IS NOT NULL AND p_dnd_until > v_now THEN
    RAISE EXCEPTION 'Door is in Do Not Disturb mode' USING ERRCODE = 'P0006';
  END IF;

  -- 2. Global cap.
  SELECT COUNT(*) INTO v_total
  FROM public.doorbell_rings r
  WHERE r.door_point_id = p_door_point_id
    AND r.created_at >= v_hour_ago
    AND r.status <> 'dismissed';
  IF v_total >= p_max_per_hour THEN
    RAISE EXCEPTION 'Doorbell paused — too many rings recently' USING ERRCODE = 'P0007';
  END IF;

  -- 3. Auto-DND escalation.
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

-- -------------------------------------------------------------------------
-- Patch create_doorbell_ring_by_token to pass the new throttle args.
-- We re-emit the full function body — easier to verify than ALTER FUNCTION.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_doorbell_ring_by_token(
  p_qr_token                TEXT,
  p_guest_message           TEXT DEFAULT NULL,
  p_guest_message_encrypted BOOLEAN DEFAULT false,
  p_user_agent_hash         TEXT DEFAULT NULL,
  p_latitude                DOUBLE PRECISION DEFAULT NULL,
  p_longitude               DOUBLE PRECISION DEFAULT NULL,
  p_geo_accuracy_m          DOUBLE PRECISION DEFAULT NULL,
  p_ciphertexts             TEXT[] DEFAULT NULL,
  p_idempotency_key         TEXT DEFAULT NULL
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
  v_quiet_start       INTEGER;
  v_quiet_end         INTEGER;
  v_owner_tz          TEXT;
  v_distance_m        DOUBLE PRECISION;
  v_now               TIMESTAMPTZ := timezone('utc', now());
  v_ip_hash           TEXT := nullif(trim(coalesce(p_user_agent_hash, '')), '');
  v_window_start      TIMESTAMPTZ := date_trunc('minute', v_now);
  v_current_count     INTEGER;
  v_clean_msg         TEXT;
  v_history           JSONB := '[]'::jsonb;
  v_new_id            UUID;
  v_secret            TEXT;
  v_existing          RECORD;
BEGIN
  -- Idempotency.
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT r.id, r.house_id, r.door_point_id, r.guest_secret, r.created_at
    INTO v_existing
    FROM public.doorbell_rings r
    WHERE r.idempotency_key = trim(p_idempotency_key)
      AND r.created_at > v_now - INTERVAL '5 minutes'
    LIMIT 1;
    IF FOUND THEN
      id := v_existing.id; house_id := v_existing.house_id;
      door_point_id := v_existing.door_point_id; guest_secret := v_existing.guest_secret;
      created_at := v_existing.created_at;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  SELECT dp.id, dp.house_id, dp.name, dp.latitude, dp.longitude, dp.geofence_radius_m,
         dp.max_rings_per_hour, dp.auto_dnd_after_unanswered, dp.auto_dnd_window_minutes,
         dp.dnd_until,
         dp.quiet_hours_start_min, dp.quiet_hours_end_min
  INTO v_dp_id, v_house_id, v_door_name, v_door_lat, v_door_lon, v_door_radius,
       v_max_per_hour, v_auto_dnd_after, v_auto_dnd_window, v_dnd_until,
       v_quiet_start, v_quiet_end
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token AND dp.is_active = true
  LIMIT 1;
  IF v_dp_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive QR code' USING ERRCODE = 'P0001';
  END IF;

  -- Owner timezone for quiet-hours evaluation: pick the house's primary owner's setting.
  SELECT os.timezone INTO v_owner_tz
  FROM public.owner_settings os
  JOIN public.houses h ON h.owner_user_id = os.user_id
  WHERE h.id = v_house_id
  LIMIT 1;
  v_owner_tz := COALESCE(v_owner_tz, 'UTC');

  PERFORM public.enforce_door_throttle(
    v_dp_id, v_max_per_hour, v_auto_dnd_after, v_auto_dnd_window, v_dnd_until,
    v_quiet_start, v_quiet_end, v_owner_tz
  );

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

  IF v_door_lat IS NOT NULL AND v_door_lon IS NOT NULL THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Location required for this door' USING ERRCODE = 'P0003';
    END IF;
    v_distance_m := public._haversine_meters(v_door_lat, v_door_lon, p_latitude, p_longitude);
    IF v_distance_m > (v_door_radius + LEAST(COALESCE(p_geo_accuracy_m, 0), 100)) THEN
      RAISE EXCEPTION 'Outside the door''s allowed area' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  v_clean_msg := nullif(trim(coalesce(p_guest_message, '')), '');
  IF v_clean_msg IS NOT NULL AND length(v_clean_msg) > 2000 THEN
    RAISE EXCEPTION 'Message too long' USING ERRCODE = 'P0005';
  END IF;
  IF v_clean_msg IS NOT NULL THEN
    v_history := jsonb_build_array(
      jsonb_build_object(
        'role',        'guest',
        'text',        v_clean_msg,
        'time',        v_now,
        'encrypted',   p_guest_message_encrypted,
        'ciphertexts', COALESCE(to_jsonb(p_ciphertexts), 'null'::jsonb)
      )
    );
  END IF;

  v_secret := public.generate_qr_token();
  INSERT INTO public.doorbell_rings (
    house_id, door_point_id, door_location,
    guest_message, chat_history, guest_message_encrypted,
    guest_message_ciphertexts, guest_secret, ip_hash, idempotency_key,
    guest_latitude, guest_longitude, guest_geo_accuracy_m
  ) VALUES (
    v_house_id, v_dp_id, v_door_name,
    v_clean_msg, v_history, p_guest_message_encrypted,
    p_ciphertexts, v_secret, v_ip_hash,
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    p_latitude, p_longitude, p_geo_accuracy_m
  )
  RETURNING doorbell_rings.id INTO v_new_id;

  RETURN QUERY
  SELECT r.id, r.house_id, r.door_point_id, r.guest_secret, r.created_at
  FROM public.doorbell_rings r WHERE r.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_doorbell_ring_by_token(
  TEXT, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT
) TO anon, authenticated;

-- -------------------------------------------------------------------------
-- set_door_quiet_hours: owner-controllable.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_door_quiet_hours(
  p_door_point_id UUID,
  p_start_min     INTEGER,
  p_end_min       INTEGER
)
RETURNS TABLE(id UUID, quiet_hours_start_min INTEGER, quiet_hours_end_min INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF v_house IS NULL OR NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_start_min IS NOT NULL AND (p_start_min < 0 OR p_start_min > 1440) THEN
    RAISE EXCEPTION 'Start must be 0..1440';
  END IF;
  IF p_end_min IS NOT NULL AND (p_end_min < 0 OR p_end_min > 1440) THEN
    RAISE EXCEPTION 'End must be 0..1440';
  END IF;

  UPDATE public.door_points
  SET quiet_hours_start_min = p_start_min,
      quiet_hours_end_min = p_end_min,
      updated_at = timezone('utc', now())
  WHERE id = p_door_point_id
  RETURNING door_points.id, door_points.quiet_hours_start_min, door_points.quiet_hours_end_min
  INTO id, quiet_hours_start_min, quiet_hours_end_min;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_door_quiet_hours(UUID, INTEGER, INTEGER) TO authenticated;
