-- QR Doorbell Database Setup (Multi-tenant + Revocable QR)
-- Run this in Supabase SQL Editor. Script is idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- Utility functions
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_qr_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(16), 'hex');
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Core tenant tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS houses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS house_members (
  house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (house_id, user_id)
);

-- ------------------------------------------------------------
-- Existing domain tables (created if missing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS door_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  qr_token TEXT DEFAULT generate_qr_token(),
  qr_color TEXT DEFAULT '#000000',
  qr_bg_color TEXT DEFAULT '#ffffff',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owner_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  active_house_id UUID REFERENCES houses(id) ON DELETE SET NULL,
  sound_enabled BOOLEAN DEFAULT true,
  vibration_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  ntfy_topic TEXT,
  language TEXT DEFAULT 'en',
  dark_mode BOOLEAN DEFAULT true,
  auto_logout_minutes INTEGER DEFAULT 15,
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS doorbell_rings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  door_point_id UUID REFERENCES door_points(id) ON DELETE SET NULL,
  door_location TEXT NOT NULL,
  guest_message TEXT,
  guest_message_encrypted BOOLEAN DEFAULT false,
  photo_url TEXT,
  photo_encrypted BOOLEAN DEFAULT false,
  guest_location_lat DECIMAL(10, 8),
  guest_location_lng DECIMAL(11, 8),
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'acknowledged', 'responded', 'dismissed')),
  owner_reply TEXT DEFAULT '',
  replied_at TIMESTAMPTZ,
  ip_hash TEXT,
  user_agent_hash TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB,
  ip_hash TEXT
);

-- ------------------------------------------------------------
-- Schema evolution for older installs
-- ------------------------------------------------------------
ALTER TABLE door_points ADD COLUMN IF NOT EXISTS house_id UUID REFERENCES houses(id) ON DELETE CASCADE;
ALTER TABLE door_points ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE owner_settings ADD COLUMN IF NOT EXISTS active_house_id UUID REFERENCES houses(id) ON DELETE SET NULL;
ALTER TABLE doorbell_rings ADD COLUMN IF NOT EXISTS house_id UUID REFERENCES houses(id) ON DELETE CASCADE;
ALTER TABLE doorbell_rings ADD COLUMN IF NOT EXISTS door_point_id UUID REFERENCES door_points(id) ON DELETE SET NULL;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS house_id UUID REFERENCES houses(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'door_points_name_key'
      AND conrelid = 'door_points'::regclass
  ) THEN
    ALTER TABLE door_points DROP CONSTRAINT door_points_name_key;
  END IF;
END $$;

ALTER TABLE door_points ALTER COLUMN qr_token SET DEFAULT generate_qr_token();
-- ------------------------------------------------------------
-- Backfill and bootstrap data
-- ------------------------------------------------------------
INSERT INTO houses (owner_user_id, name)
SELECT u.id, 'Primary House'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM houses h WHERE h.owner_user_id = u.id
);

INSERT INTO house_members (house_id, user_id, role)
SELECT h.id, h.owner_user_id, 'owner'
FROM houses h
WHERE NOT EXISTS (
  SELECT 1 FROM house_members hm WHERE hm.house_id = h.id AND hm.user_id = h.owner_user_id
);

UPDATE owner_settings os
SET active_house_id = hm.house_id
FROM house_members hm
WHERE os.user_id = hm.user_id
  AND os.active_house_id IS NULL;

DO $$
DECLARE
  v_default_house UUID;
BEGIN
  SELECT id INTO v_default_house FROM houses ORDER BY created_at ASC LIMIT 1;
  IF v_default_house IS NOT NULL THEN
    UPDATE door_points SET house_id = v_default_house WHERE house_id IS NULL;
    UPDATE doorbell_rings SET house_id = v_default_house WHERE house_id IS NULL;
  END IF;
END $$;

UPDATE door_points
SET qr_token = generate_qr_token()
WHERE qr_token IS NULL OR qr_token = '';

UPDATE doorbell_rings r
SET door_point_id = dp.id
FROM door_points dp
WHERE r.door_point_id IS NULL
  AND r.house_id = dp.house_id
  AND lower(r.door_location) = lower(dp.name);

-- ------------------------------------------------------------
-- Constraints and helper indexes
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doorbell_rings_door_location_len') THEN
    ALTER TABLE doorbell_rings
      ADD CONSTRAINT doorbell_rings_door_location_len
      CHECK (char_length(trim(door_location)) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doorbell_rings_guest_message_len') THEN
    ALTER TABLE doorbell_rings
      ADD CONSTRAINT doorbell_rings_guest_message_len
      CHECK (guest_message IS NULL OR char_length(guest_message) <= 5000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doorbell_rings_owner_reply_len') THEN
    ALTER TABLE doorbell_rings
      ADD CONSTRAINT doorbell_rings_owner_reply_len
      CHECK (owner_reply IS NULL OR char_length(owner_reply) <= 500);
  END IF;
END $$;

ALTER TABLE door_points ALTER COLUMN house_id SET NOT NULL;
ALTER TABLE door_points ALTER COLUMN qr_token SET NOT NULL;
ALTER TABLE doorbell_rings ALTER COLUMN house_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_houses_owner_name ON houses(owner_user_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_door_points_qr_token ON door_points(qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_door_points_house_name ON door_points(house_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_house_members_user_id ON house_members(user_id);
CREATE INDEX IF NOT EXISTS idx_door_points_house_id ON door_points(house_id);
CREATE INDEX IF NOT EXISTS idx_rings_house_id ON doorbell_rings(house_id);
CREATE INDEX IF NOT EXISTS idx_rings_door_point_id ON doorbell_rings(door_point_id);
CREATE INDEX IF NOT EXISTS idx_rings_created_at ON doorbell_rings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rings_status ON doorbell_rings(status);
CREATE INDEX IF NOT EXISTS idx_rings_door_location ON doorbell_rings(door_location);
CREATE INDEX IF NOT EXISTS idx_rings_ip_hash ON doorbell_rings(ip_hash);
CREATE INDEX IF NOT EXISTS idx_owner_settings_user_id ON owner_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_house_id ON audit_log(house_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- ------------------------------------------------------------
-- Access helper functions
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_house_member(p_house_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM house_members hm
    WHERE hm.house_id = p_house_id AND hm.user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION ensure_owner_house()
RETURNS UUID AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT hm.house_id INTO v_house
  FROM house_members hm
  JOIN houses h ON h.id = hm.house_id
  WHERE hm.user_id = v_user AND h.is_active = true
  ORDER BY h.created_at ASC
  LIMIT 1;

  IF v_house IS NULL THEN
    INSERT INTO houses (owner_user_id, name)
    VALUES (v_user, 'Primary House')
    RETURNING id INTO v_house;

    INSERT INTO house_members (house_id, user_id, role)
    VALUES (v_house, v_user, 'owner')
    ON CONFLICT (house_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO owner_settings (user_id, active_house_id)
  VALUES (v_user, v_house)
  ON CONFLICT (user_id)
  DO UPDATE SET active_house_id = COALESCE(owner_settings.active_house_id, EXCLUDED.active_house_id);

  RETURN v_house;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION create_house(p_name TEXT)
RETURNS TABLE(id UUID, name TEXT) AS $$
DECLARE
  v_user UUID := auth.uid();
  v_house_id UUID;
  v_name TEXT := NULLIF(trim(p_name), '');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'House name is required';
  END IF;

  INSERT INTO houses (owner_user_id, name)
  VALUES (v_user, v_name)
  RETURNING houses.id INTO v_house_id;

  INSERT INTO house_members (house_id, user_id, role)
  VALUES (v_house_id, v_user, 'owner')
  ON CONFLICT (house_id, user_id) DO NOTHING;

  RETURN QUERY SELECT v_house_id, v_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION add_house_member_by_email(
  p_house_id UUID,
  p_email TEXT,
  p_role TEXT DEFAULT 'manager'
)
RETURNS TABLE(house_id UUID, user_id UUID, email TEXT, role TEXT) AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_target_user UUID;
  v_target_email TEXT;
  v_role TEXT := lower(COALESCE(NULLIF(trim(p_role), ''), 'manager'));
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM houses h
    WHERE h.id = p_house_id AND h.owner_user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'Only house owner can add members';
  END IF;

  SELECT u.id, u.email
  INTO v_target_user, v_target_email
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;

  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  INSERT INTO house_members (house_id, user_id, role)
  VALUES (p_house_id, v_target_user, v_role)
  ON CONFLICT (house_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  RETURN QUERY SELECT p_house_id, v_target_user, v_target_email, v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION resolve_qr_token(p_qr_token TEXT)
RETURNS TABLE(door_point_id UUID, house_id UUID, door_name TEXT, house_name TEXT) AS $$
  SELECT dp.id, dp.house_id, dp.name, h.name
  FROM door_points dp
  JOIN houses h ON h.id = dp.house_id
  WHERE dp.qr_token = p_qr_token
    AND dp.is_active = true
    AND h.is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION create_doorbell_ring_by_token(
  p_qr_token TEXT,
  p_guest_message TEXT,
  p_guest_message_encrypted BOOLEAN,
  p_photo_url TEXT,
  p_photo_encrypted BOOLEAN,
  p_user_agent_hash TEXT
)
RETURNS doorbell_rings AS $$
DECLARE
  v_door door_points%ROWTYPE;
  v_ring doorbell_rings%ROWTYPE;
BEGIN
  SELECT * INTO v_door
  FROM door_points
  WHERE qr_token = p_qr_token
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive QR code';
  END IF;

  INSERT INTO doorbell_rings (
    house_id,
    door_point_id,
    door_location,
    guest_message,
    guest_message_encrypted,
    photo_url,
    photo_encrypted,
    user_agent_hash,
    status
  ) VALUES (
    v_door.house_id,
    v_door.id,
    v_door.name,
    p_guest_message,
    COALESCE(p_guest_message_encrypted, false),
    p_photo_url,
    COALESCE(p_photo_encrypted, false),
    p_user_agent_hash,
    'waiting'
  ) RETURNING * INTO v_ring;

  RETURN v_ring;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION ensure_owner_house() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_house(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_house_member_by_email(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_qr_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_doorbell_ring_by_token(TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_house_member(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION is_house_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_owner_house() TO authenticated;
GRANT EXECUTE ON FUNCTION create_house(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION add_house_member_by_email(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_qr_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_doorbell_ring_by_token(TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) TO anon;
-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
ALTER TABLE houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE door_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE doorbell_rings ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS houses_select_member ON houses;
DROP POLICY IF EXISTS houses_insert_owner ON houses;
DROP POLICY IF EXISTS houses_update_owner ON houses;
DROP POLICY IF EXISTS houses_delete_owner ON houses;

CREATE POLICY houses_select_member ON houses
FOR SELECT TO authenticated
USING (is_house_member(id) OR owner_user_id = auth.uid());

CREATE POLICY houses_insert_owner ON houses
FOR INSERT TO authenticated
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY houses_update_owner ON houses
FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY houses_delete_owner ON houses
FOR DELETE TO authenticated
USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS house_members_select ON house_members;
DROP POLICY IF EXISTS house_members_insert_owner ON house_members;
DROP POLICY IF EXISTS house_members_update_owner ON house_members;
DROP POLICY IF EXISTS house_members_delete_owner ON house_members;

CREATE POLICY house_members_select ON house_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM houses h WHERE h.id = house_members.house_id AND h.owner_user_id = auth.uid())
);

CREATE POLICY house_members_insert_owner ON house_members
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM houses h WHERE h.id = house_members.house_id AND h.owner_user_id = auth.uid())
);

CREATE POLICY house_members_update_owner ON house_members
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM houses h WHERE h.id = house_members.house_id AND h.owner_user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM houses h WHERE h.id = house_members.house_id AND h.owner_user_id = auth.uid())
);

CREATE POLICY house_members_delete_owner ON house_members
FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM houses h WHERE h.id = house_members.house_id AND h.owner_user_id = auth.uid())
);

DROP POLICY IF EXISTS anyone_can_view_door_points ON door_points;
DROP POLICY IF EXISTS owners_can_manage_door_points ON door_points;
DROP POLICY IF EXISTS door_points_select_member ON door_points;
DROP POLICY IF EXISTS door_points_insert_member ON door_points;
DROP POLICY IF EXISTS door_points_update_member ON door_points;
DROP POLICY IF EXISTS door_points_delete_member ON door_points;

CREATE POLICY door_points_select_member ON door_points
FOR SELECT TO authenticated
USING (is_house_member(house_id));

CREATE POLICY door_points_insert_member ON door_points
FOR INSERT TO authenticated
WITH CHECK (
  is_house_member(house_id)
  AND char_length(trim(name)) BETWEEN 1 AND 120
  AND qr_token IS NOT NULL
);

CREATE POLICY door_points_update_member ON door_points
FOR UPDATE TO authenticated
USING (is_house_member(house_id))
WITH CHECK (is_house_member(house_id));

CREATE POLICY door_points_delete_member ON door_points
FOR DELETE TO authenticated
USING (is_house_member(house_id));

DROP POLICY IF EXISTS guests_can_insert_rings ON doorbell_rings;
DROP POLICY IF EXISTS owners_can_view_rings ON doorbell_rings;
DROP POLICY IF EXISTS owners_can_update_rings ON doorbell_rings;
DROP POLICY IF EXISTS owners_can_delete_rings ON doorbell_rings;
DROP POLICY IF EXISTS doorbell_rings_select_member ON doorbell_rings;
DROP POLICY IF EXISTS doorbell_rings_update_member ON doorbell_rings;
DROP POLICY IF EXISTS doorbell_rings_delete_member ON doorbell_rings;

CREATE POLICY doorbell_rings_select_member ON doorbell_rings
FOR SELECT TO authenticated
USING (is_house_member(house_id));

CREATE POLICY doorbell_rings_update_member ON doorbell_rings
FOR UPDATE TO authenticated
USING (is_house_member(house_id))
WITH CHECK (is_house_member(house_id));

CREATE POLICY doorbell_rings_delete_member ON doorbell_rings
FOR DELETE TO authenticated
USING (is_house_member(house_id));

DROP POLICY IF EXISTS users_manage_own_settings ON owner_settings;
CREATE POLICY users_manage_own_settings ON owner_settings
FOR ALL TO authenticated
USING (
  auth.uid() = user_id
  AND (active_house_id IS NULL OR is_house_member(active_house_id))
)
WITH CHECK (
  auth.uid() = user_id
  AND (active_house_id IS NULL OR is_house_member(active_house_id))
);

DROP POLICY IF EXISTS owners_view_audit_log ON audit_log;
DROP POLICY IF EXISTS system_insert_audit_log ON audit_log;
DROP POLICY IF EXISTS audit_log_select_scoped ON audit_log;
DROP POLICY IF EXISTS audit_log_insert_authenticated ON audit_log;

CREATE POLICY audit_log_select_scoped ON audit_log
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (house_id IS NOT NULL AND is_house_member(house_id))
);

CREATE POLICY audit_log_insert_authenticated ON audit_log
FOR INSERT TO authenticated
WITH CHECK (true);

-- ------------------------------------------------------------
-- Storage policies
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('guest_photos', 'guest_photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS guests_can_upload_photos ON storage.objects;
DROP POLICY IF EXISTS owners_can_read_photos ON storage.objects;
DROP POLICY IF EXISTS owners_can_manage_photos ON storage.objects;

CREATE POLICY guests_can_upload_photos
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'guest_photos');

CREATE POLICY owners_can_read_photos
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'guest_photos'
  AND EXISTS (
    SELECT 1 FROM house_members hm
    WHERE hm.user_id = auth.uid()
      AND hm.house_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY owners_can_manage_photos
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'guest_photos'
  AND EXISTS (
    SELECT 1 FROM house_members hm
    WHERE hm.user_id = auth.uid()
      AND hm.house_id::text = split_part(name, '/', 1)
  )
)
WITH CHECK (
  bucket_id = 'guest_photos'
  AND EXISTS (
    SELECT 1 FROM house_members hm
    WHERE hm.user_id = auth.uid()
      AND hm.house_id::text = split_part(name, '/', 1)
  )
);

-- ------------------------------------------------------------
-- Rate limiting and maintenance triggers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_ring_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INTEGER;
  rate_key TEXT;
BEGIN
  rate_key := COALESCE(NULLIF(NEW.ip_hash, ''), NULLIF(NEW.user_agent_hash, ''));
  IF rate_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO recent_count
  FROM doorbell_rings
  WHERE COALESCE(NULLIF(ip_hash, ''), NULLIF(user_agent_hash, '')) = rate_key
    AND created_at > now() - interval '10 minutes';

  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'Too many doorbell rings. Please wait.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_check_ring_limit ON doorbell_rings;
CREATE TRIGGER tr_check_ring_limit
BEFORE INSERT ON doorbell_rings
FOR EACH ROW EXECUTE FUNCTION check_ring_limit();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_houses ON houses;
CREATE TRIGGER set_updated_at_houses
BEFORE UPDATE ON houses
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_rings ON doorbell_rings;
CREATE TRIGGER set_updated_at_rings
BEFORE UPDATE ON doorbell_rings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_door_points ON door_points;
CREATE TRIGGER set_updated_at_door_points
BEFORE UPDATE ON door_points
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_owner_settings ON owner_settings;
CREATE TRIGGER set_updated_at_owner_settings
BEFORE UPDATE ON owner_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  v_house_id UUID;
  v_record_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    IF (to_jsonb(OLD) ? 'house_id') THEN
      v_house_id := NULLIF(to_jsonb(OLD)->>'house_id', '')::uuid;
    END IF;
  ELSE
    v_record_id := NEW.id;
    IF (to_jsonb(NEW) ? 'house_id') THEN
      v_house_id := NULLIF(to_jsonb(NEW)->>'house_id', '')::uuid;
    END IF;
  END IF;

  INSERT INTO audit_log (house_id, user_id, action, table_name, record_id, details)
  VALUES (
    v_house_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'timestamp', now())
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_doorbell_rings ON doorbell_rings;
CREATE TRIGGER audit_doorbell_rings
AFTER INSERT OR UPDATE OR DELETE ON doorbell_rings
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_door_points ON door_points;
CREATE TRIGGER audit_door_points
AFTER INSERT OR UPDATE OR DELETE ON door_points
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_houses ON houses;
CREATE TRIGGER audit_houses
AFTER INSERT OR UPDATE OR DELETE ON houses
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- ------------------------------------------------------------
-- Realtime publication
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'doorbell_rings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE doorbell_rings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'door_points'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE door_points;
  END IF;
END $$;
