import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../../../components/ui';

interface Props {
  onPressVoice: () => void;
  onPressSos: () => void;
  isSendingVoice?: boolean;
  isTriggeringSos?: boolean;
}

export function VoiceSosActionRow({
  onPressVoice,
  onPressSos,
  isSendingVoice = false,
  isTriggeringSos = false,
}: Props) {
  return (
    <View style={styles.actionRow}>
      {/* Nút 1: Trợ lý Giọng nói (Voice) */}
      <Pressable
        accessibilityRole="button"
        onPress={onPressVoice}
        style={({ pressed }) => [
          styles.voiceButton,
          pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
        ]}
      >
        <View style={styles.voiceIconCircle}>
          {isSendingVoice ? (
            <ActivityIndicator size="small" color="#059669" />
          ) : (
            <Ionicons name="mic" size={22} color="#059669" />
          )}
        </View>
        <View style={styles.actionTextWrap}>
          <AppText style={styles.actionMainTitle}>Hỏi Trợ lý</AppText>
          <AppText style={styles.actionSubTitle}>Nói để tìm đường</AppText>
        </View>
      </Pressable>

      {/* Nút 2: Cấp cứu Khẩn cấp (SOS) */}
      <Pressable
        accessibilityRole="button"
        onPress={onPressSos}
        disabled={isTriggeringSos}
        style={({ pressed }) => [
          styles.sosButton,
          pressed && { backgroundColor: '#B91C1C', transform: [{ scale: 0.98 }] },
        ]}
      >
        <View style={styles.sosIconCircle}>
          {isTriggeringSos ? (
            <ActivityIndicator size="small" color="#DC2626" />
          ) : (
            <Ionicons name="megaphone" size={22} color="#DC2626" />
          )}
        </View>
        <View style={styles.actionTextWrap}>
          <AppText style={styles.sosMainTitle}>CẤP CỨU SOS</AppText>
          <AppText style={styles.sosSubTitle}>Gọi Điều dưỡng ngay</AppText>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  voiceButton: {
    flex: 1,
    backgroundColor: '#047857',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#047857',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  voiceIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  sosIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextWrap: {
    flex: 1,
  },
  actionMainTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  actionSubTitle: {
    color: '#D1FAE5',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  sosMainTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  sosSubTitle: {
    color: '#FEE2E2',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
});
