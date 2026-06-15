-- =========================================================================
-- 20260518000100_helper_functions.sql
-- SECURITY DEFINER helper functions used by RLS policies. Each one bypasses
-- RLS internally (row_security = off) to avoid recursion when policies
-- reference each other. All pin search_path explicitly.
-- =========================================================================

DROP FUNCTION IF EXISTS public.is_house_owner(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.is_house_owner(p_house_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_house_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.houses h
    WHERE h.id = p_house_id AND h.owner_user_id = auth.uid()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.is_house_member(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.is_house_member(p_house_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_house_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.house_members hm
    WHERE hm.house_id = p_house_id AND hm.user_id = auth.uid()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.has_house_role(UUID, TEXT[]) CASCADE;
CREATE OR REPLACE FUNCTION public.has_house_role(p_house_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_house_id IS NULL
     OR p_roles IS NULL OR array_length(p_roles, 1) IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.house_members hm
    WHERE hm.house_id = p_house_id
      AND hm.user_id = auth.uid()
      AND hm.role = ANY (p_roles)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.check_user_is_door_member(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.check_user_is_door_member(p_door_point_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_door_point_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.door_point_members dpm
    WHERE dpm.door_point_id = p_door_point_id
      AND dpm.user_id = auth.uid()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.door_point_house_id(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.door_point_house_id(p_door_point_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_house_id UUID;
BEGIN
  SELECT dp.house_id INTO v_house_id
  FROM public.door_points dp
  WHERE dp.id = p_door_point_id
  LIMIT 1;
  RETURN v_house_id;
END;
$$;

-- =========================================================================
-- Sync door_point_members.house_id from door_points on insert/update
-- =========================================================================
CREATE OR REPLACE FUNCTION public.sync_door_point_member_house_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  SELECT dp.house_id INTO NEW.house_id
  FROM public.door_points dp
  WHERE dp.id = NEW.door_point_id
  LIMIT 1;
  IF NEW.house_id IS NULL THEN
    RAISE EXCEPTION 'Invalid door point id %', NEW.door_point_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_door_point_member_house_id ON public.door_point_members;
CREATE TRIGGER trg_sync_door_point_member_house_id
BEFORE INSERT OR UPDATE OF door_point_id ON public.door_point_members
FOR EACH ROW
EXECUTE FUNCTION public.sync_door_point_member_house_id();

-- =========================================================================
-- Auto-create profile on signup (Phase 4B retention-safe)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_base   TEXT := 'user_' || substr(replace(NEW.id::TEXT, '-', ''), 1, 8);
  v_suffix INT  := 0;
  v_try    TEXT := v_base;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.username) = lower(v_try)) LOOP
    v_suffix := v_suffix + 1;
    v_try := v_base || '_' || v_suffix;
    IF v_suffix > 32 THEN
      v_try := v_base || '_' || substr(replace(extensions.gen_random_uuid()::TEXT, '-', ''), 1, 6);
      EXIT;
    END IF;
  END LOOP;
  INSERT INTO public.profiles (id, username) VALUES (NEW.id, v_try);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- Owner of a house is automatically a member of every door point in that house
-- =========================================================================
CREATE OR REPLACE FUNCTION public.ensure_door_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT h.owner_user_id INTO v_owner
  FROM public.houses h
  WHERE h.id = NEW.house_id
  LIMIT 1;

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.door_point_members (door_point_id, house_id, user_id, is_muted)
    VALUES (NEW.id, NEW.house_id, v_owner, false)
    ON CONFLICT (door_point_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_door_owner_membership ON public.door_points;
CREATE TRIGGER trg_ensure_door_owner_membership
AFTER INSERT ON public.door_points
FOR EACH ROW
EXECUTE FUNCTION public.ensure_door_owner_membership();

-- =========================================================================
-- Audit logging trigger. Redacts PII so audit_log isn't a GDPR liability.
-- =========================================================================
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
  -- Redact fields that are sensitive in audit_log. The full row still lives
  -- in the source table; this is purely to keep the audit_log GDPR-light.
  redact_keys  TEXT[] := ARRAY[
    'guest_name','guest_message','chat_history','ip_hash','guest_secret',
    'guest_latitude','guest_longitude','guest_geo_accuracy_m',
    'fcm_token','public_key'
  ];
  k TEXT;
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

  FOREACH k IN ARRAY redact_keys LOOP
    IF v_new ? k THEN v_new := v_new || jsonb_build_object(k, '[redacted]'); END IF;
    IF v_old ? k THEN v_old := v_old || jsonb_build_object(k, '[redacted]'); END IF;
  END LOOP;

  INSERT INTO public.audit_log (house_id, user_id, action, table_name, record_id, details)
  VALUES (
    v_house_id,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_record_id,
    jsonb_build_object(
      'operation', TG_OP,
      'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_new END,
      'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE v_old END
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'log_audit_event failed on %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_door_points ON public.door_points;
CREATE TRIGGER trg_audit_door_points
AFTER INSERT OR UPDATE OR DELETE ON public.door_points
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_audit_door_point_members ON public.door_point_members;
CREATE TRIGGER trg_audit_door_point_members
AFTER INSERT OR UPDATE OR DELETE ON public.door_point_members
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_audit_house_members ON public.house_members;
CREATE TRIGGER trg_audit_house_members
AFTER INSERT OR UPDATE OR DELETE ON public.house_members
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS trg_audit_doorbell_rings ON public.doorbell_rings;
CREATE TRIGGER trg_audit_doorbell_rings
AFTER INSERT OR UPDATE OR DELETE ON public.doorbell_rings
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- =========================================================================
-- Grant permissions on security definer helpers so RLS policies can run
-- them under the context of non-admin roles (anon, authenticated).
-- =========================================================================
GRANT EXECUTE ON FUNCTION public.is_house_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_house_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_house_role(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_is_door_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.door_point_house_id(UUID) TO authenticated;
