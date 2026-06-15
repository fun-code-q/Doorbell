import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Radii, Spacing, Typography } from '../constants/theme';

export interface Ring {
  id: string;
  house_id: string;
  door_location: string;
  guest_message: string | null;
  owner_reply: string | null;
  chat_history: { role: string; text: string; time: string }[] | null;
  status: string;
  created_at: string;
  replied_at: string | null;
}


interface RingCardProps {
  ring: Ring;
  onAck: (id: string) => void;
  onComing: (id: string) => void;
  onCustomReply: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenLocation: (locationName: string) => void;
  ackLabel: string;
  comingLabel: string;
  replyLabel: string;
  signalInbound: string;
  isUnread?: boolean;
}

function formatDateTime12h(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function RingCard({
  ring,
  onAck,
  onComing,
  onCustomReply,
  onDelete,
  onOpenLocation,
  ackLabel,
  comingLabel,
  replyLabel,
  signalInbound,
  isUnread,
}: RingCardProps) {
  const unresolved = !ring.owner_reply || ring.owner_reply === '';
  const unread = typeof isUnread === 'boolean' ? isUnread : unresolved;

  return (
    <View style={[styles.card, unread && styles.cardUnread]}>
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.locationTrigger}
            onPress={() => onOpenLocation((ring.door_location || 'Unknown').trim() || 'Unknown')}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="door-closed" size={14} color={Colors.accent} />
            <Text style={styles.doorText} numberOfLines={1}>
              {ring.door_location || 'Unknown'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerDeleteBtn} onPress={() => onDelete(ring.id)} activeOpacity={0.7}>
            <MaterialCommunityIcons name="trash-can-outline" size={16} color={Colors.error} />
          </TouchableOpacity>
        </View>
        <Text style={styles.time}>{formatDateTime12h(ring.created_at)}</Text>
      </View>

      {/* Guest message */}
      <View style={styles.messageArea}>
        {ring.guest_message ? (
          <View style={styles.messageBubble}>
            <View style={styles.messageHeader}>
              <MaterialCommunityIcons name="chat-outline" size={12} color={Colors.textMuted} />
              <Text style={styles.messageLabel}>
                Visitor Message
              </Text>
            </View>
            <Text style={styles.messageText}>{ring.guest_message}</Text>
          </View>
        ) : (
          <Text style={styles.noMessage}>Signal received (no message)</Text>
        )}
      </View>

      {/* Threaded Chat History (Modern Obsidian Bubbles) */}
      {ring.chat_history && ring.chat_history.length > 0 && (
        <View style={styles.historyArea}>
          {ring.chat_history.map((msg, idx) => (
            <View 
              key={idx} 
              style={[
                styles.miniBubble, 
                msg.role === 'guest' ? styles.guestBubble : styles.ownerBubble
              ]}
            >
              <Text style={styles.bubbleText}>{msg.text}</Text>
              {msg.time && (
                <Text style={styles.bubbleTime}>
                  {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Reply or action buttons (Always available for active threads) */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btnSecondary} onPress={() => onAck(ring.id)}>
          <Text style={styles.btnSecondaryText}>{ackLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={() => onComing(ring.id)}>
          <Text style={styles.btnSecondaryText}>{comingLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnPrimary} onPress={() => onCustomReply(ring.id)}>
          <Text style={styles.btnPrimaryText}>{replyLabel}</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
    }),
    elevation: 3,
  },
  cardUnread: {
    borderColor: Colors.unreadBorder,
    backgroundColor: Colors.unread,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  locationTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accentLight,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  doorText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.accent,
    flexShrink: 1,
  },
  headerDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  time: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
    marginTop: 6,
    textAlign: 'right',
    flexShrink: 0,
  },
  messageArea: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  messageBubble: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: Radii.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  messageLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  noMessage: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  btnSecondary: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    flexGrow: 1,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontFamily: Typography.headingBold,
    fontSize: 10,
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  btnPrimary: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    flexGrow: 2,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: Typography.headingBold,
    fontSize: 10,
    color: Colors.textInverse,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  replyBox: {
    margin: Spacing.md,
    marginTop: 0,
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
    padding: Spacing.sm,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  replyLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeXs,
    color: Colors.success,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  replyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textPrimary,
  },
  historyArea: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: 8,
  },
  miniBubble: {
    padding: 10,
    borderRadius: 14,
    maxWidth: '85%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  guestBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderBottomLeftRadius: 4,
  },
  ownerBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontFamily: Typography.body,
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  bubbleTime: {
    fontFamily: Typography.body,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 4,
    opacity: 0.7,
  },
});

