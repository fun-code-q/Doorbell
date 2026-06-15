-- =========================================================================
-- 20260518001800_feedback.sql
-- Owner-submitted bug reports / feature requests. Visible only to
-- service_role; a future maintenance task / admin tool will read this.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.user_feedback (
  id           UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category     TEXT NOT NULL CHECK (category IN ('bug','feature','question','praise')),
  message      TEXT NOT NULL CHECK (length(message) BETWEEN 4 AND 2000),
  device_label TEXT,
  app_version  TEXT,
  android_sdk  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS user_feedback_created_at_idx
  ON public.user_feedback (created_at DESC);

REVOKE ALL ON TABLE public.user_feedback FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_category     TEXT,
  p_message      TEXT,
  p_device_label TEXT DEFAULT NULL,
  p_app_version  TEXT DEFAULT NULL,
  p_android_sdk  INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id   UUID;
  v_cat  TEXT := lower(trim(coalesce(p_category, '')));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF v_cat NOT IN ('bug','feature','question','praise') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;
  INSERT INTO public.user_feedback (user_id, category, message, device_label, app_version, android_sdk)
  VALUES (
    v_user, v_cat, trim(p_message),
    nullif(trim(coalesce(p_device_label, '')), ''),
    nullif(trim(coalesce(p_app_version,  '')), ''),
    p_android_sdk
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_feedback(TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
