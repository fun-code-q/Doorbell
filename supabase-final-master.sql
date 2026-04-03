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
  guest_message_encrypted BOOLEAN DEFAULT false,
  photo_url TEXT,
  photo_encrypted BOOLEAN DEFAULT false,
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
  p_photo_url TEXT DEFAULT NULL,
  p_photo_encrypted BOOLEAN DEFAULT false,
  p_user_agent_hash TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, house_id UUID, door_point_id UUID, created_at TIMESTAMPTZ) AS $$
DECLARE
  v_dp_id UUID;
  v_house_id UUID;
  v_door_name TEXT;
  v_new_id UUID;
BEGIN
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
    guest_message_encrypted,
    photo_url,
    photo_encrypted,
    ip_hash -- use user_agent_hash as proxy for ip_hash if needed or leave empty
  )
  VALUES (
    v_house_id,
    v_dp_id,
    v_door_name,
    p_guest_message,
    p_guest_message_encrypted,
    p_photo_url,
    p_photo_encrypted,
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
  public.is_house_owner(house_id) OR public.check_user_is_door_member(id)
);
DROP POLICY IF EXISTS door_points_manage_owner ON public.door_points;
CREATE POLICY door_points_manage_owner ON public.door_points FOR ALL TO authenticated USING (
  public.is_house_owner(house_id)
);

-- 6c. RINGS Policies (Recursion Free)
DROP POLICY IF EXISTS rings_select_member ON public.doorbell_rings;
CREATE POLICY rings_select_member ON public.doorbell_rings FOR SELECT TO authenticated USING (
  public.is_house_owner(house_id) OR public.check_user_is_door_member(door_point_id)
);
DROP POLICY IF EXISTS rings_insert_guest ON public.doorbell_rings;
CREATE POLICY rings_insert_guest ON public.doorbell_rings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS rings_manage_owner ON public.doorbell_rings;
CREATE POLICY rings_manage_owner ON public.doorbell_rings FOR ALL TO authenticated USING (
  public.is_house_owner(house_id)
);

-- 6d. HOUSE_MEMBERS (Recursion Free)
DROP POLICY IF EXISTS house_members_select ON public.house_members;
CREATE POLICY house_members_select ON public.house_members FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.is_house_owner(house_id)
);
DROP POLICY IF EXISTS house_members_manage_owner ON public.house_members;
CREATE POLICY house_members_manage_owner ON public.house_members FOR ALL TO authenticated USING (
  public.is_house_owner(house_id)
);

-- 6e. DOOR_POINT_MEMBERS (Recursion Free)
DROP POLICY IF EXISTS door_point_members_select ON public.door_point_members;
CREATE POLICY door_point_members_select ON public.door_point_members FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.is_house_owner(house_id)
);
DROP POLICY IF EXISTS door_point_members_manage_owner ON public.door_point_members;
CREATE POLICY door_point_members_manage_owner ON public.door_point_members FOR ALL TO authenticated USING (
  public.is_house_owner(house_id)
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
CREATE POLICY audit_log_delete_owner ON public.audit_log 
FOR DELETE TO authenticated 
USING (
  public.is_house_owner(house_id)
);
