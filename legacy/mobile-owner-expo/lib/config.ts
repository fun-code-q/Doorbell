// QR Vault - App Config
// Replaces the web config.js - no window.* references

const rawGuestBaseUrl = (process.env.EXPO_PUBLIC_GUEST_BASE_URL || '').trim();
const guestBaseUrl = rawGuestBaseUrl
  ? rawGuestBaseUrl.replace(/\/?$/, '/')
  : 'https://fun-code-q.github.io/Doorbell/';

export const CONFIG = {
  // Set your Supabase credentials here (or use EAS env secrets at build time)
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || 'REPLACE_WITH_YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'REPLACE_WITH_YOUR_ANON_KEY',
  GUEST_BASE_URL: guestBaseUrl,

  APP_VERSION: '1.0.0',
  DEFAULT_LANGUAGE: 'en',

  // Rate limiting
  RATE_LIMIT_WINDOW: 60000,
  RATE_LIMIT_MAX: 3,

  // Session timeout (milliseconds)
  INACTIVITY_TIMEOUT: 900000,       // 15 minutes
  SESSION_TIMEOUT_WARNING: 60000,   // 1 minute warning

  // Image config
  IMAGE_MAX_WIDTH: 1200,
  IMAGE_MAX_HEIGHT: 1200,
  IMAGE_QUALITY: 0.8,

  // Feature flags
  FEATURE_FLAGS: {
    pushNotifications: true,
    gpsLocation: false,
    analytics: true,
    auditLog: true,
    darkMode: false, // handled natively
    enableImages: true,
  },

  hasSupabaseConfig(): boolean {
    const url = (CONFIG.SUPABASE_URL || '').trim();
    const key = (CONFIG.SUPABASE_ANON_KEY || '').trim();
    const urlValid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
    const keyLooksLikeJwt = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(key);
    const keyLooksLikePublishable = /^sb_(publishable|anon|public)_[A-Za-z0-9._-]+$/i.test(key);
    const usingPlaceholders =
      url.includes('REPLACE_WITH') || key.includes('REPLACE_WITH');
    return urlValid && (keyLooksLikeJwt || keyLooksLikePublishable) && !usingPlaceholders;
  },
};
