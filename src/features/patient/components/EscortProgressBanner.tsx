import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../../../components/ui';

interface Props {
  currentStep: number;
  roomName: string;
  roomCode: string;
  onCancelEscort: () => void;
}

export function EscortProgressBanner({
  currentStep,
  roomName,
  roomCode,
  onCancelEscort,
}: Props) {
  const steps = ['Sảnh', 'Hành lang', 'Chuyên khoa', 'Cửa phòng'];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.pulseDot} />
        <AppText style={styles.statusTitle}>ROBOT ĐANG DẪN ĐƯỜNG</AppText>
        <AppText style={styles.stepBadge}>Chặng {currentStep}/4</AppText>
      </View>

      <AppText style={styles.targetName}>
        Đích đến: {roomName} ({roomCode})
      </AppText>
      <AppText style={styles.guideNote}>
        Vui lòng bước theo sau robot với tốc độ vừa phải. Robot sẽ tự dừng nếu bạn tụt lại.
      </AppText>

      {/* Stepper Dots */}
      <View style={styles.stepperRow}>
        {steps.map((step, idx) => (
          <View key={step} style={styles.stepItem}>
            <View
              style={[
                styles.stepCircle,
                idx + 1 <= currentStep ? styles.stepCircleActive : styles.stepCircleInactive,
              ]}
            >
              <Ionicons
                name={idx + 1 < currentStep ? 'checkmark' : 'navigate'}
                size={12}
                color="#FFFFFF"
              />
            </View>
            <AppText style={styles.stepLabel}>{step}</AppText>
          </View>
        ))}
      </View>

      {/* Nút Dừng dẫn đường */}
      <Pressable
        accessibilityRole="button"
        onPress={onCancelEscort}
        style={styles.btnStop}
      >
        <Ionicons name="stop-circle-outline" size={20} color="#DC2626" />
        <AppText style={styles.btnStopText}>Dừng dẫn đường / Quay lại</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  statusTitle: {
    flex: 1,
    marginLeft: 8,
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stepBadge: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  targetName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  guideNote: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  stepItem: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#0284C7',
  },
  stepCircleInactive: {
    backgroundColor: '#334155',
  },
  stepLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  btnStop: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  btnStopText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '800',
  },
});
