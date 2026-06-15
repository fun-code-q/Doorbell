-- =========================================================================
-- 20260518000000_extensions_and_core_tables.sql
-- Establishes extensions in the `extensions` schema and rebuilds the
-- core tables. Idempotent: safe to re-run against an existing project
-- because it uses CREATE EXTENSION IF NOT EXISTS, CREATE TABLE IF NOT
-- EXISTS, and ADD COLUMN IF NOT EXISTS.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

-- pgcrypto + uuid-ossp can live in the extensions schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- pg_net and pg_cron pin their own schemas (`net` and `cron`); WITH SCHEMA
-- is silently ignored for those, so reference them by their native names.
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =========================================================================
-- Utility: generate_qr_token (16 random bytes -> 32 hex chars)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.generate_qr_token()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN encode(extensions.gen_random_bytes(16), 'hex');
END;
$$;

-- =========================================================================
-- Core tables
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username));

CREATE TABLE IF NOT EXISTS public.houses (
  id            UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS houses_owner_user_id_idx
  ON public.houses (owner_user_id);

CREATE TABLE IF NOT EXISTS public.house_members (
  house_id      UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'viewer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (house_id, user_id)
);

CREATE INDEX IF NOT EXISTS house_members_user_id_idx
  ON public.house_members (user_id);

CREATE TABLE IF NOT EXISTS public.door_points (
  id            UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  house_id      UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  qr_token      TEXT UNIQUE DEFAULT public.generate_qr_token(),
  qr_color      TEXT DEFAULT '#000000',
  qr_bg_color   TEXT DEFAULT '#ffffff',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- Geofence (Phase 3A): the door's location and the radius within which
  -- a guest is allowed to ring. Both nullable for backwards-compatibility;
  -- null lat/lon disables the geofence on that door.
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  geofence_radius_m INTEGER NOT NULL DEFAULT 50,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS door_points_house_id_idx
  ON public.door_points (house_id);

ALTER TABLE public.door_points
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 50;

CREATE TABLE IF NOT EXISTS public.door_point_members (
  id            UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  door_point_id UUID NOT NULL REFERENCES public.door_points(id) ON DELETE CASCADE,
  house_id      UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_muted      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (door_point_id, user_id)
);

CREATE INDEX IF NOT EXISTS door_point_members_house_id_idx
  ON public.door_point_members (house_id);
CREATE INDEX IF NOT EXISTS door_point_members_user_id_idx
  ON public.door_point_members (user_id);

CREATE TABLE IF NOT EXISTS public.doorbell_rings (
  id                       UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  house_id                 UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  door_point_id            UUID REFERENCES public.door_points(id) ON DELETE SET NULL,
  door_location            TEXT NOT NULL,
  guest_name               TEXT,
  -- Phase 3B: messages may be plaintext (legacy) or ciphertext blobs.
  -- guest_message_encrypted=true means guest_message is a base64(crypto_box_seal output).
  guest_message            TEXT,
  guest_message_encrypted  BOOLEAN NOT NULL DEFAULT false,
  -- An optional per-ring secret returned only to the guest who created the
  -- ring. Used to gate guest follow-up chat appends (no token reuse across rings).
  guest_secret             TEXT NOT NULL DEFAULT public.generate_qr_token(),
  chat_history             JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                   TEXT NOT NULL DEFAULT 'waiting'
                              CHECK (status IN ('waiting', 'acknowledged', 'responded', 'dismissed')),
  owner_reply              TEXT DEFAULT '',
  replied_at               TIMESTAMPTZ,
  ip_hash                  TEXT,
  -- Phase 3A: where the guest claims to be when they pressed ring.
  guest_latitude           DOUBLE PRECISION,
  guest_longitude          DOUBLE PRECISION,
  guest_geo_accuracy_m     DOUBLE PRECISION,
  -- pg_net webhook idempotency guard (Phase 4C)
  notified_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.doorbell_rings
  ADD COLUMN IF NOT EXISTS guest_secret           TEXT NOT NULL DEFAULT public.generate_qr_token(),
  ADD COLUMN IF NOT EXISTS guest_latitude         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS guest_longitude        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS guest_geo_accuracy_m   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS notified_at            TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS doorbell_rings_house_id_idx
  ON public.doorbell_rings (house_id);
CREATE INDEX IF NOT EXISTS doorbell_rings_door_point_id_idx
  ON public.doorbell_rings (door_point_id);
CREATE INDEX IF NOT EXISTS doorbell_rings_created_at_desc_idx
  ON public.doorbell_rings (created_at DESC);
CREATE INDEX IF NOT EXISTS doorbell_rings_status_idx
  ON public.doorbell_rings (status);

CREATE TABLE IF NOT EXISTS public.owner_settings (
  id                  UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  active_house_id     UUID REFERENCES public.houses(id) ON DELETE SET NULL,
  sound_enabled       BOOLEAN NOT NULL DEFAULT true,
  vibration_enabled   BOOLEAN NOT NULL DEFAULT true,
  push_enabled        BOOLEAN NOT NULL DEFAULT true,
  language            TEXT NOT NULL DEFAULT 'en',
  auto_logout_minutes INTEGER NOT NULL DEFAULT 15,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS owner_settings_active_house_id_idx
  ON public.owner_settings (active_house_id);

-- =========================================================================
-- Phase 3B: owner Curve25519 public keys for end-to-end guest encryption.
-- The private key never leaves the Android Keystore on the owner device.
-- A house can have multiple owner devices, each contributing one public key.
-- The guest fetches the active public key for the house and seals the
-- message with libsodium's crypto_box_seal (anonymous sender).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.owner_public_keys (
  id          UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  house_id    UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  -- 32 raw bytes, base64 encoded -> 44 chars including padding.
  public_key  TEXT NOT NULL CHECK (length(public_key) BETWEEN 40 AND 64),
  algorithm   TEXT NOT NULL DEFAULT 'x25519-xsalsa20-poly1305-sealed',
  device_label TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  rotated_at  TIMESTAMPTZ,
  UNIQUE (user_id, house_id, public_key)
);

CREATE INDEX IF NOT EXISTS owner_public_keys_house_active_idx
  ON public.owner_public_keys (house_id, is_active);
CREATE INDEX IF NOT EXISTS owner_public_keys_user_id_idx
  ON public.owner_public_keys (user_id);

-- =========================================================================
-- Audit log
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  house_id    UUID REFERENCES public.houses(id) ON DELETE CASCADE,
  user_id     UUID,
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS audit_log_house_id_created_at_idx
  ON public.audit_log (house_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at);

-- =========================================================================
-- System settings (server-side configuration; never readable by clients).
-- Holds the push webhook URL and HMAC secret managed via dashboard.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.system_settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value TEXT,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

REVOKE ALL ON TABLE public.system_settings FROM anon, authenticated;

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES
  ('push_ring_webhook_url',    NULL, 'Edge Function endpoint to receive ring webhooks'),
  ('push_ring_webhook_secret', NULL, 'Shared HMAC secret; rotate via dashboard. Also set in Edge Function secrets.')
ON CONFLICT (setting_key) DO NOTHING;

-- =========================================================================
-- Push subscriptions (Phase 2B: native FCM tokens, not Expo)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  house_id        UUID REFERENCES public.houses(id) ON DELETE CASCADE,
  -- FCM registration token (legacy column name preserved for migration only).
  fcm_token       TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios','web')),
  app_version     TEXT,
  device_label    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- A token belongs to exactly one (user, device) pair. Same physical
  -- device reinstalling under a different user gets a new FCM token from
  -- Firebase, so collisions on (fcm_token, user_id) are the legitimate case.
  UNIQUE (user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_house_id_idx
  ON public.push_subscriptions (house_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_active_idx
  ON public.push_subscriptions (is_active) WHERE is_active = true;

-- =========================================================================
-- Rate limiting (Phase 3C): rolling-window counter per qr_token + ip_hash.
-- Used by create_doorbell_ring_by_token.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ring_rate_limit (
  qr_token       TEXT NOT NULL,
  ip_hash        TEXT NOT NULL,
  window_start   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  count          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (qr_token, ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS ring_rate_limit_window_idx
  ON public.ring_rate_limit (window_start);

-- =========================================================================
-- updated_at touch trigger (reusable)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'profiles','houses','door_points','door_point_members',
      'doorbell_rings','owner_settings','push_subscriptions','system_settings'
    ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%s ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%s
         BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      t, t
    );
  END LOOP;
END $$;
