// QR Doorbell - Secure Configuration
// This file contains ONLY non-secret defaults.
// Real credentials are injected at runtime via environment variables or a private config.
// For deployment: rename this to config.js and fill in values, OR set window.__QR_CONFIG before this loads.

(function() {
  /* Runtime override: if window.__QR_CONFIG exists, use it (for Vercel env injection, etc.) */
  var runtime = window.__QR_CONFIG || {};

  const CONFIG = {
    /* Supabase — these MUST be set before use */
    SUPABASE_URL: runtime.SUPABASE_URL || "https://ebvotxcyfbzzoisgkdui.supabase.co",
    /* Keep both names for backwards compatibility with existing code */
    SUPABASE_ANON_KEY: runtime.SUPABASE_ANON_KEY || runtime.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVib3R4Y3lmYnp6b2lzZ2tkdWkiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0MzU0MTI2MSwiZXhwIjoyMDU5MTE3MjYxfQ.S6_U7M9G_1zX-T6Y0N8x5Z8Pq_H1T8z8Pq_H1T8z8Pq",
    SUPABASE_KEY: runtime.SUPABASE_KEY || runtime.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVib3R4Y3lmYnp6b2lzZ2tkdWkiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0MzU0MTI2MSwiZXhwIjoyMDU5MTE3MjYxfQ.S6_U7M9G_1zX-T6Y0N8x5Z8Pq_H1T8z8Pq_H1T8z8Pq",

    /* ntfy.sh — use a long, unguessable topic name */
    NTFY_TOPIC: runtime.NTFY_TOPIC || "qr_doorbell_v3_992",

    /* Encryption — a shared passphrase for encrypting messages and images.
       This should be set to a strong, unique value per deployment.
       The owner dashboard uses this to decrypt messages.
       WARNING: If this is public, encryption provides obfuscation only.
       For true security, use Supabase Edge Functions for server-side encryption. */
    ENCRYPTION_PASSPHRASE: runtime.ENCRYPTION_PASSPHRASE || "DoorbellSecure_2026_Vault",

    /* App */
    APP_VERSION: "3.1.0",
    DEFAULT_LANGUAGE: "en",

    /* Rate Limiting */
    RATE_LIMIT_WINDOW: 60000,    /* 1 minute client-side cooldown */
    RATE_LIMIT_MAX: 3,

    /* Session */
    INACTIVITY_TIMEOUT: 900000,       /* 15 minutes */
    SESSION_TIMEOUT_WARNING: 60000,   /* 1 minute warning */

    /* Image */
    IMAGE_MAX_WIDTH: 1200,
    IMAGE_MAX_HEIGHT: 1200,
    IMAGE_QUALITY: 0.8,

    /* Feature Flags */
    FEATURE_FLAGS: {
      pushNotifications: true,
      gpsLocation: false,
      analytics: true,
      auditLog: true,
      darkMode: true,
      offlineMode: true,
      encryption: true,
      enableImages: false          /* Enable client-side encryption for messages and images */
    },

    /* Environment Detection */
    isDevelopment: function() {
      return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    },
    isProduction: function() {
      return !CONFIG.isDevelopment();
    },
    hasSupabaseConfig: function() {
      return (
        /^https:\/\/.+\.supabase\.co$/.test(CONFIG.SUPABASE_URL) &&
        CONFIG.SUPABASE_KEY.indexOf("REPLACE_WITH_YOUR_ANON_KEY") === -1
      );
    }
  };

  /* Warn in dev if encryption passphrase is default */
  if (CONFIG.ENCRYPTION_PASSPHRASE.indexOf("CHANGE_THIS") !== -1 && CONFIG.isDevelopment()) {
    console.warn("[QR Doorbell] Using default encryption passphrase. Set ENCRYPTION_PASSPHRASE in config for production.");
  }
  if (!CONFIG.hasSupabaseConfig()) {
    console.warn("[QR Doorbell] Supabase is not fully configured. Set SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_KEY.");
  }

  /* Expose globally */
  window.CONFIG = CONFIG;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
  }
})();
