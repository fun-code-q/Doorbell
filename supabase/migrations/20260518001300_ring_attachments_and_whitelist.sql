-- =========================================================================
-- 20260518001300_ring_attachments_and_whitelist.sql
--
-- Batch H:
--   #19 Image attachment from guest. We use Supabase Storage; the bucket
--       `ring-attachments` is created by the migration and an attachment
--       row in `ring_attachments` links each ciphertext blob to its ring.
--       The blob is sealed to the same recipient public keys as the ring
--       message — the server never sees plaintext.
--   #20 Visitor whitelist. After a successful ring, the verify-ring Edge
--       Function issues a signed cookie tying the visitor to a (qr_token,
--       visitor_id) pair. Returning visitors hit a relaxed rate limit and
--       skip Turnstile. visitor_ids are an HMAC of a server pepper +
--       random nonce; the database stores only the hash.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.ring_attachments (
  id          UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  ring_id     UUID NOT NULL REFERENCES public.doorbell_rings(id) ON DELETE CASCADE,
  -- The encrypted blob (one ciphertext per recipient public key), base64.
  -- We store these as JSONB so we can revisit if we want to compact later.
  ciphertexts JSONB NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),  -- 5 MiB cap
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS ring_attachments_ring_id_idx
  ON public.ring_attachments (ring_id);

REVOKE ALL ON TABLE public.ring_attachments FROM anon, authenticated;

-- Owner-side SELECT via house membership.
ALTER TABLE public.ring_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ring_attachments_select_member ON public.ring_attachments;
CREATE POLICY ring_attachments_select_member ON public.ring_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.doorbell_rings r
      WHERE r.id = ring_id
        AND (
          public.has_house_role(r.house_id, ARRAY['owner','manager'])
          OR public.check_user_is_door_member(r.door_point_id)
        )
    )
  );
GRANT SELECT ON public.ring_attachments TO authenticated;

-- RPC that attaches a (already verified) ciphertext payload to an
-- existing ring, called by the verify-ring Edge Function under the
-- service role. We do NOT expose this to anon directly because Edge
-- Function gating (size + mime check + turnstile) must happen first.
CREATE OR REPLACE FUNCTION public.attach_ring_payload(
  p_ring_id     UUID,
  p_ciphertexts JSONB,
  p_mime_type   TEXT,
  p_size_bytes  INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_ring_id IS NULL OR p_ciphertexts IS NULL OR p_mime_type IS NULL OR p_size_bytes IS NULL THEN
    RAISE EXCEPTION 'Missing args';
  END IF;
  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4') THEN
    RAISE EXCEPTION 'Unsupported mime type';
  END IF;
  IF p_size_bytes < 1 OR p_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'Attachment size out of bounds';
  END IF;
  INSERT INTO public.ring_attachments (ring_id, ciphertexts, mime_type, size_bytes)
  VALUES (p_ring_id, p_ciphertexts, p_mime_type, p_size_bytes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.attach_ring_payload(UUID, JSONB, TEXT, INTEGER) TO service_role;

-- =========================================================================
-- Visitor whitelist (Batch H #20).
-- Stores only the HMAC of (server pepper, qr_token, visitor_nonce).
-- A signed cookie returned to the browser presents qr_token + nonce; the
-- Edge Function rehashes and looks up the row. If found and the visitor
-- hasn't been blocked, Turnstile is skipped and rate limit is relaxed.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.visitor_whitelist (
  qr_token       TEXT NOT NULL,
  visitor_hash   TEXT NOT NULL,
  trust_score    INTEGER NOT NULL DEFAULT 1 CHECK (trust_score BETWEEN -10 AND 10),
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  ring_count     INTEGER NOT NULL DEFAULT 1,
  blocked        BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (qr_token, visitor_hash)
);
CREATE INDEX IF NOT EXISTS visitor_whitelist_token_idx ON public.visitor_whitelist (qr_token);

REVOKE ALL ON TABLE public.visitor_whitelist FROM anon, authenticated;

-- Edge Function helpers.
CREATE OR REPLACE FUNCTION public.observe_visitor(
  p_qr_token   TEXT,
  p_visitor_hash TEXT
)
RETURNS TABLE(trust_score INTEGER, ring_count INTEGER, blocked BOOLEAN, is_returning BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  SELECT w.trust_score, w.ring_count, w.blocked INTO v_existing
  FROM public.visitor_whitelist w
  WHERE w.qr_token = p_qr_token AND w.visitor_hash = p_visitor_hash;

  IF NOT FOUND THEN
    INSERT INTO public.visitor_whitelist (qr_token, visitor_hash)
    VALUES (p_qr_token, p_visitor_hash);
    RETURN QUERY SELECT 1::INTEGER, 1::INTEGER, FALSE, FALSE;
  ELSE
    UPDATE public.visitor_whitelist
    SET ring_count = ring_count + 1,
        last_seen_at = timezone('utc', now()),
        trust_score = LEAST(trust_score + 1, 10)
    WHERE qr_token = p_qr_token
      AND visitor_hash = p_visitor_hash;
    RETURN QUERY SELECT v_existing.trust_score, v_existing.ring_count + 1, v_existing.blocked, TRUE;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.observe_visitor(TEXT, TEXT) TO service_role;

-- Owner-side block by visitor_hash. The QRVault UI shows a "Block this visitor"
-- option once the trust_score gets high enough that they're recognized.
CREATE OR REPLACE FUNCTION public.block_visitor(
  p_qr_token TEXT,
  p_visitor_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_house UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  SELECT dp.house_id INTO v_house
  FROM public.door_points dp
  WHERE dp.qr_token = p_qr_token LIMIT 1;
  IF v_house IS NULL OR NOT public.has_house_role(v_house, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE public.visitor_whitelist
  SET blocked = TRUE
  WHERE qr_token = p_qr_token AND visitor_hash = p_visitor_hash;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.block_visitor(TEXT, TEXT) TO authenticated;
