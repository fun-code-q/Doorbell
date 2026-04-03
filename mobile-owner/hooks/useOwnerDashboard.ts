// QR Vault — Owner Dashboard Hook
// Ports app.js business logic — ALL Supabase queries, state, and filtering unchanged
// Only the DOM/browser APIs are replaced with React Native equivalents

import { useState, useCallback, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useAudioPlayer } from 'expo-audio';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { Storage } from '../lib/storage';
import { translate } from './useI18n';
import { decryptText } from '../lib/crypto';
import { getStoredPassphrase } from './useAuth';

// -----------------------------------------------------------------------
// Types (mirrors the DB schema)
// -----------------------------------------------------------------------
export interface Ring {
  id: string;
  house_id: string;
  door_location: string;
  guest_message: string | null;
  guest_message_encrypted: boolean;
  owner_reply: string | null;
  status: string;
  created_at: string;
  replied_at: string | null;
}

export interface DoorPoint {
  id: string;
  house_id: string;
  name: string;
  description: string | null;
  qr_token: string;
  is_active: boolean;
}

export interface AuditEntry {
  id: string;
  house_id: string;
  action: string;
  table_name: string;
  created_at: string;
}

export interface House {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  owner_user_id: string;
}

export interface DoorPointMember {
  id: string;
  door_point_id: string;
  user_id: string;
  is_muted: boolean;
  profile?: Profile;
}

export interface Profile {
  id: string;
  username: string;
}

export interface OwnerSettings {
  id?: string;
  user_id: string;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  push_enabled: boolean;
  language: string;
  auto_logout_minutes: number;
  active_house_id?: string | null;
}

export interface Stats {
  today: number;
  pending: number;
  avgResponse: string;
  total: number;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------
export function useOwnerDashboard() {
  const [rings, setRings] = useState<Ring[]>([]);
  const [doorPoints, setDoorPoints] = useState<DoorPoint[]>([]);
  const [doorPointMembers, setDoorPointMembers] = useState<Record<string, DoorPointMember[]>>({});
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [settings, setSettings] = useState<OwnerSettings | null>(null);
  const [currentHouseId, setCurrentHouseId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [floodWarning, setFloodWarning] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<'all' | 'waiting' | 'responded'>('all');
  const [currentDoorFilter, setCurrentDoorFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // SDK 54 Audio Player
  const ringPlayer = useAudioPlayer('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

  const ringChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ringTimestamps = useRef<number[]>([]);
  const PAGE_SIZE = 10;
  const FLOOD_THRESHOLD = 5;
  const FLOOD_WINDOW = 60000;

  // -----------------------------------------------------------------------
  // House management (unchanged logic from app.js)
  // -----------------------------------------------------------------------
  const loadHouses = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await supabase
        .from('houses')
        .select('id,name,is_active,created_at,owner_user_id')
        .order('created_at', { ascending: true });
      if (result.error) throw result.error;
      const data = result.data || [];
      setHouses(data);
      return data;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const ensureHouseContext = useCallback(
    async (houseList?: House[]) => {
      const ensureResult = await supabase.rpc('ensure_owner_house');
      if (ensureResult.error) throw ensureResult.error;
      const loaded = houseList || (await loadHouses());
      if (!loaded.length) throw new Error('No houses available for this account');
      const saved = await Storage.get<string>('active_house_id');
      const exists = loaded.some((h) => h.id === saved);
      const houseId = exists ? saved! : loaded[0].id;
      setCurrentHouseId(houseId);
      await Storage.set('active_house_id', houseId);
      return houseId;
    },
    [loadHouses]
  );

  const changeHouse = useCallback(
    async (houseId: string) => {
      if (!houseId || houseId === currentHouseId) return;
      setCurrentHouseId(houseId);
      await Storage.set('active_house_id', houseId);
    },
    [currentHouseId]
  );

  const createHouse = useCallback(
    async (name: string) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return;
      const result = await supabase.rpc('create_house', { p_name: trimmed });
      if (result.error) throw result.error;
      const loaded = await loadHouses();
      let created: House | null = null;
      if (Array.isArray(result.data)) created = result.data[0] || null;
      else created = result.data || null;
      const newId = created?.id || loaded[0]?.id;
      setCurrentHouseId(newId);
      await Storage.set('active_house_id', newId);
      return newId;
    },
    [loadHouses]
  );

  const addHouseMember = useCallback(
    async (email: string, role: string) => {
      if (!currentHouseId) {
        Alert.alert('Warning', translate('error_occurred'));
        return;
      }
      const cleanEmail = (email || '').trim();
      const cleanRole = (role || 'manager').trim().toLowerCase();
      if (!cleanEmail) return;
      const result = await supabase.rpc('add_house_member_by_email', {
        p_house_id: currentHouseId,
        p_email: cleanEmail,
        p_role: cleanRole,
      });
      if (result.error) throw result.error;
    },
    [currentHouseId]
  );

  // -----------------------------------------------------------------------
  // Door Member Management
  // -----------------------------------------------------------------------
  const loadDoorMembers = useCallback(
    async (doorPointId: string) => {
      const membersResult = await supabase
        .from('door_point_members')
        .select('id, door_point_id, user_id, is_muted')
        .eq('door_point_id', doorPointId);

      if (membersResult.error) throw membersResult.error;
      const members = (membersResult.data || []) as DoorPointMember[];

      const userIds = Array.from(new Set(members.map((m) => m.user_id).filter(Boolean)));
      let profileMap: Record<string, Profile> = {};

      if (userIds.length) {
        const profilesResult = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', userIds);
        if (!profilesResult.error && profilesResult.data) {
          profileMap = profilesResult.data.reduce<Record<string, Profile>>((acc, p) => {
            acc[p.id] = p as Profile;
            return acc;
          }, {});
        }
      }

      const merged = members.map((member) => ({
        ...member,
        profile: profileMap[member.user_id],
      }));

      setDoorPointMembers((prev) => ({
        ...prev,
        [doorPointId]: merged,
      }));

      return merged;
    },
    []
  );

  const addDoorMember = useCallback(
    async (doorId: string, username: string) => {
      const cleanUsername = username.trim();
      if (!cleanUsername) throw new Error('Username required');

      const result = await supabase.rpc('add_door_member_by_username', {
        p_door_point_id: doorId,
        p_username: cleanUsername,
      });

      if (result.error) {
        const msg = (result.error.message || '').toLowerCase();
        if (msg.includes('user not found')) throw new Error('User not found');
        throw result.error;
      }

      await loadDoorMembers(doorId);
    },
    [loadDoorMembers]
  );

  const removeDoorMember = useCallback(async (doorId: string, userId: string) => {
    const result = await supabase
      .from('door_point_members')
      .delete()
      .eq('door_point_id', doorId)
      .eq('user_id', userId);
    
    if (result.error) throw result.error;
    await loadDoorMembers(doorId);
  }, [loadDoorMembers]);

  const muteDoorMember = useCallback(async (doorId: string, isMuted: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const result = await supabase
      .from('door_point_members')
      .update({ is_muted: isMuted })
      .eq('door_point_id', doorId)
      .eq('user_id', user.id);
    
    if (result.error) throw result.error;
    await loadDoorMembers(doorId);
  }, [loadDoorMembers]);

  // -----------------------------------------------------------------------
  // Rings (unchanged Supabase queries from app.js)
  // -----------------------------------------------------------------------
  const loadRings = useCallback(
    async (houseId?: string) => {
      const hId = houseId || currentHouseId;
      if (!hId) return;

      // Filter by hId to ensure consistency with the current house and RLS policies
      const result = await supabase
        .from('doorbell_rings')
        .select('*')
        .eq('house_id', hId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (result.error) {
        console.error('Error fetching rings:', result.error.message, result.error.details);
        return;
      }
      const data: Ring[] = result.data || [];
      setRings(data);
      const unread = data.filter((r) => !r.owner_reply || r.owner_reply === '').length;
      setUnreadCount(unread);
      return data;
    },
    [currentHouseId]
  );

  const loadMoreRings = useCallback(
    async (currentRings: Ring[]) => {
      if (!currentHouseId) return;
      const offset = currentRings.length;
      const result = await supabase
        .from('doorbell_rings')
        .select('*')
        .eq('house_id', currentHouseId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw result.error;
      if (result.data?.length) {
        setRings((prev) => [...prev, ...result.data]);
      }
    },
    [currentHouseId]
  );

  const sendReply = useCallback(
    async (ringId: string, message: string, houseId?: string) => {
      const hId = houseId || currentHouseId;
      try {
        const result = await supabase
          .from('doorbell_rings')
          .update({ owner_reply: message, status: 'responded', replied_at: new Date().toISOString() })
          .eq('id', ringId)
          .eq('house_id', hId);
        if (result.error) throw result.error;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await loadRings(hId || undefined);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
    [currentHouseId, loadRings]
  );

  const promptCustomReply = useCallback(
    (ringId: string, houseId?: string) => {
      Alert.prompt(
        translate('secure_reply'),
        translate('custom_reply'),
        [
          { text: translate('cancel' as never) || 'Cancel', style: 'cancel' },
          {
            text: translate('send' as never) || 'Send',
            onPress: (msg?: string) => {
              if (msg && msg.trim()) sendReply(ringId, msg.trim(), houseId);
            },
          },
        ],
        'plain-text'
      );
    },
    [sendReply]
  );

  const deleteRing = useCallback(
    async (ringId: string, houseId?: string) => {
      const hId = houseId || currentHouseId;
      return new Promise<void>((resolve) =>
        Alert.alert('Delete Ring', 'Are you sure you want to permanently delete this ring log?', [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const result = await supabase
                  .from('doorbell_rings')
                  .delete()
                  .eq('id', ringId)
                  .eq('house_id', hId);
                if (result.error) throw result.error;
                await loadRings(hId || undefined);
              } catch {}
              resolve();
            },
          },
        ])
      );
    },
    [currentHouseId, loadRings]
  );

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
    setRings((prev) => prev.map((r) => r));
  }, []);

  // -----------------------------------------------------------------------
  // Message decryption
  // -----------------------------------------------------------------------
  const decryptMessage = useCallback(async (encryptedText: string): Promise<string> => {
    const passphrase = await getStoredPassphrase();
    if (!passphrase) throw new Error('No passphrase stored');
    return decryptText(encryptedText, passphrase);
  }, []);

  // -----------------------------------------------------------------------
  // Computed stats (unchanged from app.js)
  // -----------------------------------------------------------------------
  const computeStats = useCallback((data: Ring[]): Stats => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();
    const todayRings = data.filter((r) => r.created_at >= todayStr);
    const pendingRings = data.filter((r) => !r.owner_reply || r.owner_reply === '');
    const repliedRings = data.filter((r) => r.replied_at && r.created_at);
    let avgResponse = '-';
    if (repliedRings.length > 0) {
      let totalMs = 0;
      repliedRings.forEach((r) => {
        totalMs += new Date(r.replied_at!).getTime() - new Date(r.created_at).getTime();
      });
      const avgMins = Math.round(totalMs / repliedRings.length / 60000);
      avgResponse = avgMins < 1 ? '<1m' : `${avgMins}m`;
    }
    return {
      today: todayRings.length,
      pending: pendingRings.length,
      avgResponse,
      total: data.length,
    };
  }, []);

  // -----------------------------------------------------------------------
  // Filtered rings (unchanged logic from app.js renderRings)
  // -----------------------------------------------------------------------
  const getFilteredRings = useCallback(
    (data: Ring[]) => {
      let filtered = [...data];
      if (currentFilter !== 'all') {
        filtered = filtered.filter((r) => {
          if (currentFilter === 'waiting') return !r.owner_reply || r.owner_reply === '';
          if (currentFilter === 'responded') return !!(r.owner_reply && r.owner_reply !== '');
          return true;
        });
      }
      if (currentDoorFilter !== 'all') {
        filtered = filtered.filter((r) => r.door_location === currentDoorFilter);
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            (r.door_location || '').toLowerCase().includes(q) ||
            (r.guest_message || '').toLowerCase().includes(q)
        );
      }
      return filtered;
    },
    [currentFilter, currentDoorFilter, searchQuery]
  );

  // -----------------------------------------------------------------------
  // Flood detection (unchanged from app.js)
  // -----------------------------------------------------------------------
  const detectFlood = useCallback(() => {
    const now = Date.now();
    ringTimestamps.current.push(now);
    const cutoff = now - FLOOD_WINDOW;
    ringTimestamps.current = ringTimestamps.current.filter((ts) => ts > cutoff);
    setFloodWarning(ringTimestamps.current.length >= FLOOD_THRESHOLD);
  }, []);

  // -----------------------------------------------------------------------
  // Realtime subscription (unchanged from app.js)
  // -----------------------------------------------------------------------
  const setupRealtimeSubscription = useCallback(
    (houseId: string, onNewRing: (ring: Ring) => void) => {
      if (ringChannel.current) supabase.removeChannel(ringChannel.current);
      ringChannel.current = supabase
        .channel('doorbell_rings_realtime_' + houseId)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'doorbell_rings',
            filter: 'house_id=eq.' + houseId,
          },
          (payload) => {
            const newRing = payload.new as Ring;
            // Immediate UI update for the active house
            setRings((prev) => [newRing, ...prev].slice(0, 50));
            setUnreadCount((c) => c + 1);
            detectFlood();
            onNewRing(newRing);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            playNotificationSound();
            scheduleLocalNotification(newRing);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'doorbell_rings',
            filter: 'house_id=eq.' + houseId,
          },
          () => loadRings(houseId)
        )
        .subscribe();
    },
    [detectFlood, loadRings]
  );

  const teardownRealtime = useCallback(() => {
    if (ringChannel.current) {
      supabase.removeChannel(ringChannel.current);
      ringChannel.current = null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Notification sound (replaces deprecated expo-av)
  // -----------------------------------------------------------------------
  const playNotificationSound = useCallback(async () => {
    try {
      if (ringPlayer) {
        ringPlayer.seekTo(0);
        ringPlayer.play();
      }
    } catch {}
  }, [ringPlayer]);

  // -----------------------------------------------------------------------
  // Local push notification (replaces window.Notification)
  // -----------------------------------------------------------------------
  const scheduleLocalNotification = useCallback(async (ring: Ring) => {
    // Avoid push/local notification calls in Expo Go on Android as it's unsupported in SDK 54
    if (Constants.appOwnership === 'expo' && Platform.OS === 'android') {
      return;
    }
    
    try {
      const Notifications = await import('expo-notifications');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'QR Doorbell: ' + (ring.door_location || 'New Ring'),
          body: ring.guest_message_encrypted
            ? 'Visitor left an encrypted message'
            : ring.guest_message || 'Someone is at the door',
          sound: true,
        },
        trigger: null,
      });
    } catch {}
  }, []);

  // -----------------------------------------------------------------------
  // Door Points (unchanged Supabase queries from app.js)
  // -----------------------------------------------------------------------
  const loadDoorPoints = useCallback(
    async (houseId?: string) => {
      const hId = houseId || currentHouseId;
      if (!hId) return [];
      
      const result = await supabase
        .from('door_points')
        .select('*')
        .eq('house_id', hId)
        .order('name', { ascending: true });
        
      if (result.error) throw result.error;
      const data: DoorPoint[] = result.data || [];
      setDoorPoints(data);
      return data;
    },
    [currentHouseId]
  );

  const addDoorPoint = useCallback(
    async (name: string, description: string, houseId?: string) => {
      const hId = houseId || currentHouseId;
      if (!hId) throw new Error('No active house selected');
      const cleanName = (name || '').trim();
      if (!cleanName) throw new Error('Door name is required');
      const result = await supabase
        .from('door_points')
        .insert([{ house_id: hId, name: cleanName, description: description.trim() || null }])
        .select()
        .single();
      if (result.error) throw result.error;
      await loadDoorPoints(hId);
      return result.data as DoorPoint;
    },
    [currentHouseId, loadDoorPoints]
  );

  const setDoorPointActive = useCallback(
    async (id: string, isActive: boolean, houseId?: string) => {
      const hId = houseId || currentHouseId;
      const result = await supabase
        .from('door_points')
        .update({ is_active: !!isActive })
        .eq('id', id)
        .eq('house_id', hId);
      if (result.error) throw result.error;
      await loadDoorPoints(hId || undefined);
    },
    [currentHouseId, loadDoorPoints]
  );

  const deleteDoorPoint = useCallback(
    async (id: string, houseId?: string) => {
      return new Promise<void>((resolve) =>
        Alert.alert('Delete Location', 'Are you sure you want to delete this location?', [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const hId = houseId || currentHouseId;
              const result = await supabase
                .from('door_points')
                .delete()
                .eq('id', id)
                .eq('house_id', hId);
              if (result.error) console.error(result.error);
              await loadDoorPoints(hId || undefined);
              resolve();
            },
          },
        ])
      );
    },
    [currentHouseId, loadDoorPoints]
  );

  const editDoorPoint = useCallback(
    (dp: DoorPoint, houseId?: string) => {
      Alert.prompt(
        translate('edit'),
        translate('door_name'),
        [
          { text: translate('cancel' as never) || 'Cancel', style: 'cancel' },
          {
            text: translate('save'),
            onPress: async (newName?: string) => {
              if (!newName || !newName.trim() || newName.trim() === dp.name) return;
              const hId = houseId || currentHouseId;
              const result = await supabase
                .from('door_points')
                .update({ name: newName.trim() })
                .eq('id', dp.id)
                .eq('house_id', hId);
              if (!result.error) await loadDoorPoints(hId || undefined);
            },
          },
        ],
        'plain-text',
        dp.name
      );
    },
    [currentHouseId, loadDoorPoints]
  );

  const updateDoorPoint = useCallback(
    async (id: string, newName: string, newDescription?: string, houseId?: string) => {
      const hId = houseId || currentHouseId;
      if (!newName || !newName.trim()) return;
      const result = await supabase
        .from('door_points')
        .update({ name: newName.trim(), description: newDescription ? newDescription.trim() : null })
        .eq('id', id)
        .eq('house_id', hId);
      if (result.error) throw result.error;
      await loadDoorPoints(hId || undefined);
    },
    [currentHouseId, loadDoorPoints]
  );

  const getGuestUrl = useCallback((doorPoint: DoorPoint, baseUrl: string) => {
    return `${baseUrl}?t=${doorPoint.qr_token}`;
  }, []);

  const copyDoorLink = useCallback(
    async (doorPoint: DoorPoint, baseUrl: string) => {
      const url = getGuestUrl(doorPoint, baseUrl);
      await Clipboard.setStringAsync(url);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [getGuestUrl]
  );

  // -----------------------------------------------------------------------
  // Settings (unchanged Supabase queries from app.js)
  // -----------------------------------------------------------------------
  const loadSettings = useCallback(
    async (userId: string, houseId?: string) => {
      // Ensure profile exists for username search (bootstrap with a default username if missing)
      const { data: prof } = await supabase.from('profiles').select('id').eq('id', userId).single();
      if (!prof) {
        await supabase.from('profiles').upsert(
          { id: userId, username: `user_${userId.split('-')[0]}` },
          { onConflict: 'id' }
        );
      }

      const result = await supabase
        .from('owner_settings')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (result.error && result.error.code !== 'PGRST116') throw result.error;
      const s: OwnerSettings = result.data || {
        user_id: userId,
        sound_enabled: true,
        vibration_enabled: true,
        push_enabled: true,
        language: 'en',
        auto_logout_minutes: 15,
        active_house_id: houseId || currentHouseId,
      };
      setSettings(s);
      await Storage.set('auto_logout_minutes', s.auto_logout_minutes || 15);
      return s;
    },
    [currentHouseId]
  );

  const saveSettings = useCallback(
    async (userId: string, newSettings: Partial<OwnerSettings>, houseId?: string) => {
      const hId = houseId || currentHouseId;
      const settingsData: OwnerSettings = {
        user_id: userId,
        sound_enabled: newSettings.sound_enabled ?? true,
        vibration_enabled: newSettings.vibration_enabled ?? true,
        push_enabled: newSettings.push_enabled ?? true,
        language: newSettings.language ?? 'en',
        auto_logout_minutes: newSettings.auto_logout_minutes ?? 15,
        active_house_id: hId,
      };
      const { error } = await supabase
        .from('owner_settings')
        .upsert([settingsData], { onConflict: 'user_id' });
      if (error) throw error;
      await Storage.set('auto_logout_minutes', settingsData.auto_logout_minutes);
      await loadSettings(userId, hId || undefined);
    },
    [currentHouseId, loadSettings]
  );

  // -----------------------------------------------------------------------
  // Audit Log (unchanged from app.js)
  // -----------------------------------------------------------------------
  const loadAuditLog = useCallback(
    async (houseId?: string) => {
      const hId = houseId || currentHouseId;
      if (!hId) return;
      const result = await supabase
        .from('audit_log')
        .select('*')
        .eq('house_id', hId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (result.error) {
        console.warn('Audit log load error:', result.error);
        return;
      }
      setAuditEntries(result.data || []);
    },
    [currentHouseId]
  );

  const clearAuditLog = useCallback(
    async (houseId?: string) => {
      const hId = houseId || currentHouseId;
      if (!hId) return;
      return new Promise<void>((resolve) => {
        Alert.alert('Clear Audits', 'Are you sure you want to delete all audit logs?', [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Clear',
            style: 'destructive',
            onPress: async () => {
              await supabase.from('audit_log').delete().eq('house_id', hId);
              setAuditEntries([]);
              resolve();
            }
          }
        ]);
      });
    },
    [currentHouseId]
  );

  // -----------------------------------------------------------------------
  // Full dashboard load (mirrors app.js loadDashboard)
  // -----------------------------------------------------------------------
  const loadDashboard = useCallback(
    async (userId: string) => {
      if (isLoading) return;
      setIsLoading(true);
      try {
        const houseList = await loadHouses();
        const houseId = await ensureHouseContext(houseList);
        await Promise.all([
          loadRings(houseId),
          loadDoorPoints(houseId),
          loadSettings(userId, houseId),
          loadAuditLog(houseId),
        ]);
      } catch (err) {
        console.error('Dashboard load error:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, loadHouses, ensureHouseContext, loadRings, loadDoorPoints, loadSettings, loadAuditLog]
  );

  // -----------------------------------------------------------------------
  // Helper: get unique doors from rings for filter dropdown
  // -----------------------------------------------------------------------
  const getUniqueDoors = useCallback((data: Ring[]) => {
    const doors: Record<string, boolean> = {};
    data.forEach((r) => { if (r.door_location) doors[r.door_location] = true; });
    return Object.keys(doors).sort();
  }, []);

  return {
    // State
    rings,
    doorPoints,
    auditEntries,
    houses,
    settings,
    currentHouseId,
    isLoading,
    unreadCount,
    floodWarning,
    currentFilter,
    currentDoorFilter,
    searchQuery,

    // Setters
    setCurrentFilter,
    setCurrentDoorFilter,
    setSearchQuery,

    // Actions
    loadDashboard,
    loadRings,
    loadMoreRings,
    loadDoorPoints,
    loadAuditLog,
    clearAuditLog,
    loadSettings,
    saveSettings,
    sendReply,
    promptCustomReply,
    deleteRing,
    markAllRead,
    decryptMessage,
    changeHouse,
    createHouse,
    addHouseMember,
    loadDoorMembers,
    addDoorMember,
    removeDoorMember,
    muteDoorMember,
    addDoorPoint,
    setDoorPointActive,
    deleteDoorPoint,
    editDoorPoint,
    updateDoorPoint,
    getGuestUrl,
    copyDoorLink,
    computeStats,
    getFilteredRings,
    getUniqueDoors,
    setupRealtimeSubscription,
    teardownRealtime,
    playNotificationSound,
    doorPointMembers,
  };
}
