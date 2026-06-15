-- =========================================================================
-- 20260518001000_reply_idempotency.sql
--
-- Batch D #5: append_ring_message gains an optional idempotency_key.
-- If the same (ring_id, idempotency_key) pair arrives twice within 5
-- minutes, the second call is a no-op that returns the existing state.
-- This lets the owner's offline-queue worker retry safely on transient
-- network errors, and protects against double-tap on the Reply button.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.reply_idempotency (
  ring_id         UUID NOT NULL REFERENCES public.doorbell_rings(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (ring_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS reply_idempotency_created_at_idx
  ON public.reply_idempotency (created_at);

REVOKE ALL ON TABLE public.reply_idempotency FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.append_ring_message(UUID, TEXT, TEXT, TEXT, BOOLEAN) CASCADE;

CREATE OR REPLACE FUNCTION public.append_ring_message(
  p_ring_id        UUID,
  p_role           TEXT,
  p_message        TEXT,
  p_guest_secret   TEXT    DEFAULT NULL,
  p_encrypted      BOOLEAN DEFAULT false,
  p_idempotency_key TEXT   DEFAULT NULL
)
RETURNS TABLE(id UUID, owner_reply TEXT, status TEXT, replied_at TIMESTAMPTZ, chat_history JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_role     TEXT := lower(trim(coalesce(p_role, '')));
  v_message  TEXT := trim(coalesce(p_message, ''));
  v_now      TIMESTAMPTZ := timezone('utc', now());
  v_ring     RECORD;
  v_seen     BOOLEAN;
BEGIN
  IF p_ring_id IS NULL THEN RAISE EXCEPTION 'Ring id is required'; END IF;
  IF v_role NOT IN ('guest','owner') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF v_message = '' THEN RAISE EXCEPTION 'Message is required'; END IF;
  IF length(v_message) > 2000 THEN RAISE EXCEPTION 'Message exceeds 2000 characters'; END IF;

  SELECT r.id, r.house_id, r.door_point_id, r.owner_reply, r.status, r.replied_at,
         r.guest_secret, COALESCE(r.chat_history, '[]'::jsonb) AS chat_history
  INTO v_ring
  FROM public.doorbell_rings r
  WHERE r.id = p_ring_id
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ring not found'; END IF;

  IF v_role = 'guest' THEN
    IF p_guest_secret IS NULL OR v_ring.guest_secret IS NULL
       OR trim(p_guest_secret) <> v_ring.guest_secret THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
    IF jsonb_array_length(v_ring.chat_history) >= 100 THEN
      RAISE EXCEPTION 'Conversation full';
    END IF;
  ELSE
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
    IF NOT (
      public.has_house_role(v_ring.house_id, ARRAY['owner','manager'])
      OR public.check_user_is_door_member(v_ring.door_point_id)
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  -- Idempotency check: if (ring_id, idempotency_key) was seen in the past
  -- 5 minutes, return current state without appending.
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT TRUE INTO v_seen
    FROM public.reply_idempotency ri
    WHERE ri.ring_id = p_ring_id
      AND ri.idempotency_key = trim(p_idempotency_key)
      AND ri.created_at > v_now - INTERVAL '5 minutes';
    IF v_seen THEN
      RETURN QUERY
      SELECT r.id, r.owner_reply, r.status, r.replied_at, COALESCE(r.chat_history, '[]'::jsonb)
      FROM public.doorbell_rings r WHERE r.id = p_ring_id;
      RETURN;
    END IF;
    INSERT INTO public.reply_idempotency (ring_id, idempotency_key)
    VALUES (p_ring_id, trim(p_idempotency_key))
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.doorbell_rings r
  SET
    chat_history = v_ring.chat_history || jsonb_build_array(
      jsonb_build_object('role', v_role, 'text', v_message, 'time', v_now, 'encrypted', p_encrypted)
    ),
    owner_reply = CASE WHEN v_role = 'owner' THEN v_message ELSE r.owner_reply END,
    replied_at  = CASE WHEN v_role = 'owner' THEN v_now ELSE r.replied_at END,
    status      = CASE WHEN v_role = 'owner' THEN 'responded' ELSE r.status END,
    updated_at  = v_now
  WHERE r.id = p_ring_id
  RETURNING r.id, r.owner_reply, r.status, r.replied_at, r.chat_history
  INTO id, owner_reply, status, replied_at, chat_history;

  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.append_ring_message(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT)
  TO anon, authenticated;

-- Purge old idempotency rows hourly (PG cron task body added to the
-- existing daily retention job for simplicity).
CREATE OR REPLACE FUNCTION public.purge_reply_idempotency()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  DELETE FROM public.reply_idempotency
  WHERE created_at < timezone('utc', now()) - INTERVAL '1 hour';
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='qr-doorbell-reply-idempotency-prune') THEN
      PERFORM cron.unschedule('qr-doorbell-reply-idempotency-prune');
    END IF;
    PERFORM cron.schedule(
      'qr-doorbell-reply-idempotency-prune',
      '15 * * * *',
      $$SELECT public.purge_reply_idempotency();$$
    );
  END IF;
END $$;
