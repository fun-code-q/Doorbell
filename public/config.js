// QR Doorbell - Secure Configuration
// This file contains ONLY non-secret defaults.
// Real credentials are injected at runtime via environment variables or a private config.
// For deployment: rename this to config.js and fill in values, OR set window.__QR_CONFIG before this loads.

(function() {
  /* Runtime override: if window.__QR_CONFIG exists, use it (for Vercel env injection, etc.) */
  var runtime = window.__QR_CONFIG || {};
  var defaultSupabaseUrl = "REPLACE_WITH_YOUR_SUPABASE_URL";
  var defaultSupabaseAnonKey = "REPLACE_WITH_YOUR_ANON_KEY";
  var resolvedSupabaseUrl = (runtime.SUPABASE_URL || defaultSupabaseUrl || "").trim().replace(/\/+$/, "");
  var resolvedSupabaseAnonKey = (runtime.SUPABASE_ANON_KEY || runtime.SUPABASE_KEY || defaultSupabaseAnonKey || "").trim();

  const CONFIG = {
    /* Supabase — these MUST be set before use */
    SUPABASE_URL: resolvedSupabaseUrl,
    /* Keep both names for backwards compatibility with existing code */
    SUPABASE_ANON_KEY: resolvedSupabaseAnonKey,
    SUPABASE_KEY: runtime.SUPABASE_KEY || runtime.SUPABASE_ANON_KEY || resolvedSupabaseAnonKey,


    /* App */
    APP_VERSION: "3.1.0",
    DEFAULT_LANGUAGE: "en",

    /* Rate Limiting */
    RATE_LIMIT_WINDOW: 60000,    /* 1 minute client-side cooldown */
    RATE_LIMIT_MAX: 3,

    /* Session */
    INACTIVITY_TIMEOUT: 900000,       /* 15 minutes */
    SESSION_TIMEOUT_WARNING: 60000,   /* 1 minute warning */


    /* Feature Flags */
    FEATURE_FLAGS: {
      pushNotifications: true,
      gpsLocation: false,
      analytics: true,
      auditLog: true,
      darkMode: true,
      offlineMode: true,
      guestLiveReplies: true
    },

    /* Environment Detection */
    isDevelopment: function() {
      return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    },
    isProduction: function() {
      return !CONFIG.isDevelopment();
    },
    hasSupabaseConfig: function() {
      var url = (CONFIG.SUPABASE_URL || "").trim();
      var key = (CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_KEY || "").trim();
      var urlValid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
      var keyLooksLikeJwt = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(key);
      var keyLooksLikePublishable = /^sb_(publishable|anon|public)_[A-Za-z0-9._-]+$/i.test(key);
      var keyValid = keyLooksLikeJwt || keyLooksLikePublishable;
      var usingPlaceholders = /^REPLACE_WITH_/i.test(url) || /^REPLACE_WITH_/i.test(key);
      return (
        urlValid &&
        keyValid &&
        !usingPlaceholders
      );
    }
  };

  if (!CONFIG.hasSupabaseConfig()) {
    console.warn("[QR Doorbell] Supabase is not fully configured. Set SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_KEY.");
  }

  /* Expose globally */
  window.CONFIG = CONFIG;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
  }
})();
