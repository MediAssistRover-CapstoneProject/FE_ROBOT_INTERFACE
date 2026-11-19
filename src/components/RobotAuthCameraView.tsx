import React from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from './ui';
import { colors, radii, spacing } from '../theme';
import { getServerNowMs } from '../services/api/serverClock';
import {
  CameraPreviewState,
  evaluateCameraPreviewFreshness,
  getCameraFeedLabel,
} from '../features/logistics/cameraPreviewState';

interface RobotAuthCameraViewProps {
  mode: 'qr' | 'face';
  testID: string;
  preview: CameraPreviewState;
  title: string;
  remainingSec: number | null;
  elapsedSec?: number | null;
  statusText: string;
  feedbackMessage?: string | null;
  isOffline?: boolean;
  expired?: boolean;
}

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Both authentication methods display the robot camera; their callers own verification. */
export function RobotAuthCameraView({
  mode,
  testID,
  preview: receivedPreview,
  title,
  remainingSec,
  elapsedSec,
  statusText,
  feedbackMessage,
  isOffline = false,
  expired = false,
}: RobotAuthCameraViewProps) {
  const preview = evaluateCameraPreviewFreshness(receivedPreview, getServerNowMs());
  const isLive = !isOffline && !expired && preview.feedStatus === 'live' && Boolean(preview.dataUri);
  const disconnected = isOffline || preview.feedStatus === 'network_error';
  const feedLabel = expired ? 'Phiên quét đã hết hạn' : getCameraFeedLabel(preview.feedStatus, isOffline);
  const instruction = mode === 'qr'
    ? 'Đưa mã QR trên điện thoại vào khung camera'
    : 'Vui lòng nhìn vào camera trên thân robot';
  const placeholderTitle = expired
    ? 'Phiên xác thực đã hết hạn'
    : disconnected
      ? 'Đang kết nối lại camera robot'
      : preview.feedStatus === 'stale'
        ? 'Đang chờ khung hình mới'
        : 'Đang kết nối camera robot';
  const placeholderMessage = expired
    ? 'Vui lòng chờ hệ thống cập nhật trạng thái.'
    : disconnected
      ? 'Vui lòng chờ kết nối được khôi phục.'
      : preview.feedStatus === 'unavailable_endpoint'
        ? 'Chưa nhận được hình ảnh từ camera trên thân robot.'
        : instruction;

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.cameraFrame}>
        {isLive && preview.dataUri ? (
          <Image
            source={{ uri: preview.dataUri }}
            style={styles.cameraImage}
            resizeMode="contain"
            accessibilityLabel="Hình ảnh camera trên thân robot"
            testID={`${mode}-camera-preview`}
          />
        ) : (
          <View style={styles.placeholder}>
            {disconnected || expired ? (
              <Ionicons name={expired ? 'time-outline' : 'cloud-offline-outline'} size={52} color="#FCD34D" />
            ) : (
              <ActivityIndicator size="large" color="#38BDF8" />
            )}
            <AppText style={styles.placeholderTitle}>{placeholderTitle}</AppText>
            <AppText style={styles.placeholderMessage}>{placeholderMessage}</AppText>
          </View>
        )}

        {isLive ? (
          <View style={styles.reticleOverlay} pointerEvents="none">
            <View style={styles.reticle}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </View>
        ) : null}

        <View style={styles.header} pointerEvents="none">
          <View style={styles.heading}>
            <AppText style={styles.title} numberOfLines={1}>{title}</AppText>
            <View style={styles.feedStatus} testID={`${mode}-camera-feed-pill`}>
              <View style={[styles.dot, { backgroundColor: disconnected || expired ? '#F87171' : isLive ? '#4ADE80' : '#FCD34D' }]} />
              <AppText style={styles.feedLabel}>{feedLabel}</AppText>
            </View>
          </View>
          <View style={styles.timers}>
            {elapsedSec != null && Number.isFinite(elapsedSec) ? (
              <AppText style={styles.elapsed}>Đã quét {formatClock(elapsedSec)}</AppText>
            ) : null}
            {remainingSec !== null && Number.isFinite(remainingSec) ? (
              <AppText style={styles.remaining} testID={`${mode}-remaining-timer`}>
                Còn {formatClock(remainingSec)}
              </AppText>
            ) : null}
          </View>
        </View>

        <View style={styles.footer} pointerEvents="none">
          <AppText style={styles.instruction}>{instruction}</AppText>
          <AppText style={styles.status} numberOfLines={2} accessibilityLiveRegion="polite">
            {expired ? 'Phiên quét đã hết hạn' : feedbackMessage || statusText}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignSelf: 'stretch', backgroundColor: colors.background },
  cameraFrame: {
    flex: 1,
    backgroundColor: colors.darkDeepBg,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.heroNestedBg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraImage: { width: '100%', height: '100%' },
  placeholder: { maxWidth: 540, paddingHorizontal: spacing.xxl, alignItems: 'center', gap: spacing.md },
  placeholderTitle: { color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  placeholderMessage: { color: '#CBD5E1', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  reticleOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 240, height: 240, maxWidth: '65%', maxHeight: '60%' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#67E8F9' },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: 'rgba(10, 41, 59, 0.90)',
    padding: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md,
  },
  heading: { flex: 1, gap: spacing.xs },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  feedStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  feedLabel: { color: '#E0F2FE', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  timers: { alignItems: 'flex-end', gap: spacing.xs },
  elapsed: { color: '#CBD5E1', fontSize: 12 },
  remaining: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(10, 41, 59, 0.90)', padding: spacing.lg, alignItems: 'center', gap: spacing.xs,
  },
  instruction: { color: '#FFFFFF', fontSize: 19, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  status: { color: '#BAE6FD', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
