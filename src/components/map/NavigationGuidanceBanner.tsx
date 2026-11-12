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
    top: 10,
    left: 12,
    right: 12,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#075DC4',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  iconBoxArrived: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  iconBoxWaiting: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    borderColor: '#F59E0B',
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
    gap: 2,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  secondaryText: {
    color: '#BFDBFE',
    fontSize: 12,
    fontWeight: '600',
  },
  etaText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 4,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DC2626',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  stopButtonPressed: {
    backgroundColor: '#B91C1C',
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
