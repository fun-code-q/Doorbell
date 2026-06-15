-- =========================================================================
-- 20260518001600_webhooks_and_house_ops.sql
--
-- Batch N:
--   #8  outbound_webhooks — per-house third-party integrations (IFTTT,
--        Zapier, Home Assistant). HMAC-signed POSTs on every ring INSERT.
--   #9  switch_active_house — single RPC the multi-house dropdown calls.
--   #10 export_my_settings / import_my_settings — owner_settings backup
--        + restore as JSON, no encryption needed (no PII in these rows).
-- =========================================================================

-- -------------------------------------------------------------------------
-- outbound_webhooks
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outbound_webhooks (
  id         UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  house_id   UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  url        TEXT NOT NULL CHECK (url ~* '^https://[a-z0-9.\-]+(/[^\s]*)?$'),
  -- The owner's chosen HMAC secret. We HMAC-SHA256 (timestamp || body)
  -- so the third-party endpoint can verify the call came from us.
  secret     TEXT NOT NULL CHECK (length(secret) BETWEEN 16 AND 256),
  description TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  -- Optional filter: only fire on these ring statuses (e.g. only on
  -- 'waiting' insert, never on 'responded' update). Comma-separated.
  on_events  TEXT NOT NULL DEFAULT 'ring_created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS outbound_webhooks_house_active_idx
  ON public.outbound_webhooks (house_id, is_active);

ALTER TABLE public.outbound_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owh_select_owner ON public.outbound_webhooks;
CREATE POLICY owh_select_owner ON public.outbound_webhooks
  FOR SELECT TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS owh_manage_owner ON public.outbound_webhooks;
CREATE POLICY owh_manage_owner ON public.outbound_webhooks
  FOR ALL TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner']))
  WITH CHECK (public.has_house_role(house_id, ARRAY['owner']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outbound_webhooks TO authenticated;

-- Trigger function that fans out to every active webhook for a house.
-- Owners can wire IFTTT / Zapier / Home Assistant / their own HTTP endpoint.
CREATE OR REPLACE FUNCTION public.dispatch_outbound_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_hook       RECORD;
  v_body       JSONB;
  v_body_text  TEXT;
  v_ts         TEXT;
  v_sig        TEXT;
BEGIN
  v_ts := extract(epoch FROM timezone('utc', now()))::BIGINT::TEXT;
  v_body := jsonb_build_object(
    'event',         'ring_created',
    'ring_id',       NEW.id,
    'house_id',      NEW.house_id,
    'door_point_id', NEW.door_point_id,
    'door_location', NEW.door_location,
    'created_at',    NEW.created_at,
    -- We deliberately do NOT include the plaintext message — it's
    -- end-to-end encrypted and we don't have the key. Owners who want
    -- the message must rely on QRVault's local decryption + share to
    -- their automation from the app.
    'encrypted',     NEW.guest_message_encrypted
  );
  v_body_text := v_body::TEXT;

  FOR v_hook IN
    SELECT id, url, secret, on_events
    FROM public.outbound_webhooks
    WHERE house_id = NEW.house_id
      AND is_active = true
      AND on_events LIKE '%ring_created%'
  LOOP
    v_sig := encode(
      extensions.hmac(convert_to(v_ts || '.' || v_body_text, 'UTF8'), v_hook.secret::BYTEA, 'sha256'),
      'hex'
    );
    PERFORM net.http_post(
      url := v_hook.url,
      headers := jsonb_build_object(
        'Content-Type',         'application/json',
        'X-QRDoorbell-Event',   'ring_created',
        'X-QRDoorbell-Timestamp', v_ts,
        'X-QRDoorbell-Signature', v_sig,
        'X-QRDoorbell-WebhookId', v_hook.id::TEXT,
        'User-Agent',           'qr-doorbell/3.x'
      ),
      body := v_body,
      timeout_milliseconds := 5000
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'dispatch_outbound_webhooks failed for ring %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_outbound_webhooks ON public.doorbell_rings;
CREATE TRIGGER trg_dispatch_outbound_webhooks
AFTER INSERT ON public.doorbell_rings
FOR EACH ROW EXECUTE FUNCTION public.dispatch_outbound_webhooks();

-- -------------------------------------------------------------------------
-- switch_active_house: the only RPC the multi-house dropdown needs.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_active_house(p_house_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.is_house_member(p_house_id) THEN
    RAISE EXCEPTION 'Not a member of that house';
  END IF;
  INSERT INTO public.owner_settings (user_id, active_house_id)
  VALUES (v_user, p_house_id)
  ON CONFLICT (user_id) DO UPDATE
    SET active_house_id = p_house_id,
        updated_at = timezone('utc', now());
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.switch_active_house(UUID) TO authenticated;

-- -------------------------------------------------------------------------
-- export_my_settings / import_my_settings
-- Round-trip the user's owner_settings as a JSON blob the QRVault UI
-- can save to disk or paste into a new device.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_my_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_out  JSONB;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  SELECT to_jsonb(os) INTO v_out
  FROM public.owner_settings os
  WHERE os.user_id = v_user;
  -- Strip server-internal fields. The id, user_id, created_at,
  -- updated_at columns are not portable.
  v_out := v_out - 'id' - 'user_id' - 'created_at' - 'updated_at';
  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.export_my_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.import_my_settings(p_settings JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Settings payload must be a JSON object';
  END IF;

  -- Whitelist the keys we accept; ignore anything else the blob carries.
  UPDATE public.owner_settings
  SET
    sound_enabled       = COALESCE((p_settings->>'sound_enabled')::BOOLEAN, sound_enabled),
    vibration_enabled   = COALESCE((p_settings->>'vibration_enabled')::BOOLEAN, vibration_enabled),
    push_enabled        = COALESCE((p_settings->>'push_enabled')::BOOLEAN, push_enabled),
    language            = COALESCE(p_settings->>'language', language),
    auto_logout_minutes = COALESCE((p_settings->>'auto_logout_minutes')::INTEGER, auto_logout_minutes),
    timezone            = COALESCE(p_settings->>'timezone', timezone),
    quick_replies       = COALESCE(
                            (SELECT array_agg(value::TEXT)
                             FROM jsonb_array_elements_text(p_settings->'quick_replies')),
                            quick_replies),
    updated_at          = timezone('utc', now())
  WHERE user_id = v_user;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_my_settings(JSONB) TO authenticated;
