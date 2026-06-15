-- =========================================================================
-- 20260518001200_scaling_audit_diff_pagination.sql
--
-- Batch F #13: store only changed columns in audit_log.details instead of
--               the full row diff. Cuts row size dramatically on chatty
--               houses (every chat message currently writes a full
--               doorbell_rings row in both `new` and `old`).
-- Batch F #14: list_rings_page() — cursor-by-created_at pagination so the
--               dashboard doesn't materialize every historical ring.
-- Batch F #12: list_my_house_ids() — the Kotlin client uses this to build
--               a filter for the realtime subscription so it doesn't ship
--               irrelevant rings over the wire (RLS still filters them
--               server-side, but we save bandwidth + CPU).
-- =========================================================================

-- -------------------------------------------------------------------------
-- log_audit_event v2: write only the diff between old and new. PII still
-- gets redacted before the diff (same redact list as before).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_new        JSONB := COALESCE(to_jsonb(NEW), '{}'::jsonb);
  v_old        JSONB := COALESCE(to_jsonb(OLD), '{}'::jsonb);
  v_house_id   UUID;
  v_record_id  UUID;
  v_action     TEXT;
  redact_keys  TEXT[] := ARRAY[
    'guest_name','guest_message','chat_history','ip_hash','guest_secret',
    'guest_latitude','guest_longitude','guest_geo_accuracy_m',
    'fcm_token','public_key','guest_message_ciphertexts'
  ];
  v_diff       JSONB := '{}'::jsonb;
  k            TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_house_id  := NULLIF(v_old->>'house_id','')::UUID;
    v_record_id := NULLIF(v_old->>'id','')::UUID;
  ELSE
    v_house_id  := NULLIF(v_new->>'house_id','')::UUID;
    v_record_id := NULLIF(v_new->>'id','')::UUID;
  END IF;

  IF v_house_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      v_house_id := public.door_point_house_id(NULLIF(v_old->>'door_point_id','')::UUID);
    ELSE
      v_house_id := public.door_point_house_id(NULLIF(v_new->>'door_point_id','')::UUID);
    END IF;
  END IF;

  v_action := lower(TG_OP) || '_' || TG_TABLE_NAME;

  -- Redact.
  FOREACH k IN ARRAY redact_keys LOOP
    IF v_new ? k THEN v_new := v_new || jsonb_build_object(k, '[redacted]'); END IF;
    IF v_old ? k THEN v_old := v_old || jsonb_build_object(k, '[redacted]'); END IF;
  END LOOP;

  -- Diff: only fields whose value changed (or fields present in only one side).
  IF TG_OP = 'INSERT' THEN
    -- For INSERTs we still want the full (redacted) row, otherwise the
    -- audit log just says "something was inserted, somewhere".
    v_diff := jsonb_build_object('op','INSERT','row', v_new);
  ELSIF TG_OP = 'DELETE' THEN
    v_diff := jsonb_build_object('op','DELETE','row', v_old);
  ELSE
    -- UPDATE: per-column diff.
    DECLARE
      v_changed JSONB := '{}'::jsonb;
    BEGIN
      FOR k IN SELECT jsonb_object_keys(v_new) LOOP
        IF (v_old->k) IS DISTINCT FROM (v_new->k) THEN
          v_changed := v_changed || jsonb_build_object(
            k,
            jsonb_build_object('old', v_old->k, 'new', v_new->k)
          );
        END IF;
      END LOOP;
      v_diff := jsonb_build_object('op','UPDATE','diff', v_changed);
    END;
  END IF;

  INSERT INTO public.audit_log (house_id, user_id, action, table_name, record_id, details)
  VALUES (v_house_id, auth.uid(), v_action, TG_TABLE_NAME, v_record_id, v_diff);

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'log_audit_event failed on %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- -------------------------------------------------------------------------
-- list_rings_page: cursor by (created_at, id) for stable pagination
-- without offset scans. The dashboard fetches the first page, then asks
-- for older pages with the (created_at, id) of the oldest item shown.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_rings_page(
  p_house_id    UUID DEFAULT NULL,
  p_status      TEXT DEFAULT NULL,
  p_before_at   TIMESTAMPTZ DEFAULT NULL,
  p_before_id   UUID DEFAULT NULL,
  p_limit       INTEGER DEFAULT 50
)
RETURNS SETOF public.doorbell_rings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_limit INTEGER := LEAST(GREATEST(p_limit, 1), 200);
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT r.*
  FROM public.doorbell_rings r
  WHERE
    -- Visibility: house member with appropriate role OR per-door member.
    (
      public.has_house_role(r.house_id, ARRAY['owner','manager'])
      OR public.check_user_is_door_member(r.door_point_id)
    )
    AND (p_house_id IS NULL OR r.house_id = p_house_id)
    AND (p_status   IS NULL OR r.status   = p_status)
    AND (
      p_before_at IS NULL OR
      (r.created_at, r.id) < (p_before_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT v_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_rings_page(UUID, TEXT, TIMESTAMPTZ, UUID, INTEGER) TO authenticated;

-- -------------------------------------------------------------------------
-- list_my_house_ids: tiny helper the Kotlin client uses to build the
-- realtime filter `house_id=in.(...)`.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_house_ids()
RETURNS TABLE(house_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT DISTINCT hm.house_id
  FROM public.house_members hm
  WHERE hm.user_id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_house_ids() TO authenticated;
