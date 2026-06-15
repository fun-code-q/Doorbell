-- =========================================================================
-- 20260518000900_push_dlq_and_monitoring.sql
--
-- Batch C reliability:
--   * push_dispatch_log: one row per FCM v1 send attempt. Lets the team
--     answer "what's our delivery rate this week?" without invoking the
--     Edge Function logs UI. The Edge Function writes here on every call.
--   * push_dispatch_failures: a dead-letter queue. When the Edge Function
--     can't reach FCM at all (HTTP non-200 from the v1 API, network), it
--     parks the dispatch here. A pg_cron worker replays up to 5 times
--     before marking it permanently failed.
--   * `retry_pending_push_dispatch`: the cron task body.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.push_dispatch_log (
  id              BIGSERIAL PRIMARY KEY,
  ring_id         UUID,
  invitation_id   UUID,
  user_id         UUID,
  fcm_token_tail  TEXT,                -- last 8 chars of the token, for grep without leaking
  outcome         TEXT NOT NULL CHECK (outcome IN ('sent','failed','unregistered','skipped')),
  error_code      TEXT,
  http_status     INTEGER,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS push_dispatch_log_created_at_idx
  ON public.push_dispatch_log (created_at DESC);
CREATE INDEX IF NOT EXISTS push_dispatch_log_outcome_idx
  ON public.push_dispatch_log (outcome, created_at DESC);

-- Server-side only.
REVOKE ALL ON TABLE public.push_dispatch_log FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.push_dispatch_failures (
  id              UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  ring_id         UUID,
  invitation_id   UUID,
  payload         JSONB NOT NULL,        -- the original webhook body
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retrying','dead','sent')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS push_failures_next_attempt_idx
  ON public.push_dispatch_failures (status, next_attempt_at)
  WHERE status IN ('pending','retrying');

REVOKE ALL ON TABLE public.push_dispatch_failures FROM anon, authenticated;

-- -------------------------------------------------------------------------
-- record_push_dispatch: called by the Edge Function as a batched insert.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_push_dispatch(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN 0; END IF;
  INSERT INTO public.push_dispatch_log
    (ring_id, invitation_id, user_id, fcm_token_tail, outcome, error_code, http_status, latency_ms)
  SELECT
    nullif(r->>'ring_id','')::UUID,
    nullif(r->>'invitation_id','')::UUID,
    nullif(r->>'user_id','')::UUID,
    nullif(r->>'fcm_token_tail',''),
    coalesce(r->>'outcome','failed'),
    nullif(r->>'error_code',''),
    nullif(r->>'http_status','')::INTEGER,
    nullif(r->>'latency_ms','')::INTEGER
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_push_dispatch(JSONB) TO service_role;

-- -------------------------------------------------------------------------
-- enqueue_push_dispatch_failure: webhook calls this when the whole batch
-- fails (the FCM HTTP endpoint is unreachable / non-200). Per-token
-- failures with errorCode UNREGISTERED are NOT enqueued — those are
-- terminal and already handled by mark_tokens_unregistered.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_push_dispatch_failure(
  p_payload JSONB,
  p_error TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_id UUID;
  v_ring UUID := nullif(p_payload->>'ring_id','')::UUID;
  v_inv  UUID := nullif(p_payload->>'invitation_id','')::UUID;
BEGIN
  INSERT INTO public.push_dispatch_failures (ring_id, invitation_id, payload, last_error)
  VALUES (v_ring, v_inv, p_payload, p_error)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_push_dispatch_failure(JSONB, TEXT) TO service_role;

-- -------------------------------------------------------------------------
-- retry_pending_push_dispatch: cron-driven worker. Picks up to N rows
-- whose next_attempt_at is due and re-fires the webhook. After 5 attempts
-- without success the row is marked 'dead' and the team can act on the
-- dashboard count.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_pending_push_dispatch(p_max_rows INTEGER DEFAULT 50)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_url      TEXT;
  v_secret   TEXT;
  v_row      RECORD;
  v_body     TEXT;
  v_ts       TEXT;
  v_sig      TEXT;
  v_count    INTEGER := 0;
BEGIN
  SELECT setting_value INTO v_url    FROM public.system_settings WHERE setting_key='push_ring_webhook_url'    LIMIT 1;
  SELECT setting_value INTO v_secret FROM public.system_settings WHERE setting_key='push_ring_webhook_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN 0; END IF;

  FOR v_row IN
    SELECT id, payload, attempts
    FROM public.push_dispatch_failures
    WHERE status IN ('pending','retrying')
      AND next_attempt_at <= timezone('utc', now())
    ORDER BY next_attempt_at ASC
    LIMIT p_max_rows
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ts   := extract(epoch FROM timezone('utc', now()))::BIGINT::TEXT;
    v_body := v_row.payload::TEXT;
    v_sig  := encode(
      extensions.hmac(convert_to(v_ts || '.' || v_body, 'UTF8'), v_secret::BYTEA, 'sha256'),
      'hex'
    );

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret,
        'X-Webhook-Timestamp', v_ts,
        'X-Webhook-Signature', v_sig,
        'X-Webhook-Retry', 'true'
      ),
      body := v_row.payload,
      timeout_milliseconds := 5000
    );

    -- Exponential backoff: 30s, 2m, 8m, 30m, 2h. After 5 attempts -> dead.
    UPDATE public.push_dispatch_failures
    SET attempts        = attempts + 1,
        last_attempt_at = timezone('utc', now()),
        status          = CASE WHEN attempts + 1 >= 5 THEN 'dead' ELSE 'retrying' END,
        next_attempt_at = timezone('utc', now())
                          + make_interval(secs => power(4, LEAST(attempts + 1, 5))::INTEGER * 30)
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.retry_pending_push_dispatch(INTEGER) TO service_role;

-- -------------------------------------------------------------------------
-- mark_dispatch_resolved: Edge Function calls this when a previously
-- failed payload has now succeeded (during a retry).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_dispatch_resolved(p_failure_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  UPDATE public.push_dispatch_failures
  SET status = 'sent', last_attempt_at = timezone('utc', now())
  WHERE id = p_failure_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_dispatch_resolved(UUID) TO service_role;

-- -------------------------------------------------------------------------
-- Cron schedule: every minute, retry up to 50 pending dispatches.
-- Plus daily prune of log entries > 60 days.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='qr-doorbell-push-retry') THEN
      PERFORM cron.unschedule('qr-doorbell-push-retry');
    END IF;
    PERFORM cron.schedule(
      'qr-doorbell-push-retry',
      '* * * * *',
      $$SELECT public.retry_pending_push_dispatch();$$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='qr-doorbell-push-log-prune') THEN
      PERFORM cron.unschedule('qr-doorbell-push-log-prune');
    END IF;
    PERFORM cron.schedule(
      'qr-doorbell-push-log-prune',
      '23 4 * * *',
      $$DELETE FROM public.push_dispatch_log WHERE created_at < timezone('utc', now()) - INTERVAL '60 days';
        DELETE FROM public.push_dispatch_failures WHERE status='dead' AND created_at < timezone('utc', now()) - INTERVAL '30 days';
        DELETE FROM public.push_dispatch_failures WHERE status='sent' AND created_at < timezone('utc', now()) - INTERVAL '7 days';$$
    );
  END IF;
END $$;
