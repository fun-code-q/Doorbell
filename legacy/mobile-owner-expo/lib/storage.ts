// QR Vault — AsyncStorage Wrapper
// Replaces Utils.storage (localStorage) from the web app

import AsyncStorage from '@react-native-async-storage/async-storage';

export const Storage = {
  async get<T>(key: string, fallback?: T): Promise<T | null> {
    try {
      const val = await AsyncStorage.getItem(key);
      if (val !== null) return JSON.parse(val) as T;
      return fallback !== undefined ? fallback : null;
    } catch {
      return fallback !== undefined ? fallback : null;
    }
  },

  async set(key: string, value: unknown): Promise<boolean> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },
};
