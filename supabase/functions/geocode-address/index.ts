// =========================================================================
// geocode-address
// Server-side address → lat/lon resolver used by the QRVault "Pin door by
// address" path. We call OpenStreetMap Nominatim (free, OSM-data, requires
// a custom User-Agent + 1 req/sec courtesy rate limit). Results are cached
// in `geocode_cache` for 30 days so repeated lookups for the same address
// don't hammer Nominatim.
//
// Authentication: caller must have a valid Supabase Auth JWT — we trust
// the system to rate-limit per user. If you want to bypass that, set
// `verify_jwt = true` for this function in config.toml.
// =========================================================================
// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')  ?? '';
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const NOMINATIM_URL = Deno.env.get('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org/search';
const USER_AGENT    = Deno.env.get('GEOCODE_USER_AGENT')
                     ?? 'qr-doorbell/3.0 (please-set-GEOCODE_USER_AGENT-in-secrets)';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'Unauthorized' }, 401);

  let payload: { address?: string; country_code?: string };
  try { payload = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  const address = (payload.address ?? '').trim();
  if (address.length < 4 || address.length > 200) {
    return json({ error: 'Address must be 4-200 chars' }, 400);
  }
  const country = (payload.country_code ?? '').toUpperCase().slice(0, 2);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });

  // 1. Cache lookup.
  const cacheKey = country ? `${country}|${address}` : address;
  const cached = await admin
    .from('geocode_cache')
    .select('latitude,longitude,display_name,confidence,cached_at')
    .eq('query', cacheKey)
    .maybeSingle();
  if (cached.data
      && cached.data.cached_at
      && (Date.now() - Date.parse(cached.data.cached_at)) < 30 * 24 * 3600 * 1000) {
    return json({
      latitude:     cached.data.latitude,
      longitude:    cached.data.longitude,
      display_name: cached.data.display_name,
      confidence:   cached.data.confidence,
      cached:       true,
    });
  }

  // 2. Nominatim forward-geocode.
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '0');
  url.searchParams.set('q', address);
  if (country) url.searchParams.set('countrycodes', country.toLowerCase());

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
  } catch (e) {
    return json({ error: 'Geocoder unreachable' }, 502);
  }
  if (!res.ok) return json({ error: 'Geocoder error', status: res.status }, 502);

  const arr = await res.json() as Array<{
    lat: string; lon: string; display_name: string; importance?: number;
  }>;
  if (!arr.length) return json({ error: 'Address not found' }, 404);

  const hit = arr[0];
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'Bad geocoder response' }, 502);
  }
  const confidence = hit.importance ?? 0;

  // 3. Cache + return.
  await admin.from('geocode_cache').upsert({
    query: cacheKey,
    latitude: lat,
    longitude: lon,
    display_name: hit.display_name,
    confidence,
    cached_at: new Date().toISOString(),
  }, { onConflict: 'query' });

  return json({
    latitude:     lat,
    longitude:    lon,
    display_name: hit.display_name,
    confidence,
    cached:       false,
  });
});
