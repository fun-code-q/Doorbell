-- =========================================================================
-- 20260518001700_geocode_cache.sql
--
-- 30-day cache for Nominatim address lookups (Batch N #2). Server-side
-- only; the `geocode-address` Edge Function reads + writes it.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  query        TEXT PRIMARY KEY,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  display_name TEXT,
  confidence   DOUBLE PRECISION,
  cached_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS geocode_cache_cached_at_idx
  ON public.geocode_cache (cached_at);

REVOKE ALL ON TABLE public.geocode_cache FROM anon, authenticated;

-- Daily prune of entries older than 90 days (the function's freshness
-- window is 30 days, but we keep cold entries for analytics one extra
-- bucket then drop).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='qr-doorbell-geocode-prune') THEN
      PERFORM cron.unschedule('qr-doorbell-geocode-prune');
    END IF;
    PERFORM cron.schedule(
      'qr-doorbell-geocode-prune',
      '7 4 * * *',
      $$DELETE FROM public.geocode_cache WHERE cached_at < timezone('utc', now()) - INTERVAL '90 days';$$
    );
  END IF;
END $$;
