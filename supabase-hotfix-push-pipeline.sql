-- QR Doorbell Push Pipeline Hotfix
-- Run this only on existing deployments that were initialized before
-- `system_settings` and dynamic webhook configuration were introduced.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('push_ring_webhook_url', NULL)
ON CONFLICT (setting_key) DO NOTHING;

REVOKE ALL ON TABLE public.system_settings FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.touch_system_settings_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.touch_system_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER trg_touch_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_system_settings_updated_at();

DROP FUNCTION IF EXISTS public.notify_ring_push_webhook() CASCADE;
CREATE OR REPLACE FUNCTION public.notify_ring_push_webhook()
RETURNS TRIGGER AS $$
DECLARE
  v_webhook_url TEXT;
BEGIN
  SELECT nullif(trim(coalesce(setting_value, '')), '')
  INTO v_webhook_url
  FROM public.system_settings
  WHERE setting_key = 'push_ring_webhook_url'
  LIMIT 1;

  IF v_webhook_url IS NULL THEN
    RAISE NOTICE 'push_ring_webhook_url is not configured; skipping push webhook for ring %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_webhook_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'ring_id', NEW.id,
      'house_id', NEW.house_id,
      'door_location', NEW.door_location,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_ring_push_webhook failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security = off;

DROP TRIGGER IF EXISTS trg_notify_ring_push_webhook ON public.doorbell_rings;
CREATE TRIGGER trg_notify_ring_push_webhook
AFTER INSERT ON public.doorbell_rings
FOR EACH ROW
EXECUTE FUNCTION public.notify_ring_push_webhook();

-- Configure this value for your project after running this hotfix:
-- update public.system_settings
-- set setting_value = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-ring-notification'
-- where setting_key = 'push_ring_webhook_url';
