// QR Doorbell — Guest Web Configuration
// This file contains ONLY non-secret defaults. Real values are injected at
// deploy time via window.__QR_CONFIG (set before this script runs) or by
// regenerating this file from the .env at the deploy step.
//
// What lives here vs USER_ACTIONS.md:
//   * SUPABASE_URL + SUPABASE_ANON_KEY — public by Supabase design, RLS gates everything
//   * VERIFY_RING_URL — the Edge Function that gates ring creation
//     (Turnstile + geofence + rate limit happen on the server)
//   * TURNSTILE_SITE_KEY — public Cloudflare key, paired with TURNSTILE_SECRET_KEY in the function
//   * GUEST_PUBLIC_BASE — used to detect that the page is being served from the
//     expected origin; mismatches abort with a security toast

(function () {
  var runtime = window.__QR_CONFIG || {};

  function clean(value) {
    return (value || "").toString().trim();
  }

  var CONFIG = {
    SUPABASE_URL:      clean(runtime.SUPABASE_URL      || "REPLACE_WITH_YOUR_SUPABASE_URL").replace(/\/+$/, ""),
    SUPABASE_ANON_KEY: clean(runtime.SUPABASE_ANON_KEY || runtime.SUPABASE_KEY || "REPLACE_WITH_YOUR_SUPABASE_ANON_KEY"),

    // Cloudflare Turnstile invisible captcha. Tied to the verify-ring secret.
    TURNSTILE_SITE_KEY: clean(runtime.TURNSTILE_SITE_KEY || ""),

    // The verify-ring Edge Function URL. The browser ALWAYS goes through this
    // endpoint to create a ring — never directly into PostgREST. Server-side
    // checks: Turnstile verify, origin allow-list, peppered IP hash, then the
    // SECURITY DEFINER create_doorbell_ring_by_token RPC (which enforces
    // geofence + rate limit).
    VERIFY_RING_URL: clean(runtime.VERIFY_RING_URL || ""),

    // For sanity-checking the page is served from a known origin (CSP +
    // a runtime check that warns the user if config & host disagree).
    EXPECTED_ORIGIN: clean(runtime.EXPECTED_ORIGIN || ""),

    APP_VERSION: "3.0.0",
    DEFAULT_LANGUAGE: clean(runtime.DEFAULT_LANGUAGE || "en"),

    FEATURE_FLAGS: {
      // gpsLocation: required when the door has a geofence configured. Off
      // disables the prompt; the RPC still rejects rings missing coordinates
      // for geofenced doors.
      gpsLocation: true,
      // e2eEncryption: when true, fetch the owner's public key and seal-box
      // encrypt the message. When false (or no key available), plaintext.
      e2eEncryption: true,
      offlineMode: true,
      guestLiveReplies: true,
    },

    isDevelopment: function () {
      return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    },
    isProduction: function () { return !CONFIG.isDevelopment(); },

    hasSupabaseConfig: function () {
      var url = CONFIG.SUPABASE_URL;
      var key = CONFIG.SUPABASE_ANON_KEY;
      var urlValid = /^https:\/\/[a-z0-9.-]+\.(supabase\.(co|in|net)|[a-z]{2,})$/i.test(url);
      var keyLooksLikeJwt = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(key);
      var keyLooksLikePublishable = /^sb_(publishable|anon|public)_[A-Za-z0-9._-]+$/i.test(key);
      var placeholders = /^REPLACE_WITH_/i.test(url) || /^REPLACE_WITH_/i.test(key);
      return urlValid && (keyLooksLikeJwt || keyLooksLikePublishable) && !placeholders;
    },

    hasVerifyEndpoint: function () { return !!CONFIG.VERIFY_RING_URL; },
    hasTurnstile:      function () { return !!CONFIG.TURNSTILE_SITE_KEY; },
  };

  if (!CONFIG.hasSupabaseConfig()) {
    console.warn("[QR Doorbell] Supabase configuration is missing or invalid.");
  }
  if (!CONFIG.hasVerifyEndpoint()) {
    console.warn("[QR Doorbell] VERIFY_RING_URL is not set; ring submission will fail.");
  }

  window.CONFIG = CONFIG;
})();
