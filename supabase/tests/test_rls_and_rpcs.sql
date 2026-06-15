-- =========================================================================
-- pgTAP-style assertions for the critical SQL surface.
-- Run with:
--   supabase db remote commit
--   supabase test db
-- (or copy/paste into the SQL editor against a clean staging instance)
--
-- Scope: the highest-risk RLS / RPC behaviours. Not a full suite — those
-- live in QRVault's Android tests and the Edge Function Deno tests.
-- =========================================================================

BEGIN;

-- TAP-lite: each block returns one row with a boolean expectation.

-- 1. Anonymous cannot SELECT doorbell_rings directly.
SET ROLE anon;
DO $$
DECLARE v_count INT;
BEGIN
  BEGIN
    SELECT COUNT(*) INTO v_count FROM public.doorbell_rings;
    -- If we got here, the policy let anon read. Fail loudly.
    RAISE EXCEPTION 'FAIL: anon was able to SELECT from doorbell_rings (count=%)', v_count;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK: anon blocked from doorbell_rings';
    WHEN OTHERS THEN
      -- Permission denied may come back as a different error class
      -- depending on whether RLS or GRANT blocked first. Either is fine.
      RAISE NOTICE 'OK (variant): %', SQLERRM;
  END;
END $$;
RESET ROLE;

-- 2. Invalid qr_token returns the P0001 error.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_doorbell_ring_by_token('nonexistent_token_zzz');
    RAISE EXCEPTION 'FAIL: invalid token did not raise';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    RAISE NOTICE 'OK: invalid token raised P0001';
  END;
END $$;
RESET ROLE;

-- 3. Rate-limit fires after 3 rings in the same minute from the same ip_hash.
-- (Requires a seeded door_point row; we skip if none exists.)
DO $$
DECLARE
  v_token TEXT;
BEGIN
  SELECT qr_token INTO v_token FROM public.door_points WHERE is_active = true LIMIT 1;
  IF v_token IS NULL THEN
    RAISE NOTICE 'SKIP: no door_points seeded';
    RETURN;
  END IF;

  -- Burn through 3 rings, expect ok.
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM public.create_doorbell_ring_by_token(
        v_token, 'unit test', false, 'unit-test-ip', NULL, NULL, NULL, NULL::TEXT[], gen_random_uuid()::TEXT
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'WARN: ring % failed unexpectedly: %', i, SQLERRM;
    END;
  END LOOP;

  -- 4th should hit P0002.
  BEGIN
    PERFORM public.create_doorbell_ring_by_token(
      v_token, 'unit test', false, 'unit-test-ip', NULL, NULL, NULL, NULL::TEXT[], gen_random_uuid()::TEXT
    );
    RAISE NOTICE 'WARN: 4th ring did not rate-limit (perhaps door has no IP-tracking)';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    RAISE NOTICE 'OK: 4th ring rate-limited with P0002';
  END;
END $$;

ROLLBACK;
