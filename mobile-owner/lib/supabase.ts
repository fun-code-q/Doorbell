// QR Vault — Supabase Client
// Configured with AsyncStorage as the session storage adapter
// This is REQUIRED for React Native — the default localStorage adapter won't work

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from './config';

export const SUPABASE_CONFIG_MISSING = !CONFIG.hasSupabaseConfig();

// Prevent hard crashes at startup when env vars are missing in cloud builds.
// We still surface a clear UI error in RootLayout.
const safeSupabaseUrl = SUPABASE_CONFIG_MISSING
  ? 'https://placeholder.supabase.co'
  : CONFIG.SUPABASE_URL;
const safeSupabaseAnonKey = SUPABASE_CONFIG_MISSING
  ? 'sb_publishable_placeholder'
  : CONFIG.SUPABASE_ANON_KEY;

export const supabase = createClient(safeSupabaseUrl, safeSupabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Must be false for React Native
  },
});
