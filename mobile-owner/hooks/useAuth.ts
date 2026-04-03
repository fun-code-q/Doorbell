// QR Vault — Auth Hook
// Ports auth.js from web: signIn, signUp, signOut, inactivity timer
// Replaced: localStorage → AsyncStorage, window.location → router, DOM events → AppState

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../lib/config';
import { Storage } from '../lib/storage';
import { translate } from './useI18n';
import type { Session, User } from '@supabase/supabase-js';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------
export interface AuthState {
  session: Session | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  getAccessToken: () => string | null;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------
export function useAuth(): AuthState & AuthActions {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Inactivity logout disabled per user request
  const resetInactivityTimer = useCallback(async () => {
    // No-op: Auto-logout is disabled
  }, []);

  // Listen for Supabase auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (event === 'SIGNED_IN' && sess) {
        // Store minimal session info
        Storage.set('auth_session', {
          user_id: sess.user.id,
          email: sess.user.email,
        });
      } else if (event === 'SIGNED_OUT') {
        Storage.remove('auth_session');
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
        setSession(data.session);
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: (err as Error).message };
      }
    },
    []
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: (err as Error).message };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  }, []);

  const getAccessToken = useCallback(() => {
    return session?.access_token ?? null;
  }, [session]);

  return {
    session,
    user: session?.user ?? null,
    isAuthenticated: !!session,
    isLoading,
    signIn,
    signUp,
    signOut,
    getAccessToken,
  };
}
