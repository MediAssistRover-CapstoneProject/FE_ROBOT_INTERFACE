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
    <View
      style={[
        styles.container,
        isArrived && styles.containerArrived,
      ]}
    >
      {/* Icon rẽ nổi bật bên trái chuẩn map-navigation.css (#navGuidanceIcon) */}
      <View style={styles.iconWrap}>
        {isWaitingPose ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <AppText style={styles.iconSymbol}>{symbol}</AppText>
        )}
      </View>

      {/* Cột thông tin chỉ dẫn chính & phụ chuẩn map-navigation.js */}
      <View style={styles.textColumn}>
        <AppText style={styles.primaryText} numberOfLines={1}>
          {guidance.primaryText}
        </AppText>
        <View style={styles.secondaryRow}>
          <AppText style={styles.secondaryText} numberOfLines={1}>
            {guidance.secondaryText}
          </AppText>
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0757A6',
    borderRadius: 10,
    marginHorizontal: 8,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 9,
    paddingHorizontal: 14,
    shadowColor: '#102C49',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
    gap: 12,
  },
  containerArrived: {
    backgroundColor: '#157347',
  },
  iconWrap: {
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSymbol: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  textColumn: {
    flex: 1,
    justifyContent: 'center',
    gap: 1,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
  },
  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  secondaryText: {
    color: '#DEEDFF',
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 16,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  stopButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
});
