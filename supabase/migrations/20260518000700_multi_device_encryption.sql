-- =========================================================================
-- 20260518000700_multi_device_encryption.sql
--
-- Batch A:
--   * resolve_qr_token now returns ALL active owner public keys for the
--     house (not just the most recent). The guest seals one ciphertext
--     per key, so every device with a private key can decrypt.
--   * owner_keypair_backups: optional encrypted-at-rest backup of the
--     libsodium private key. The wrapping passphrase NEVER leaves the
--     owner's device; we receive only the ciphertext, the Argon2id
--     parameters, and a random salt + nonce. On a new device the owner
--     enters the passphrase and unwraps the privkey locally.
--
-- Cryptographic contract for owner_keypair_backups:
--     wrapped_secret_key = crypto_secretbox(
--                            sk_bytes,
--                            nonce        := random 24,
--                            shared_key   := argon2id(passphrase,
--                                                     salt        := random 16,
--                                                     ops_limit   := 3 (sensitive),
--                                                     mem_limit   := 256 MiB))
--   Verification is implicit (poly1305 auth tag in crypto_secretbox).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. Schema additions used by the new RPCs below. Done up-front so the
--    plpgsql bodies that reference them parse cleanly.
-- -------------------------------------------------------------------------
ALTER TABLE public.doorbell_rings
  ADD COLUMN IF NOT EXISTS guest_message_ciphertexts TEXT[],
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS doorbell_rings_idempotency_key_uidx
  ON public.doorbell_rings (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -------------------------------------------------------------------------
-- 1. resolve_qr_token: return every active public key for the house.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_qr_token(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_qr_token(p_qr_token TEXT)
RETURNS TABLE(
  door_point_id        UUID,
  door_name            TEXT,
  house_id             UUID,
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  geofence_radius_m    INTEGER,
  -- Array of base64-encoded recipient public keys. Guest seals ONE
  -- ciphertext per key and sends them as an array.
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
    -- Pick the algorithm tag from the first active key; all keys for a
    -- given house must share an algorithm by construction.
    (SELECT k.algorithm
     FROM public.owner_public_keys k
     WHERE k.house_id = dp.house_id AND k.is_active = true
     ORDER BY k.created_at ASC LIMIT 1) AS encryption_algorithm
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token AND dp.is_active = true
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_qr_token(TEXT) TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 2. Allow chat_history entries to carry the array-of-ciphertexts payload.
--    No schema change required (chat_history is JSONB), but we document
--    the new shape:
--      { role:"guest", text:"<single plaintext OR base64 ciphertext>",
--        ciphertexts:["<b64 per key>"], encrypted:true, time:"..." }
--    The legacy `text` field is kept for backwards-compat — when only one
--    key is present we set both. Owner clients try ciphertexts[] first,
--    then fall back to text.
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- 3. Update create_doorbell_ring_by_token to accept the multi-ciphertext
--    payload. We add a new optional p_ciphertexts TEXT[] argument; when
--    present the function stores it in chat_history and in a top-level
--    `guest_message_ciphertexts` column for fast retrieval.
-- -------------------------------------------------------------------------
ALTER TABLE public.doorbell_rings
  ADD COLUMN IF NOT EXISTS guest_message_ciphertexts TEXT[];

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
  -- Idempotency: a client may retry the same logical request. If the
  -- caller supplies p_idempotency_key and we've seen it within 5 min,
  -- return the original ring instead of creating a duplicate.
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT r.id, r.house_id, r.door_point_id, r.guest_secret, r.created_at
    INTO v_existing
    FROM public.doorbell_rings r
    WHERE r.idempotency_key = trim(p_idempotency_key)
      AND r.created_at > v_now - INTERVAL '5 minutes'
    LIMIT 1;
    IF FOUND THEN
      id            := v_existing.id;
      house_id      := v_existing.house_id;
      door_point_id := v_existing.door_point_id;
      guest_secret  := v_existing.guest_secret;
      created_at    := v_existing.created_at;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

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

  -- 2. Door throttle (global cap + DND).
  PERFORM public.enforce_door_throttle(
    v_dp_id, v_max_per_hour, v_auto_dnd_after, v_auto_dnd_window, v_dnd_until
  );

  -- 3. Per-visitor rate limit.
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

  -- 4. Geofence.
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
      jsonb_build_object(
        'role',        'guest',
        'text',        v_clean_msg,
        'time',        v_now,
        'encrypted',   p_guest_message_encrypted,
        'ciphertexts', COALESCE(to_jsonb(p_ciphertexts), 'null'::jsonb)
      )
    );
  END IF;

  -- 6. Insert.
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
-- 4. (idempotency column moved to top of file; see section 0)
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- 5. Encrypted private-key backup table.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_keypair_backups (
  id            UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  house_id      UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,        -- pairs the wrapped key with the corresponding entry in owner_public_keys
  algorithm     TEXT NOT NULL DEFAULT 'argon2id+secretbox',
  -- Argon2id parameters used to derive the wrapping key from the passphrase.
  kdf_salt_b64  TEXT NOT NULL,
  kdf_ops_limit INTEGER NOT NULL DEFAULT 3,
  kdf_mem_limit_kib INTEGER NOT NULL DEFAULT 262144,  -- 256 MiB
  -- secretbox(privkey, nonce, derived_key)
  secretbox_nonce_b64      TEXT NOT NULL,
  secretbox_wrapped_key_b64 TEXT NOT NULL,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- Allow one backup per (user, house, public_key). Re-publishing under
  -- a new passphrase replaces the old wrapped blob.
  UNIQUE (user_id, house_id, public_key)
);

CREATE INDEX IF NOT EXISTS owner_keypair_backups_user_house_idx
  ON public.owner_keypair_backups (user_id, house_id);

ALTER TABLE public.owner_keypair_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS okb_self_select ON public.owner_keypair_backups;
CREATE POLICY okb_self_select ON public.owner_keypair_backups
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS okb_self_insert ON public.owner_keypair_backups;
CREATE POLICY okb_self_insert ON public.owner_keypair_backups
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS okb_self_update ON public.owner_keypair_backups;
CREATE POLICY okb_self_update ON public.owner_keypair_backups
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS okb_self_delete ON public.owner_keypair_backups;
CREATE POLICY okb_self_delete ON public.owner_keypair_backups
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_keypair_backups TO authenticated;

-- Helper RPC: list available backups for the current user across houses.
CREATE OR REPLACE FUNCTION public.list_keypair_backups()
RETURNS TABLE(
  id UUID, house_id UUID, public_key TEXT, algorithm TEXT,
  kdf_salt_b64 TEXT, kdf_ops_limit INTEGER, kdf_mem_limit_kib INTEGER,
  secretbox_nonce_b64 TEXT, secretbox_wrapped_key_b64 TEXT,
  device_label TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT b.id, b.house_id, b.public_key, b.algorithm,
         b.kdf_salt_b64, b.kdf_ops_limit, b.kdf_mem_limit_kib,
         b.secretbox_nonce_b64, b.secretbox_wrapped_key_b64,
         b.device_label, b.created_at
  FROM public.owner_keypair_backups b
  WHERE b.user_id = auth.uid()
  ORDER BY b.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_keypair_backups() TO authenticated;
