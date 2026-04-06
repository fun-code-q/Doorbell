import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Vibration } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadows } from '../constants/theme';
import { useAudioPlayer } from 'expo-audio';

export default function IncomingRingScreen() {
  const params = useLocalSearchParams();
  const ringId = params.ring_id as string;
  const doorLocation = params.door_location as string || 'Guest at Door';
  
  const [pulseAnim] = useState(new Animated.Value(1));

  // Load a ringtone (using expo-audio)
  // Fallback to remote URI if local asset is missing to prevent build crashes
  const ringtoneSource = { uri: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3' };
  
  const player = useAudioPlayer(ringtoneSource);

  useEffect(() => {
    if (player) {
      player.loop = true;
      player.play();
    }

    // 1. Visual animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 2. Start continuous vibration (1s vibe, 1s rest)
    Vibration.vibrate([1000, 1000], true);

    // 3. Auto-dismiss after 15 seconds if not answered (User request)
    const timer = setTimeout(() => {
      declineRing();
    }, 15000);

    return () => {
      clearTimeout(timer);
      Vibration.cancel();
      player?.remove();
    };
  }, [player]);

  const answerRing = () => {
    Vibration.cancel();
    player?.pause();
    router.replace({
      pathname: '/(dashboard)',
      params: { incoming_ring_id: ringId }
    });
  };

  const declineRing = () => {
    Vibration.cancel();
    player?.pause();
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Animated.View style={[styles.ringIconContainer, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons name="notifications-outline" size={80} color={Colors.accent} />
        </Animated.View>
        <Text style={styles.title}>Incoming Ring</Text>
        <Text style={styles.subtitle}>{doorLocation}</Text>
      </View>

      <View style={styles.actionContainer}>
        <TouchableOpacity 
          style={[styles.actionBtn, styles.declineBtn]} 
          onPress={declineRing}
          activeOpacity={0.8}
        >
          <Ionicons name="close" size={40} color="#fff" />
          <Text style={styles.btnText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionBtn, styles.answerBtn]} 
          onPress={answerRing}
          activeOpacity={0.8}
        >
          <Ionicons name="checkmark" size={40} color="#fff" />
          <Text style={styles.btnText}>Answer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
    justifyContent: 'space-between',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
  },
  ringIconContainer: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSecondary,
    marginTop: 10,
    fontWeight: '600',
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  actionBtn: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.md,
  },
  declineBtn: {
    backgroundColor: '#ef4444',
  },
  answerBtn: {
    backgroundColor: Colors.success,
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 5,
  },
});
