-- QR Doorbell Database Setup (Master Script v2.1)
-- Consolidated from Setup + Recursion Fixes. Idempotent and Secure.
-- Run this in your Supabase SQL Editor.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. UTILITY FUNCTIONS
CREATE OR REPLACE FUNCTION generate_qr_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(16), 'hex');
END;
$$ LANGUAGE plpgsql;

-- 3. CORE TABLES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.houses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.house_members (
  house_id UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (house_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.door_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  house_id UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  qr_token TEXT DEFAULT generate_qr_token() UNIQUE,
  qr_color TEXT DEFAULT '#000000',
  qr_bg_color TEXT DEFAULT '#ffffff',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.door_point_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  door_point_id UUID NOT NULL REFERENCES public.door_points(id) ON DELETE CASCADE,
  house_id UUID REFERENCES public.houses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_muted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (door_point_id, user_id)
);

ALTER TABLE public.door_point_members
  ADD COLUMN IF NOT EXISTS house_id UUID;

UPDATE public.door_point_members dpm
SET house_id = dp.house_id
FROM public.door_points dp
WHERE dp.id = dpm.door_point_id
  AND dpm.house_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'door_point_members_house_id_fkey'
  ) THEN
    ALTER TABLE public.door_point_members
      ADD CONSTRAINT door_point_members_house_id_fkey
      FOREIGN KEY (house_id) REFERENCES public.houses(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_door_point_members_house_id
  ON public.door_point_members(house_id);

CREATE TABLE IF NOT EXISTS public.doorbell_rings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  house_id UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  door_point_id UUID REFERENCES public.door_points(id) ON DELETE SET NULL,
  door_location TEXT NOT NULL,
  guest_name TEXT,
  guest_message TEXT,
  chat_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  guest_message_encrypted BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'acknowledged', 'responded', 'dismissed')),
  owner_reply TEXT DEFAULT '',
  replied_at TIMESTAMPTZ,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.owner_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  active_house_id UUID REFERENCES public.houses(id) ON DELETE SET NULL,
  sound_enabled BOOLEAN DEFAULT true,
  vibration_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  language TEXT DEFAULT 'en',
  auto_logout_minutes INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.owner_settings
  ADD COLUMN IF NOT EXISTS auto_logout_minutes INTEGER DEFAULT 15;
UPDATE public.owner_settings
SET auto_logout_minutes = 15
WHERE auto_logout_minutes IS NULL;

ALTER TABLE public.doorbell_rings
  ADD COLUMN IF NOT EXISTS chat_history JSONB DEFAULT '[]'::jsonb;
UPDATE public.doorbell_rings
SET chat_history = CASE
  WHEN nullif(trim(coalesce(guest_message, '')), '') IS NOT NULL THEN jsonb_build_array(
    jsonb_build_object(
      'role', 'guest',
      'text', trim(guest_message),
      'time', created_at
    )
  )
  ELSE '[]'::jsonb
END
WHERE chat_history IS NULL;
ALTER TABLE public.doorbell_rings
  ALTER COLUMN chat_history SET DEFAULT '[]'::jsonb;
ALTER TABLE public.doorbell_rings
  ALTER COLUMN chat_history SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  house_id UUID REFERENCES public.houses(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. ACCESS HELPER FUNCTIONS (Stops RLS recursion)
-- These use SECURITY DEFINER and SET row_security = off to bypass RLS internally
DROP FUNCTION IF EXISTS public.is_house_owner(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.is_house_owner(p_house_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.houses h
    WHERE h.id = p_house_id AND h.owner_user_id = auth.uid()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.is_house_member(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.is_house_member(p_house_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.house_members hm
    WHERE hm.house_id = p_house_id AND hm.user_id = auth.uid()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.has_house_role(UUID, TEXT[]) CASCADE;
CREATE OR REPLACE FUNCTION public.has_house_role(p_house_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_house_id IS NULL OR p_roles IS NULL OR array_length(p_roles, 1) IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.house_members hm
    WHERE hm.house_id = p_house_id
      AND hm.user_id = auth.uid()
      AND hm.role = ANY(p_roles)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.check_user_is_door_member(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.check_user_is_door_member(p_door_point_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.door_point_members dpm
    WHERE dpm.door_point_id = p_door_point_id
      AND dpm.user_id = auth.uid()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.door_point_house_id(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.door_point_house_id(p_door_point_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_house_id UUID;
BEGIN
  SELECT dp.house_id
  INTO v_house_id
  FROM public.door_points dp
  WHERE dp.id = p_door_point_id
  LIMIT 1;

  RETURN v_house_id;
END;
$$;

DROP FUNCTION IF EXISTS public.sync_door_point_member_house_id() CASCADE;
CREATE OR REPLACE FUNCTION public.sync_door_point_member_house_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT dp.house_id
  INTO NEW.house_id
  FROM public.door_points dp
  WHERE dp.id = NEW.door_point_id
  LIMIT 1;

  IF NEW.house_id IS NULL THEN
    RAISE EXCEPTION 'Invalid door point id';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP TRIGGER IF EXISTS trg_sync_door_point_member_house_id ON public.door_point_members;
CREATE TRIGGER trg_sync_door_point_member_house_id
BEFORE INSERT OR UPDATE OF door_point_id ON public.door_point_members
FOR EACH ROW
EXECUTE FUNCTION public.sync_door_point_member_house_id();

-- 5. BUSINESS LOGIC FUNCTIONS
DROP FUNCTION IF EXISTS public.ensure_owner_house() CASCADE;
CREATE OR REPLACE FUNCTION public.ensure_owner_house()
RETURNS UUID AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  SELECT hm.house_id INTO v_house
  FROM public.house_members hm
  JOIN public.houses h ON h.id = hm.house_id
  WHERE hm.user_id = v_user AND h.is_active = true
  ORDER BY h.created_at ASC LIMIT 1;
  IF v_house IS NULL THEN
    INSERT INTO public.houses (owner_user_id, name) VALUES (v_user, 'Primary House') RETURNING id INTO v_house;
    INSERT INTO public.house_members (house_id, user_id, role) VALUES (v_house, v_user, 'owner') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.owner_settings (user_id, active_house_id)
  VALUES (v_user, v_house) ON CONFLICT (user_id) DO UPDATE SET active_house_id = COALESCE(public.owner_settings.active_house_id, EXCLUDED.active_house_id);
  RETURN v_house;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.create_house(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.create_house(p_name TEXT)
RETURNS TABLE(id UUID, name TEXT, owner_user_id UUID, is_active BOOLEAN, created_at TIMESTAMPTZ) AS $$
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
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.add_house_member_by_email(UUID, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.add_house_member_by_email(p_house_id UUID, p_email TEXT, p_role TEXT DEFAULT 'manager')
RETURNS TABLE(house_id UUID, user_id UUID, role TEXT) AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_target UUID;
  v_email TEXT := lower(trim(p_email));
  v_role TEXT := lower(trim(coalesce(p_role, 'manager')));
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.is_house_owner(p_house_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'Email is required'; END IF;
  IF v_role NOT IN ('owner', 'manager', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT u.id INTO v_target
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  INSERT INTO public.house_members (house_id, user_id, role)
  VALUES (p_house_id, v_target, v_role)
  ON CONFLICT (house_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN QUERY
  SELECT p_house_id, v_target, v_role;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.add_door_member_by_username(UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.add_door_member_by_username(p_door_point_id UUID, p_username TEXT)
RETURNS TABLE(door_point_id UUID, user_id UUID, username TEXT) AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_house UUID;
  v_target UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  v_house := public.door_point_house_id(p_door_point_id);
  IF NOT public.is_house_member(v_house) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT p.id INTO v_target FROM public.profiles p WHERE lower(p.username) = lower(trim(p_username)) LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  INSERT INTO public.door_point_members (door_point_id, user_id, house_id)
  VALUES (p_door_point_id, v_target, v_house)
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT p_door_point_id, v_target, p_username;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

-- 5a. GUEST-SIDE RPC FUNCTIONS
-- These allow unauthenticated (anon) guests to resolve tokens and ring the bell securely

DROP FUNCTION IF EXISTS public.resolve_qr_token(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_qr_token(p_qr_token TEXT)
RETURNS TABLE(door_point_id UUID, door_name TEXT, house_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT dp.id, dp.name, dp.house_id
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token
    AND dp.is_active = true;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.create_doorbell_ring_by_token(TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.create_doorbell_ring_by_token(
  p_qr_token TEXT,
  p_guest_message TEXT DEFAULT NULL,
  p_guest_message_encrypted BOOLEAN DEFAULT false,
  p_user_agent_hash TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, house_id UUID, door_point_id UUID, created_at TIMESTAMPTZ) AS $$
DECLARE
  v_dp_id UUID;
  v_house_id UUID;
  v_door_name TEXT;
  v_new_id UUID;
  v_clean_guest_message TEXT;
  v_history JSONB := '[]'::jsonb;
BEGIN
  v_clean_guest_message := nullif(trim(coalesce(p_guest_message, '')), '');
  IF v_clean_guest_message IS NOT NULL THEN
    v_history := jsonb_build_array(
      jsonb_build_object(
        'role', 'guest',
        'text', v_clean_guest_message,
        'time', timezone('utc'::text, now())
      )
    );
  END IF;

  -- 1. Resolve token to door
  SELECT dp.id, dp.house_id, dp.name
  INTO v_dp_id, v_house_id, v_door_name
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token AND dp.is_active = true;

  IF v_dp_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive QR code';
  END IF;

  -- 2. Insert ring
  INSERT INTO public.doorbell_rings (
    house_id,
    door_point_id,
    door_location,
    guest_message,
    chat_history,
    guest_message_encrypted,
    ip_hash
  )
  VALUES (
    v_house_id,
    v_dp_id,
    v_door_name,
    v_clean_guest_message,
    v_history,
    p_guest_message_encrypted,
    p_user_agent_hash
  )
  RETURNING doorbell_rings.id INTO v_new_id;

  RETURN QUERY
  SELECT r.id, r.house_id, r.door_point_id, r.created_at
  FROM public.doorbell_rings r
  WHERE r.id = v_new_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.append_ring_message(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.append_ring_message(UUID, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.append_ring_message(
  p_ring_id UUID,
  p_role TEXT,
  p_message TEXT,
  p_qr_token TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, owner_reply TEXT, status TEXT, replied_at TIMESTAMPTZ, chat_history JSONB) AS $$
DECLARE
  v_role TEXT := lower(trim(coalesce(p_role, '')));
  v_message TEXT := trim(coalesce(p_message, ''));
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_ring RECORD;
BEGIN
  IF p_ring_id IS NULL THEN
    RAISE EXCEPTION 'Ring id is required';
  END IF;
  IF v_role NOT IN ('guest', 'owner') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF v_message = '' THEN
    RAISE EXCEPTION 'Message is required';
  END IF;
  IF length(v_message) > 500 THEN
    RAISE EXCEPTION 'Message exceeds 500 characters';
  END IF;

  SELECT
    r.id,
    r.house_id,
    r.door_point_id,
    r.owner_reply,
    r.status,
    r.replied_at,
    COALESCE(r.chat_history, '[]'::jsonb) AS chat_history,
    dp.qr_token
  INTO v_ring
  FROM public.doorbell_rings r
  LEFT JOIN public.door_points dp ON dp.id = r.door_point_id
  WHERE r.id = p_ring_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ring not found';
  END IF;

  IF v_role = 'guest' THEN
    IF p_qr_token IS NULL OR trim(p_qr_token) = '' THEN
      RAISE EXCEPTION 'QR token is required';
    END IF;
    IF v_ring.qr_token IS NULL OR trim(p_qr_token) <> v_ring.qr_token THEN
      RAISE EXCEPTION 'Token mismatch';
    END IF;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Auth required';
    END IF;
    IF NOT (
      public.has_house_role(v_ring.house_id, ARRAY['owner', 'manager'])
      OR public.check_user_is_door_member(v_ring.door_point_id)
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  UPDATE public.doorbell_rings r
  SET
    chat_history = v_ring.chat_history || jsonb_build_array(
      jsonb_build_object(
        'role', v_role,
        'text', v_message,
        'time', v_now
      )
    ),
    owner_reply = CASE WHEN v_role = 'owner' THEN v_message ELSE r.owner_reply END,
    replied_at = CASE WHEN v_role = 'owner' THEN v_now ELSE r.replied_at END,
    status = CASE WHEN v_role = 'owner' THEN 'responded' ELSE 'waiting' END,
    updated_at = v_now
  WHERE r.id = p_ring_id
  RETURNING r.id, r.owner_reply, r.status, r.replied_at, r.chat_history
  INTO id, owner_reply, status, replied_at, chat_history;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.get_guest_ring_reply_by_token(UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.get_guest_ring_reply_by_token(
  p_ring_id UUID,
  p_qr_token TEXT
)
RETURNS TABLE(owner_reply TEXT, status TEXT, replied_at TIMESTAMPTZ, chat_history JSONB) AS $$
BEGIN
  IF p_ring_id IS NULL OR p_qr_token IS NULL OR trim(p_qr_token) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.owner_reply, r.status, r.replied_at, COALESCE(r.chat_history, '[]'::jsonb)
  FROM public.doorbell_rings r
  JOIN public.door_points dp ON dp.id = r.door_point_id
  WHERE r.id = p_ring_id
    AND dp.qr_token = p_qr_token
  LIMIT 1;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

GRANT EXECUTE ON FUNCTION public.resolve_qr_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_doorbell_ring_by_token(TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_ring_message(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guest_ring_reply_by_token(UUID, TEXT) TO anon, authenticated;
GRANT SELECT (id, house_id, door_point_id, door_location, status, owner_reply, replied_at, chat_history, created_at) ON public.doorbell_rings TO anon;

-- 6. ROW LEVEL SECURITY (Flattened Subqueries)
ALTER TABLE public.houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_point_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doorbell_rings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 6a. HOUSES Policies (Recursion Free)
DROP POLICY IF EXISTS houses_select_member ON public.houses;
CREATE POLICY houses_select_member ON public.houses FOR SELECT TO authenticated USING (
  owner_user_id = auth.uid() OR public.is_house_member(id)
);
DROP POLICY IF EXISTS houses_insert_owner ON public.houses;
CREATE POLICY houses_insert_owner ON public.houses FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
DROP POLICY IF EXISTS houses_update_owner ON public.houses;
CREATE POLICY houses_update_owner ON public.houses FOR UPDATE TO authenticated USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS houses_delete_owner ON public.houses;
CREATE POLICY houses_delete_owner ON public.houses FOR DELETE TO authenticated USING (owner_user_id = auth.uid());

-- 6b. DOOR_POINTS Policies (Recursion Free)
DROP POLICY IF EXISTS door_points_select_member ON public.door_points;
CREATE POLICY door_points_select_member ON public.door_points FOR SELECT TO authenticated USING (
  public.is_house_member(house_id) OR public.check_user_is_door_member(id)
);
DROP POLICY IF EXISTS door_points_manage_owner ON public.door_points;
DROP POLICY IF EXISTS door_points_manage_house_operator ON public.door_points;
CREATE POLICY door_points_manage_house_operator ON public.door_points FOR ALL TO authenticated
USING (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
)
WITH CHECK (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
);

-- 6c. RINGS Policies (Recursion Free)
DROP POLICY IF EXISTS rings_select_member ON public.doorbell_rings;
CREATE POLICY rings_select_member ON public.doorbell_rings FOR SELECT TO authenticated USING (
  public.is_house_member(house_id) OR public.check_user_is_door_member(door_point_id)
);
DROP POLICY IF EXISTS rings_select_guest ON public.doorbell_rings;
CREATE POLICY rings_select_guest ON public.doorbell_rings FOR SELECT TO anon USING (
  status IN ('waiting', 'acknowledged', 'responded', 'dismissed')
);
DROP POLICY IF EXISTS rings_insert_guest ON public.doorbell_rings;
DROP POLICY IF EXISTS rings_insert_member ON public.doorbell_rings;
CREATE POLICY rings_insert_member ON public.doorbell_rings FOR INSERT TO authenticated
WITH CHECK (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
  OR public.check_user_is_door_member(door_point_id)
);
DROP POLICY IF EXISTS rings_manage_owner ON public.doorbell_rings;
DROP POLICY IF EXISTS rings_update_member ON public.doorbell_rings;
CREATE POLICY rings_update_member ON public.doorbell_rings FOR UPDATE TO authenticated
USING (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
  OR public.check_user_is_door_member(door_point_id)
)
WITH CHECK (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
  OR public.check_user_is_door_member(door_point_id)
);
DROP POLICY IF EXISTS rings_delete_owner ON public.doorbell_rings;
CREATE POLICY rings_delete_owner ON public.doorbell_rings FOR DELETE TO authenticated USING (
  public.has_house_role(house_id, ARRAY['owner'])
);

-- 6d. HOUSE_MEMBERS (Recursion Free)
DROP POLICY IF EXISTS house_members_select ON public.house_members;
CREATE POLICY house_members_select ON public.house_members FOR SELECT TO authenticated USING (
  public.is_house_member(house_id)
);
DROP POLICY IF EXISTS house_members_manage_owner ON public.house_members;
CREATE POLICY house_members_manage_owner ON public.house_members FOR ALL TO authenticated USING (
  public.has_house_role(house_id, ARRAY['owner'])
);

-- 6e. DOOR_POINT_MEMBERS (Recursion Free)
DROP POLICY IF EXISTS door_point_members_select ON public.door_point_members;
CREATE POLICY door_point_members_select ON public.door_point_members FOR SELECT TO authenticated USING (
  public.is_house_member(house_id) OR user_id = auth.uid()
);
DROP POLICY IF EXISTS door_point_members_manage_owner ON public.door_point_members;
DROP POLICY IF EXISTS door_point_members_manage_operator ON public.door_point_members;
CREATE POLICY door_point_members_manage_operator ON public.door_point_members FOR ALL TO authenticated
USING (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
)
WITH CHECK (
  public.has_house_role(house_id, ARRAY['owner', 'manager'])
);
DROP POLICY IF EXISTS door_point_members_update_self ON public.door_point_members;
CREATE POLICY door_point_members_update_self ON public.door_point_members FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- 6f. PROFILES Policies
DROP POLICY IF EXISTS profiles_public_select ON public.profiles;
CREATE POLICY profiles_public_select ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- 6g. OWNER SETTINGS Policies
DROP POLICY IF EXISTS owner_settings_select_self ON public.owner_settings;
CREATE POLICY owner_settings_select_self ON public.owner_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS owner_settings_insert_self ON public.owner_settings;
CREATE POLICY owner_settings_insert_self ON public.owner_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS owner_settings_update_self ON public.owner_settings;
CREATE POLICY owner_settings_update_self ON public.owner_settings FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS owner_settings_delete_self ON public.owner_settings;
CREATE POLICY owner_settings_delete_self ON public.owner_settings FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 6h. AUDIT LOG Policies
DROP POLICY IF EXISTS audit_log_select_house_member ON public.audit_log;
CREATE POLICY audit_log_select_house_member ON public.audit_log FOR SELECT TO authenticated USING (
  public.is_house_member(house_id)
);

-- 7. TRIGGERS (Auto-Profile & Updated At)
DROP FUNCTION IF EXISTS public.log_audit_event() CASCADE;
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  v_new JSONB := COALESCE(to_jsonb(NEW), '{}'::jsonb);
  v_old JSONB := COALESCE(to_jsonb(OLD), '{}'::jsonb);
  v_house_id UUID;
  v_record_id UUID;
  v_action TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_house_id := NULLIF(v_old->>'house_id', '')::UUID;
    v_record_id := NULLIF(v_old->>'id', '')::UUID;
  ELSE
    v_house_id := NULLIF(v_new->>'house_id', '')::UUID;
    v_record_id := NULLIF(v_new->>'id', '')::UUID;
  END IF;

  IF v_house_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      v_house_id := public.door_point_house_id(NULLIF(v_old->>'door_point_id', '')::UUID);
    ELSE
      v_house_id := public.door_point_house_id(NULLIF(v_new->>'door_point_id', '')::UUID);
    END IF;
  END IF;

  v_action := lower(TG_OP) || '_' || TG_TABLE_NAME;

  INSERT INTO public.audit_log (house_id, user_id, action, table_name, record_id, details)
  VALUES (
    v_house_id,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_record_id,
    jsonb_build_object(
      'operation', TG_OP,
      'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_new END,
      'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE v_old END
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'log_audit_event failed on %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, 'user_' || substr(replace(NEW.id::text, '-', ''), 1, 8))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP FUNCTION IF EXISTS public.ensure_door_owner_membership() CASCADE;
CREATE OR REPLACE FUNCTION public.ensure_door_owner_membership()
RETURNS TRIGGER AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT h.owner_user_id
  INTO v_owner
  FROM public.houses h
  WHERE h.id = NEW.house_id
  LIMIT 1;

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.door_point_members (door_point_id, house_id, user_id, is_muted)
    VALUES (NEW.id, NEW.house_id, v_owner, false)
    ON CONFLICT (door_point_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP TRIGGER IF EXISTS trg_ensure_door_owner_membership ON public.door_points;
CREATE TRIGGER trg_ensure_door_owner_membership
AFTER INSERT ON public.door_points
FOR EACH ROW
EXECUTE FUNCTION public.ensure_door_owner_membership();

INSERT INTO public.door_point_members (door_point_id, house_id, user_id, is_muted)
SELECT dp.id, dp.house_id, h.owner_user_id, false
FROM public.door_points dp
JOIN public.houses h ON h.id = dp.house_id
ON CONFLICT (door_point_id, user_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_audit_door_points ON public.door_points;
CREATE TRIGGER trg_audit_door_points
AFTER INSERT OR UPDATE OR DELETE ON public.door_points
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_audit_door_point_members ON public.door_point_members;
CREATE TRIGGER trg_audit_door_point_members
AFTER INSERT OR UPDATE OR DELETE ON public.door_point_members
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_audit_house_members ON public.house_members;
CREATE TRIGGER trg_audit_house_members
AFTER INSERT OR UPDATE OR DELETE ON public.house_members
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_audit_doorbell_rings ON public.doorbell_rings;
CREATE TRIGGER trg_audit_doorbell_rings
AFTER INSERT OR UPDATE OR DELETE ON public.doorbell_rings
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_event();

-- 8. REALTIME
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'doorbell_rings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.doorbell_rings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'door_points') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.door_points;
  END IF;
END $$;
DROP POLICY IF EXISTS audit_log_delete_owner ON public.audit_log;
CREATE POLICY audit_log_delete_owner ON public.audit_log 
FOR DELETE TO authenticated 
USING (
  public.is_house_owner(house_id)
);

-- 9. PUSH NOTIFICATIONS (Expo + Edge Function Webhook)
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('push_ring_webhook_url', NULL)
ON CONFLICT (setting_key) DO NOTHING;

REVOKE ALL ON TABLE public.system_settings FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.touch_system_settings_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.touch_system_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER trg_touch_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_system_settings_updated_at();

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  house_id UUID REFERENCES public.houses(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  app_version TEXT,
  device_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_house_id
  ON public.push_subscriptions(house_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_is_active
  ON public.push_subscriptions(is_active);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_self
ON public.push_subscriptions
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_insert_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_self
ON public.push_subscriptions
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_update_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_self
ON public.push_subscriptions
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_delete_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_self
ON public.push_subscriptions
FOR DELETE TO authenticated
USING (user_id = auth.uid());

DROP FUNCTION IF EXISTS public.register_push_token(TEXT, UUID, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token TEXT,
  p_house_id UUID DEFAULT NULL,
  p_platform TEXT DEFAULT 'unknown',
  p_app_version TEXT DEFAULT NULL,
  p_device_label TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, expo_push_token TEXT, is_active BOOLEAN) AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  IF p_token IS NULL OR trim(p_token) = '' THEN
    RAISE EXCEPTION 'Push token is required';
  END IF;

  IF p_house_id IS NOT NULL AND NOT public.is_house_member(p_house_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id,
    house_id,
    expo_push_token,
    platform,
    app_version,
    device_label,
    is_active,
    last_seen_at,
    updated_at
  )
  VALUES (
    v_user,
    p_house_id,
    trim(p_token),
    lower(trim(coalesce(p_platform, 'unknown'))),
    nullif(trim(coalesce(p_app_version, '')), ''),
    nullif(trim(coalesce(p_device_label, '')), ''),
    true,
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (expo_push_token) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    house_id = COALESCE(EXCLUDED.house_id, public.push_subscriptions.house_id),
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    device_label = EXCLUDED.device_label,
    is_active = true,
    last_seen_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  RETURNING push_subscriptions.id, push_subscriptions.expo_push_token, push_subscriptions.is_active
  INTO id, expo_push_token, is_active;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.deactivate_push_token(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.deactivate_push_token(p_token TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  UPDATE public.push_subscriptions
  SET
    is_active = false,
    updated_at = timezone('utc'::text, now())
  WHERE user_id = v_user
    AND expo_push_token = trim(coalesce(p_token, ''));

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth, pg_temp
SET row_security = off;

DROP FUNCTION IF EXISTS public.notify_ring_push_webhook() CASCADE;
CREATE OR REPLACE FUNCTION public.notify_ring_push_webhook()
RETURNS TRIGGER AS $$
DECLARE
  v_webhook_url TEXT;
BEGIN
  SELECT nullif(trim(coalesce(setting_value, '')), '')
  INTO v_webhook_url
  FROM public.system_settings
  WHERE setting_key = 'push_ring_webhook_url'
  LIMIT 1;

  IF v_webhook_url IS NULL THEN
    RAISE NOTICE 'push_ring_webhook_url is not configured; skipping push webhook for ring %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_webhook_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'ring_id', NEW.id,
      'house_id', NEW.house_id,
      'door_location', NEW.door_location,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_ring_push_webhook failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP TRIGGER IF EXISTS trg_notify_ring_push_webhook ON public.doorbell_rings;
CREATE TRIGGER trg_notify_ring_push_webhook
AFTER INSERT ON public.doorbell_rings
FOR EACH ROW
EXECUTE FUNCTION public.notify_ring_push_webhook();
