import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../ui';
import {
  NavigationGuidanceResult,
  guidanceSymbol,
} from '../../features/navigation/navigationGuidance';

interface NavigationGuidanceBannerProps {
  guidance: NavigationGuidanceResult | null;
  onStop?: () => void;
  isStopping?: boolean;
}

export function NavigationGuidanceBanner({
  guidance,
  onStop,
  isStopping = false,
}: NavigationGuidanceBannerProps) {
  if (!guidance || guidance.state === 'IDLE') {
    return null;
  }

  const symbol =
    guidance.state === 'ARRIVED'
      ? '✓'
      : guidanceSymbol(guidance.direction);

  const isTracking = guidance.state === 'TRACKING';
  const isArrived = guidance.state === 'ARRIVED';
  const isWaitingPose = guidance.state === 'WAITING_FOR_POSE';

  return (
    <View style={styles.container}>
      {/* Icon rẽ nổi bật bên trái */}
      <View
        style={[
          styles.iconBox,
          isArrived && styles.iconBoxArrived,
          isWaitingPose && styles.iconBoxWaiting,
        ]}
      >
        {isWaitingPose ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <AppText style={styles.iconSymbol}>{symbol}</AppText>
        )}
      </View>

      {/* Cột thông tin chỉ dẫn chính & phụ */}
      <View style={styles.textColumn}>
        <AppText style={styles.primaryText} numberOfLines={1}>
          {guidance.primaryText}
        </AppText>
        <View style={styles.secondaryRow}>
          <AppText style={styles.secondaryText} numberOfLines={1}>
            {guidance.secondaryText}
          </AppText>
          {isTracking && typeof guidance.etaSeconds === 'number' && guidance.etaSeconds > 0 && (
            <AppText style={styles.etaText}>
              · Khoảng {guidance.etaSeconds} giây nữa tới chỗ rẽ
            </AppText>
          )}
        </View>
      </View>

      {/* Nút Dừng dẫn đường */}
      {onStop && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dừng dẫn đường"
          onPress={onStop}
          disabled={isStopping}
          style={({ pressed }) => [
            styles.stopButton,
            pressed && styles.stopButtonPressed,
          ]}
        >
          {isStopping ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="stop-circle" size={16} color="#FFFFFF" />
              <AppText style={styles.stopButtonText}>Dừng</AppText>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#202022',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#2D2D31',
    gap: 14,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  iconBoxArrived: {
    backgroundColor: '#166534',
    borderColor: '#24A148',
  },
  iconBoxWaiting: {
    backgroundColor: 'rgba(217, 119, 6, 0.25)',
    borderColor: '#D97706',
  },
  iconSymbol: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
    textAlign: 'center',
  },
  textColumn: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  secondaryText: {
    color: '#D0D0D5',
    fontSize: 13,
    fontWeight: '500',
  },
  etaText: {
    color: '#A0A0A8',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#C62828',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    minHeight: 44,
  },
  stopButtonPressed: {
    backgroundColor: '#991B1B',
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
