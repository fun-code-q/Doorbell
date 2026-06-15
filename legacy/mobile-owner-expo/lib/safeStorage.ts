import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Safe Secure Storage utility that provides a fallback to localStorage on Web.
 */
export const SafeSecureStore = {
  /**
   * Gets a value from SecureStore on Native, or localStorage on Web.
   */
  getItemAsync: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      }
      return await SecureStore.getItemAsync(key);
    } catch (err) {
      console.warn('SafeSecureStore.getItemAsync failed:', err);
      return null;
    }
  },

  /**
   * Sets a value in SecureStore on Native, or localStorage on Web.
   */
  setItemAsync: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      console.error('SafeSecureStore.setItemAsync failed:', err);
    }
  },

  /**
   * Deletes a value from SecureStore on Native, or localStorage on Web.
   */
  deleteItemAsync: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
        return;
      }
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      console.error('SafeSecureStore.deleteItemAsync failed:', err);
    }
  },
};
