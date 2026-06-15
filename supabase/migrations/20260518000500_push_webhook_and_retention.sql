-- =========================================================================
-- 20260518000500_push_webhook_and_retention.sql
-- The pg_net push webhook (Phase 4C HMAC-signed), receipt-driven token
-- invalidation helpers, single-RPC token fetch for the Edge Function,
-- and GDPR retention jobs (Phase 4B).
-- =========================================================================

-- =========================================================================
-- notify_ring_push_webhook: signs the request before sending so the
-- Edge Function can verify it came from us (not an internet rando).
-- Authorization: Bearer <PUSH_WEBHOOK_SECRET>
-- X-Webhook-Timestamp: <unix-seconds>
-- X-Webhook-Signature: hex(hmac_sha256(secret, timestamp || '.' || body))
-- =========================================================================
CREATE OR REPLACE FUNCTION public.notify_ring_push_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_url           TEXT;
  v_secret        TEXT;
  v_body          JSONB;
  v_body_text     TEXT;
  v_ts            TEXT;
  v_signature_hex TEXT;
BEGIN
  -- Idempotency guard: only fire once per ring.
  IF NEW.notified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT setting_value INTO v_url
  FROM public.system_settings WHERE setting_key = 'push_ring_webhook_url' LIMIT 1;
  SELECT setting_value INTO v_secret
  FROM public.system_settings WHERE setting_key = 'push_ring_webhook_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL
     OR length(trim(v_url)) = 0 OR length(trim(v_secret)) = 0 THEN
    RAISE NOTICE 'push webhook URL or secret missing; skipping ring %', NEW.id;
    RETURN NEW;
  END IF;

  v_ts   := extract(epoch FROM timezone('utc', now()))::BIGINT::TEXT;
  v_body := jsonb_build_object(
    'ring_id',       NEW.id,
    'house_id',      NEW.house_id,
    'door_point_id', NEW.door_point_id,
    'door_location', NEW.door_location,
    'guest_message_encrypted', NEW.guest_message_encrypted,
    'created_at',    NEW.created_at
  );
  v_body_text     := v_body::TEXT;
  v_signature_hex := encode(
    extensions.hmac(convert_to(v_ts || '.' || v_body_text, 'UTF8'), v_secret::BYTEA, 'sha256'),
    'hex'
  );

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'Authorization',       'Bearer ' || v_secret,
      'X-Webhook-Timestamp', v_ts,
      'X-Webhook-Signature', v_signature_hex
    ),
    body    := v_body,
    timeout_milliseconds := 5000
  );

  UPDATE public.doorbell_rings
  SET notified_at = timezone('utc', now())
  WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_ring_push_webhook failed for ring %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ring_push_webhook ON public.doorbell_rings;
CREATE TRIGGER trg_notify_ring_push_webhook
AFTER INSERT ON public.doorbell_rings
FOR EACH ROW
EXECUTE FUNCTION public.notify_ring_push_webhook();

-- =========================================================================
-- ring_push_dispatch: SECURITY DEFINER one-shot fetch for the Edge
-- Function. Returns every active FCM token that should receive this ring,
-- plus everything the function needs to construct the payload. Saves the
-- function from doing 5 sequential queries.
-- =========================================================================
DROP FUNCTION IF EXISTS public.ring_push_dispatch(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.ring_push_dispatch(p_ring_id UUID)
RETURNS TABLE(
  ring_id        UUID,
  house_id       UUID,
  door_point_id  UUID,
  door_location  TEXT,
  guest_message_encrypted BOOLEAN,
  fcm_token      TEXT,
  user_id        UUID,
  platform       TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.house_id, r.door_point_id, r.door_location, r.guest_message_encrypted,
    ps.fcm_token, ps.user_id, ps.platform
  FROM public.doorbell_rings r
  JOIN public.house_members hm ON hm.house_id = r.house_id
  LEFT JOIN public.door_point_members dpm
         ON dpm.user_id = hm.user_id AND dpm.door_point_id = r.door_point_id
  LEFT JOIN public.owner_settings os ON os.user_id = hm.user_id
  JOIN public.push_subscriptions ps
        ON ps.user_id = hm.user_id AND ps.is_active = true
  WHERE r.id = p_ring_id
    AND COALESCE(dpm.is_muted, false) = false
    AND COALESCE(os.push_enabled, true) = true;
END;
$$;

-- Edge Function authenticates via the webhook secret (not Postgres roles)
-- and connects with the service role, so no grant is strictly required —
-- but be explicit so it works under either credential.
GRANT EXECUTE ON FUNCTION public.ring_push_dispatch(UUID) TO service_role;

-- =========================================================================
-- mark_tokens_unregistered: bulk-deactivate stale FCM tokens that the FCM
-- v1 API reported as UNREGISTERED. The Edge Function uses this after a
-- send batch instead of doing many small UPDATEs.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.mark_tokens_unregistered(p_tokens TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_tokens IS NULL OR array_length(p_tokens, 1) IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.push_subscriptions
  SET is_active = false, updated_at = timezone('utc', now())
  WHERE fcm_token = ANY(p_tokens);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_tokens_unregistered(TEXT[]) TO service_role;

-- =========================================================================
-- Retention (Phase 4B / DSGVO): pg_cron daily purge.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.purge_old_rings_and_audit()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  DELETE FROM public.doorbell_rings
  WHERE created_at < timezone('utc', now()) - INTERVAL '90 days';

  DELETE FROM public.audit_log
  WHERE created_at < timezone('utc', now()) - INTERVAL '180 days';

  DELETE FROM public.ring_rate_limit
  WHERE window_start < timezone('utc', now()) - INTERVAL '1 hour';
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='qr-doorbell-retention') THEN
      PERFORM cron.unschedule('qr-doorbell-retention');
    END IF;
    PERFORM cron.schedule(
      'qr-doorbell-retention',
      '17 3 * * *',
      $$SELECT public.purge_old_rings_and_audit();$$
    );
  END IF;
END $$;
