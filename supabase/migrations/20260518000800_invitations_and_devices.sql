-- =========================================================================
-- 20260518000800_invitations_and_devices.sql
--
-- Batch B:
--   * house_invitations: pending invites discoverable by the invitee on
--     their next sign-in, with explicit Accept / Decline actions and an
--     FCM push notification on creation.
--   * push_subscriptions already exists; this migration only adds the
--     RPCs that the Devices screen needs to list + revoke entries.
-- =========================================================================

-- -------------------------------------------------------------------------
-- house_invitations
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.house_invitations (
  id              UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  house_id        UUID NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The invitee is identified by lower(email). The row only resolves to a
  -- specific auth.users.id once that user signs in; until then accepted_user_id is NULL.
  invited_email   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('manager','viewer')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  accepted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()) + INTERVAL '14 days',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (house_id, invited_email, status) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS house_invitations_email_idx
  ON public.house_invitations (lower(invited_email));
CREATE INDEX IF NOT EXISTS house_invitations_house_status_idx
  ON public.house_invitations (house_id, status);
CREATE INDEX IF NOT EXISTS house_invitations_pending_expires_idx
  ON public.house_invitations (status, expires_at) WHERE status = 'pending';

ALTER TABLE public.house_invitations ENABLE ROW LEVEL SECURITY;

-- House owners + managers see invites for their own houses; an invitee
-- sees invites addressed to their own (lowercased) email.
DROP POLICY IF EXISTS hi_select_owner_or_invitee ON public.house_invitations;
CREATE POLICY hi_select_owner_or_invitee ON public.house_invitations
  FOR SELECT TO authenticated
  USING (
    public.has_house_role(house_id, ARRAY['owner','manager'])
    OR lower(invited_email) = lower(coalesce(
         (SELECT email FROM auth.users WHERE id = auth.uid()),
         ''
       ))
  );

-- Only owners/managers can issue invites for their houses.
DROP POLICY IF EXISTS hi_insert_operator ON public.house_invitations;
CREATE POLICY hi_insert_operator ON public.house_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND public.has_house_role(house_id, ARRAY['owner','manager'])
  );

-- Only owners may revoke; invitees update via accept/decline RPCs.
DROP POLICY IF EXISTS hi_update_owner ON public.house_invitations;
CREATE POLICY hi_update_owner ON public.house_invitations
  FOR UPDATE TO authenticated
  USING (public.has_house_role(house_id, ARRAY['owner']))
  WITH CHECK (public.has_house_role(house_id, ARRAY['owner']));

GRANT SELECT, INSERT, UPDATE ON public.house_invitations TO authenticated;

-- -------------------------------------------------------------------------
-- create_house_invitation
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_house_invitation(
  p_house_id UUID,
  p_email    TEXT,
  p_role     TEXT DEFAULT 'manager'
)
RETURNS TABLE(id UUID, invited_email TEXT, status TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_email TEXT := lower(trim(p_email));
  v_role  TEXT := lower(trim(coalesce(p_role, 'manager')));
  v_token_push BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_house_role(p_house_id, ARRAY['owner','manager']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_email = '' THEN RAISE EXCEPTION 'Email required'; END IF;
  IF v_role NOT IN ('manager','viewer') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  -- Re-open or supersede any prior pending invite to the same email.
  UPDATE public.house_invitations
  SET status = 'revoked', updated_at = timezone('utc', now())
  WHERE house_id = p_house_id
    AND lower(invited_email) = v_email
    AND status = 'pending';

  INSERT INTO public.house_invitations (house_id, invited_by, invited_email, role)
  VALUES (p_house_id, v_actor, v_email, v_role)
  RETURNING house_invitations.id, house_invitations.invited_email,
            house_invitations.status, house_invitations.expires_at
  INTO id, invited_email, status, expires_at;

  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_house_invitation(UUID, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- accept_house_invitation / decline_house_invitation
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_house_invitation(p_invitation_id UUID)
RETURNS TABLE(house_id UUID, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_user_email TEXT;
  v_inv RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_user;

  SELECT i.id, i.house_id, i.invited_email, i.role, i.status, i.expires_at
  INTO v_inv
  FROM public.house_invitations i
  WHERE i.id = p_invitation_id
  LIMIT 1;

  IF v_inv IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'Invitation is %', v_inv.status; END IF;
  IF v_inv.expires_at < timezone('utc', now()) THEN
    UPDATE public.house_invitations SET status='expired' WHERE id = v_inv.id;
    RAISE EXCEPTION 'Invitation expired';
  END IF;
  IF lower(v_inv.invited_email) <> v_user_email THEN
    RAISE EXCEPTION 'Invitation belongs to a different email';
  END IF;

  INSERT INTO public.house_members (house_id, user_id, role)
  VALUES (v_inv.house_id, v_user, v_inv.role)
  ON CONFLICT (house_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.house_invitations
  SET status='accepted', accepted_user_id = v_user, updated_at = timezone('utc', now())
  WHERE id = v_inv.id;

  RETURN QUERY SELECT v_inv.house_id, v_inv.role;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_house_invitation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_house_invitation(p_invitation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_user_email TEXT;
  v_inv RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_user;

  SELECT i.id, i.status, i.invited_email INTO v_inv
  FROM public.house_invitations i
  WHERE i.id = p_invitation_id LIMIT 1;

  IF v_inv IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_inv.status <> 'pending' THEN RETURN false; END IF;
  IF lower(v_inv.invited_email) <> v_user_email THEN
    RAISE EXCEPTION 'Invitation belongs to a different email';
  END IF;

  UPDATE public.house_invitations
  SET status='declined', accepted_user_id=v_user, updated_at = timezone('utc', now())
  WHERE id = p_invitation_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decline_house_invitation(UUID) TO authenticated;

-- -------------------------------------------------------------------------
-- list_pending_invitations_for_me
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_invitations_for_me()
RETURNS TABLE(
  id UUID,
  house_id UUID,
  house_name TEXT,
  invited_by UUID,
  invited_by_username TEXT,
  role TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_user_email TEXT;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;
  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_user;
  IF v_user_email IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT i.id, i.house_id, h.name, i.invited_by, p.username, i.role, i.expires_at, i.created_at
  FROM public.house_invitations i
  JOIN public.houses h ON h.id = i.house_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by
  WHERE i.status = 'pending'
    AND i.expires_at > timezone('utc', now())
    AND lower(i.invited_email) = v_user_email
  ORDER BY i.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_pending_invitations_for_me() TO authenticated;

-- -------------------------------------------------------------------------
-- Trigger an FCM push to the invitee when an invitation row is created.
-- Reuses the existing notify webhook by injecting a synthetic ring-shaped
-- payload with type='invitation'. The push fan-out RPC handles type-routing.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_invitation_webhook()
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
  SELECT setting_value INTO v_url
  FROM public.system_settings WHERE setting_key='push_ring_webhook_url' LIMIT 1;
  SELECT setting_value INTO v_secret
  FROM public.system_settings WHERE setting_key='push_ring_webhook_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL OR length(trim(v_url))=0 THEN RETURN NEW; END IF;

  v_ts   := extract(epoch FROM timezone('utc', now()))::BIGINT::TEXT;
  v_body := jsonb_build_object(
    'event_type',   'invitation',
    'invitation_id', NEW.id,
    'house_id',      NEW.house_id,
    'invited_email', NEW.invited_email
  );
  v_body_text := v_body::TEXT;
  v_signature_hex := encode(
    extensions.hmac(convert_to(v_ts || '.' || v_body_text, 'UTF8'), v_secret::BYTEA, 'sha256'),
    'hex'
  );

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret,
      'X-Webhook-Timestamp', v_ts,
      'X-Webhook-Signature', v_signature_hex
    ),
    body := v_body,
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_invitation_webhook failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_invitation ON public.house_invitations;
CREATE TRIGGER trg_notify_invitation
AFTER INSERT ON public.house_invitations
FOR EACH ROW EXECUTE FUNCTION public.notify_invitation_webhook();

-- -------------------------------------------------------------------------
-- invitation_push_dispatch: SECURITY DEFINER fetch of tokens for the
-- invitee user (if they're already a Supabase user with active push subs).
-- The Edge Function will call this when event_type='invitation'.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invitation_push_dispatch(p_invitation_id UUID)
RETURNS TABLE(
  invitation_id UUID,
  house_id UUID,
  house_name TEXT,
  fcm_token TEXT,
  user_id UUID,
  platform TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN QUERY
  SELECT i.id, i.house_id, h.name, ps.fcm_token, ps.user_id, ps.platform
  FROM public.house_invitations i
  JOIN public.houses h ON h.id = i.house_id
  JOIN auth.users u ON lower(u.email) = lower(i.invited_email)
  JOIN public.push_subscriptions ps ON ps.user_id = u.id AND ps.is_active = true
  WHERE i.id = p_invitation_id
    AND i.status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION public.invitation_push_dispatch(UUID) TO service_role;

-- -------------------------------------------------------------------------
-- Devices management (Batch B #11) — already covered by push_subscriptions
-- and deactivate_push_token. No new SQL needed; the QRVault Settings UI
-- consumes existing endpoints. Below is just a convenience listing RPC
-- so we don't expose the raw push_subscriptions schema to the client.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_devices()
RETURNS TABLE(
  id UUID,
  platform TEXT,
  app_version TEXT,
  device_label TEXT,
  is_active BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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
  SELECT ps.id, ps.platform, ps.app_version, ps.device_label,
         ps.is_active, ps.last_seen_at, ps.created_at
  FROM public.push_subscriptions ps
  WHERE ps.user_id = auth.uid()
  ORDER BY ps.last_seen_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_devices() TO authenticated;

-- Revoke by id (more user-friendly than passing the raw token from UI).
CREATE OR REPLACE FUNCTION public.revoke_my_device(p_subscription_id UUID)
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
  UPDATE public.push_subscriptions
  SET is_active = false, updated_at = timezone('utc', now())
  WHERE id = p_subscription_id AND user_id = v_user;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_my_device(UUID) TO authenticated;
