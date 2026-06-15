-- =========================================================================
-- 20260518000300_rpc_owner.sql
-- Authenticated-only RPCs: house bootstrap, member management,
-- FCM token registration, owner public-key publication.
-- =========================================================================

-- =========================================================================
-- ensure_owner_house: idempotently ensure the caller has at least one
-- house and is owner of it.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.ensure_owner_house()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;

  SELECT hm.house_id INTO v_house
  FROM public.house_members hm
  JOIN public.houses h ON h.id = hm.house_id
  WHERE hm.user_id = v_user AND h.is_active = true
  ORDER BY h.created_at ASC
  LIMIT 1;

  IF v_house IS NULL THEN
    INSERT INTO public.houses (owner_user_id, name)
    VALUES (v_user, 'Primary House')
    RETURNING id INTO v_house;

    INSERT INTO public.house_members (house_id, user_id, role)
    VALUES (v_house, v_user, 'owner')
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.owner_settings (user_id, active_house_id)
  VALUES (v_user, v_house)
  ON CONFLICT (user_id) DO UPDATE
  SET active_house_id = COALESCE(public.owner_settings.active_house_id, EXCLUDED.active_house_id);

  RETURN v_house;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_owner_house() TO authenticated;

-- =========================================================================
-- create_house
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_house(p_name TEXT)
RETURNS TABLE(id UUID, name TEXT, owner_user_id UUID, is_active BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
  v_name TEXT := nullif(trim(p_name), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'House name is required'; END IF;

  INSERT INTO public.houses (owner_user_id, name)
  VALUES (v_user, v_name)
  RETURNING houses.id INTO v_house;

  INSERT INTO public.house_members (house_id, user_id, role)
  VALUES (v_house, v_user, 'owner')
  ON CONFLICT (house_id, user_id) DO NOTHING;

  RETURN QUERY
  SELECT h.id, h.name, h.owner_user_id, h.is_active, h.created_at
  FROM public.houses h
  WHERE h.id = v_house;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_house(TEXT) TO authenticated;

-- =========================================================================
-- add_house_member_by_email
-- =========================================================================
CREATE OR REPLACE FUNCTION public.add_house_member_by_email(
  p_house_id UUID, p_email TEXT, p_role TEXT DEFAULT 'manager'
)
RETURNS TABLE(house_id UUID, user_id UUID, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_target UUID;
  v_email TEXT := lower(trim(p_email));
  v_role TEXT := lower(trim(coalesce(p_role, 'manager')));
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.is_house_owner(p_house_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'Email is required'; END IF;
  IF v_role NOT IN ('owner','manager','viewer') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  SELECT u.id INTO v_target
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  INSERT INTO public.house_members (house_id, user_id, role)
  VALUES (p_house_id, v_target, v_role)
  ON CONFLICT (house_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN QUERY SELECT p_house_id, v_target, v_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_house_member_by_email(UUID, TEXT, TEXT) TO authenticated;

-- =========================================================================
-- add_door_member_by_username
-- =========================================================================
CREATE OR REPLACE FUNCTION public.add_door_member_by_username(
  p_door_point_id UUID, p_username TEXT
)
RETURNS TABLE(door_point_id UUID, user_id UUID, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_house UUID;
  v_target UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF v_house IS NULL THEN RAISE EXCEPTION 'Unknown door point'; END IF;
  IF NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT p.id INTO v_target
  FROM public.profiles p
  WHERE lower(p.username) = lower(trim(p_username))
  LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  INSERT INTO public.door_point_members (door_point_id, user_id, house_id)
  VALUES (p_door_point_id, v_target, v_house)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT p_door_point_id, v_target, p_username;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_door_member_by_username(UUID, TEXT) TO authenticated;

-- =========================================================================
-- register_push_token: native FCM tokens, anti-hijack.
-- The unique key is (user_id, fcm_token), so collisions across users do
-- not silently steal subscriptions: each user has their own row even if
-- two devices ever ended up with the same token (which Firebase prevents
-- in practice). The previous schema allowed user_id swap; this does not.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token        TEXT,
  p_house_id     UUID DEFAULT NULL,
  p_platform     TEXT DEFAULT 'android',
  p_app_version  TEXT DEFAULT NULL,
  p_device_label TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, fcm_token TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF p_token IS NULL OR trim(p_token) = '' THEN RAISE EXCEPTION 'Push token is required'; END IF;
  IF p_house_id IS NOT NULL AND NOT public.is_house_member(p_house_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_platform NOT IN ('android','ios','web') THEN
    RAISE EXCEPTION 'Invalid platform %', p_platform;
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id, house_id, fcm_token, platform,
    app_version, device_label, is_active, last_seen_at, updated_at
  )
  VALUES (
    v_user, p_house_id, trim(p_token), p_platform,
    nullif(trim(coalesce(p_app_version, '')), ''),
    nullif(trim(coalesce(p_device_label, '')), ''),
    true,
    timezone('utc', now()), timezone('utc', now())
  )
  ON CONFLICT (user_id, fcm_token) DO UPDATE
  SET
    house_id     = COALESCE(EXCLUDED.house_id,    public.push_subscriptions.house_id),
    platform     = EXCLUDED.platform,
    app_version  = EXCLUDED.app_version,
    device_label = EXCLUDED.device_label,
    is_active    = true,
    last_seen_at = timezone('utc', now()),
    updated_at   = timezone('utc', now())
  RETURNING push_subscriptions.id, push_subscriptions.fcm_token, push_subscriptions.is_active
  INTO id, fcm_token, is_active;

  -- If the same FCM token previously belonged to another user, mark those
  -- rows inactive so they stop receiving rings.
  UPDATE public.push_subscriptions
  SET is_active = false, updated_at = timezone('utc', now())
  WHERE fcm_token = trim(p_token) AND user_id <> v_user;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_push_token(p_token TEXT)
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
  UPDATE public.push_subscriptions
  SET is_active = false, updated_at = timezone('utc', now())
  WHERE user_id = v_user AND fcm_token = trim(coalesce(p_token, ''));
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_push_token(TEXT) TO authenticated;

-- =========================================================================
-- publish_owner_public_key: the Android client uploads its Curve25519
-- public key (base64) so guests can E2E-encrypt messages to it.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.publish_owner_public_key(
  p_house_id    UUID,
  p_public_key  TEXT,
  p_device_label TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, public_key TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF p_house_id IS NULL OR NOT public.is_house_member(p_house_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_public_key IS NULL OR length(p_public_key) < 40 OR length(p_public_key) > 64 THEN
    RAISE EXCEPTION 'Invalid public key';
  END IF;

  INSERT INTO public.owner_public_keys (user_id, house_id, public_key, device_label, is_active)
  VALUES (v_user, p_house_id, p_public_key, nullif(trim(coalesce(p_device_label,'')),''), true)
  ON CONFLICT (user_id, house_id, public_key) DO UPDATE
  SET is_active = true, rotated_at = NULL
  RETURNING owner_public_keys.id, owner_public_keys.public_key, owner_public_keys.is_active
  INTO id, public_key, is_active;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_owner_public_key(UUID, TEXT, TEXT) TO authenticated;
