-- =========================================================================
-- 20260518001400_owner_customization.sql
--
-- Owner-side customization:
--   #3 quick_replies on owner_settings (TEXT[], up to 5 entries)
--   #4 ringtone_resource on door_points (named raw resource or system uri)
--   #14 display_name + greeting on profiles + house guest_welcome_message
--
-- Plus a new RPC `resolve_qr_token_v2` that returns the optional greeting
-- so the guest page can show "Akhil's place" instead of "Resolving location".
-- =========================================================================

-- Owner-customisable quick replies. Default null = use the bundled strings.
ALTER TABLE public.owner_settings
  ADD COLUMN IF NOT EXISTS quick_replies TEXT[];

-- Per-door ringtone identifier. Examples:
--   * NULL                → use bundled default
--   * 'system:default'    → user's system ringtone
--   * 'bundled:soft'      → bundled raw resource name suffix
ALTER TABLE public.door_points
  ADD COLUMN IF NOT EXISTS ringtone_resource TEXT;

-- Owner display name + welcome message for the guest landing.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE public.houses
  ADD COLUMN IF NOT EXISTS guest_welcome_message TEXT;

-- =========================================================================
-- Patch resolve_qr_token to expose the welcome message + owner display name
-- so the guest UI can render a friendlier landing.
-- =========================================================================
DROP FUNCTION IF EXISTS public.resolve_qr_token(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_qr_token(p_qr_token TEXT)
RETURNS TABLE(
  door_point_id        UUID,
  door_name            TEXT,
  house_id             UUID,
  house_welcome        TEXT,
  owner_display_name   TEXT,
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  geofence_radius_m    INTEGER,
  owner_public_keys    TEXT[],
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
    h.guest_welcome_message,
    -- The owner's display name is the most-active owner of the house —
    -- in the rare multi-owner case we pick the first by created_at.
    (SELECT COALESCE(NULLIF(trim(p.display_name), ''), p.username)
     FROM public.profiles p
     JOIN public.house_members hm ON hm.user_id = p.id
     WHERE hm.house_id = dp.house_id AND hm.role = 'owner'
     ORDER BY hm.created_at ASC LIMIT 1) AS owner_display_name,
    dp.latitude, dp.longitude, dp.geofence_radius_m,
    COALESCE(
      ARRAY(
        SELECT k.public_key
        FROM public.owner_public_keys k
        WHERE k.house_id = dp.house_id AND k.is_active = true
        ORDER BY k.created_at ASC
      ),
      ARRAY[]::TEXT[]
    ) AS owner_public_keys,
    (SELECT k.algorithm
     FROM public.owner_public_keys k
     WHERE k.house_id = dp.house_id AND k.is_active = true
     ORDER BY k.created_at ASC LIMIT 1) AS encryption_algorithm
  FROM public.door_points dp
  JOIN public.houses h ON h.id = dp.house_id
  WHERE dp.qr_token = p_qr_token AND dp.is_active = true
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_qr_token(TEXT) TO anon, authenticated;

-- =========================================================================
-- RPC: set_door_ringtone
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_door_ringtone(
  p_door_point_id UUID,
  p_ringtone TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_house UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF v_house IS NULL OR NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_ringtone IS NOT NULL AND length(p_ringtone) > 128 THEN
    RAISE EXCEPTION 'Ringtone identifier too long';
  END IF;
  UPDATE public.door_points
  SET ringtone_resource = nullif(trim(coalesce(p_ringtone, '')), ''),
      updated_at = timezone('utc', now())
  WHERE id = p_door_point_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_door_ringtone(UUID, TEXT) TO authenticated;

-- =========================================================================
-- RPC: set_quick_replies (owner-level; up to 5)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_quick_replies(p_replies TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_clean TEXT[];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF p_replies IS NULL THEN
    v_clean := NULL;
  ELSE
    -- Trim, drop empties, cap each at 200 chars, cap count at 5.
    SELECT array_agg(t)
    INTO v_clean
    FROM (
      SELECT nullif(trim(left(t, 200)), '') AS t
      FROM unnest(p_replies) AS t
      LIMIT 5
    ) s
    WHERE t IS NOT NULL;
  END IF;
  UPDATE public.owner_settings
  SET quick_replies = v_clean,
      updated_at = timezone('utc', now())
  WHERE user_id = v_user;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_quick_replies(TEXT[]) TO authenticated;

-- =========================================================================
-- RPC: set_profile_display_name + set_house_welcome
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_profile_display_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_clean TEXT := nullif(trim(left(coalesce(p_name, ''), 50)), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  UPDATE public.profiles SET display_name = v_clean, updated_at = timezone('utc', now())
  WHERE id = v_user;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_profile_display_name(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_house_welcome(
  p_house_id UUID,
  p_welcome  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_clean TEXT := nullif(trim(left(coalesce(p_welcome, ''), 200)), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_house_role(p_house_id, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE public.houses SET guest_welcome_message = v_clean, updated_at = timezone('utc', now())
  WHERE id = p_house_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_house_welcome(UUID, TEXT) TO authenticated;
