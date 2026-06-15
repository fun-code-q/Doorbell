-- =========================================================================
-- 20260518000200_rls_policies.sql
-- Locks down every table with Row Level Security. Notable security fixes
-- vs. the old single-page schema:
--
--   * No `USING (true)` policies anywhere.
--   * `anon` has ZERO direct table SELECT on doorbell_rings, door_points,
--     houses, profiles. Guests go through SECURITY DEFINER RPCs only.
--   * Realtime channels respect RLS, so dropping anon SELECT also closes
--     the channel-subscribe leak from the previous design.
--   * profiles SELECT is scoped to "same-house peers", not the world.
-- =========================================================================

ALTER TABLE public.houses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_points         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_point_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doorbell_rings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_public_keys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ring_rate_limit     ENABLE ROW LEVEL SECURITY;

-- Force-default-deny: revoke broad grants. Anon is never given direct
-- table access; authenticated only what they need below.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Grants required for authenticated users to interact with their own data
-- through PostgREST. Combined with the RLS policies below, this is safe.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.houses              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.house_members       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.door_points         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.door_point_members  TO authenticated;
GRANT SELECT, UPDATE,        DELETE ON public.doorbell_rings       TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.profiles            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_settings      TO authenticated;
GRANT SELECT,                DELETE  ON public.audit_log           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_public_keys   TO authenticated;
-- system_settings and ring_rate_limit are server-side only.

-- =========================================================================
-- houses
-- =========================================================================
DROP POLICY IF EXISTS houses_select_member ON public.houses;
CREATE POLICY houses_select_member ON public.houses
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_house_member(id));

DROP POLICY IF EXISTS houses_insert_owner ON public.houses;
CREATE POLICY houses_insert_owner ON public.houses
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS houses_update_owner ON public.houses;
CREATE POLICY houses_update_owner ON public.houses
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS houses_delete_owner ON public.houses;
CREATE POLICY houses_delete_owner ON public.houses
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- =========================================================================
-- door_points
-- =========================================================================
DROP POLICY IF EXISTS door_points_select_member ON public.door_points;
CREATE POLICY door_points_select_member ON public.door_points
  FOR SELECT TO authenticated
  USING (public.is_house_member(house_id) OR public.check_user_is_door_member(id));

DROP POLICY IF EXISTS door_points_manage_house_operator ON public.door_points;
CREATE POLICY door_points_manage_house_operator ON public.door_points
  FOR ALL TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner', 'manager']))
  WITH CHECK (public.has_house_role(house_id, ARRAY['owner', 'manager']));

-- =========================================================================
-- doorbell_rings
-- NOTE: anon has NO direct access. Guests must use:
--   * create_doorbell_ring_by_token(...)        — creates the ring
--   * get_guest_ring_reply_by_token(...)        — reads owner reply
--   * append_ring_message(..., p_guest_secret)  — adds follow-up message
-- All three are SECURITY DEFINER and verify the per-ring guest_secret.
-- Realtime subscriptions for anon are likewise blocked because there is
-- no anon SELECT policy.
-- =========================================================================
DROP POLICY IF EXISTS rings_select_guest ON public.doorbell_rings;
-- ^ deliberately do NOT recreate; previous policy was the bug.

DROP POLICY IF EXISTS rings_select_member ON public.doorbell_rings;
CREATE POLICY rings_select_member ON public.doorbell_rings
  FOR SELECT TO authenticated
  USING (
    public.has_house_role(house_id, ARRAY['owner','manager'])
    OR public.check_user_is_door_member(door_point_id)
  );

DROP POLICY IF EXISTS rings_insert_member ON public.doorbell_rings;
CREATE POLICY rings_insert_member ON public.doorbell_rings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_house_role(house_id, ARRAY['owner','manager'])
    OR public.check_user_is_door_member(door_point_id)
  );

DROP POLICY IF EXISTS rings_update_member ON public.doorbell_rings;
CREATE POLICY rings_update_member ON public.doorbell_rings
  FOR UPDATE TO authenticated
  USING (
    public.has_house_role(house_id, ARRAY['owner','manager'])
    OR public.check_user_is_door_member(door_point_id)
  )
  WITH CHECK (
    public.has_house_role(house_id, ARRAY['owner','manager'])
    OR public.check_user_is_door_member(door_point_id)
  );

DROP POLICY IF EXISTS rings_delete_owner ON public.doorbell_rings;
CREATE POLICY rings_delete_owner ON public.doorbell_rings
  FOR DELETE TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner']));

-- =========================================================================
-- house_members
-- =========================================================================
DROP POLICY IF EXISTS house_members_select ON public.house_members;
CREATE POLICY house_members_select ON public.house_members
  FOR SELECT TO authenticated
  USING (public.is_house_member(house_id));

DROP POLICY IF EXISTS house_members_manage_owner ON public.house_members;
CREATE POLICY house_members_manage_owner ON public.house_members
  FOR ALL TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner']))
  WITH CHECK (public.has_house_role(house_id, ARRAY['owner']));

-- =========================================================================
-- door_point_members
-- =========================================================================
DROP POLICY IF EXISTS door_point_members_select ON public.door_point_members;
CREATE POLICY door_point_members_select ON public.door_point_members
  FOR SELECT TO authenticated
  USING (public.is_house_member(house_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS door_point_members_manage_operator ON public.door_point_members;
CREATE POLICY door_point_members_manage_operator ON public.door_point_members
  FOR ALL TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner','manager']))
  WITH CHECK (public.has_house_role(house_id, ARRAY['owner','manager']));

-- Allow a member to toggle is_muted for themselves only. Cannot move the
-- row to a different user via UPDATE because WITH CHECK pins user_id.
DROP POLICY IF EXISTS door_point_members_update_self ON public.door_point_members;
CREATE POLICY door_point_members_update_self ON public.door_point_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =========================================================================
-- profiles
-- Only same-house peers can see each other.
-- =========================================================================
DROP POLICY IF EXISTS profiles_public_select ON public.profiles;
DROP POLICY IF EXISTS profiles_peer_select ON public.profiles;
CREATE POLICY profiles_peer_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.house_members mine
      JOIN public.house_members theirs ON theirs.house_id = mine.house_id
      WHERE mine.user_id  = auth.uid()
        AND theirs.user_id = public.profiles.id
    )
  );

DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- =========================================================================
-- owner_settings
-- =========================================================================
DROP POLICY IF EXISTS owner_settings_select_self ON public.owner_settings;
CREATE POLICY owner_settings_select_self ON public.owner_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS owner_settings_insert_self ON public.owner_settings;
CREATE POLICY owner_settings_insert_self ON public.owner_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS owner_settings_update_self ON public.owner_settings;
CREATE POLICY owner_settings_update_self ON public.owner_settings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS owner_settings_delete_self ON public.owner_settings;
CREATE POLICY owner_settings_delete_self ON public.owner_settings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =========================================================================
-- audit_log
-- =========================================================================
DROP POLICY IF EXISTS audit_log_select_house_member ON public.audit_log;
CREATE POLICY audit_log_select_house_member ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.is_house_member(house_id));

DROP POLICY IF EXISTS audit_log_delete_owner ON public.audit_log;
CREATE POLICY audit_log_delete_owner ON public.audit_log
  FOR DELETE TO authenticated
  USING (public.is_house_owner(house_id));

-- =========================================================================
-- push_subscriptions
-- =========================================================================
DROP POLICY IF EXISTS push_subscriptions_select_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_self ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_insert_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_self ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_update_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_self ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_delete_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_self ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =========================================================================
-- owner_public_keys
-- An authenticated user can manage their own pubkeys; guests fetch via RPC.
-- =========================================================================
DROP POLICY IF EXISTS owner_public_keys_select_self ON public.owner_public_keys;
CREATE POLICY owner_public_keys_select_self ON public.owner_public_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_house_member(house_id));

DROP POLICY IF EXISTS owner_public_keys_insert_self ON public.owner_public_keys;
CREATE POLICY owner_public_keys_insert_self ON public.owner_public_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_house_member(house_id));

DROP POLICY IF EXISTS owner_public_keys_update_self ON public.owner_public_keys;
CREATE POLICY owner_public_keys_update_self ON public.owner_public_keys
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS owner_public_keys_delete_self ON public.owner_public_keys;
CREATE POLICY owner_public_keys_delete_self ON public.owner_public_keys
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =========================================================================
-- ring_rate_limit: server-side only. Default-deny; no anon/authenticated grants.
-- =========================================================================
DROP POLICY IF EXISTS ring_rate_limit_no_select ON public.ring_rate_limit;
-- intentionally empty: no client role has SELECT/INSERT here.

-- =========================================================================
-- Realtime: publish only the tables we want pushed. RLS still applies.
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='doorbell_rings'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.doorbell_rings';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='door_points'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.door_points';
    END IF;
  END IF;
END $$;

-- Realtime needs full row identity to emit updated columns on UPDATE events.
ALTER TABLE public.doorbell_rings REPLICA IDENTITY FULL;
ALTER TABLE public.door_points    REPLICA IDENTITY FULL;
