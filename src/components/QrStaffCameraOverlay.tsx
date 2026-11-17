import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from './ui';
import { robotApiService } from '../services/api';
import { JobCameraPreviewFrame, robotMapService } from '../services/api/robotMapService';
import { playSuccessTing } from '../utils/playSuccessTing';
import { colors, radii, spacing } from '../theme';

interface QrStaffCameraOverlayProps {
  jobId: string;
  authJobStepId: string | null;
  stepCode?: string | null;
  purpose?: 'DELIVERY_SENDER' | 'DELIVERY_RECEIVER';
  expiresAt?: string | null;
  active: boolean;
  onSuccessComplete: (completedStepId: string | null) => void;
  onDismiss: (stepId: string | null) => void;
}

const CAMERA_POLL_MS = 600;
const VERIFY_POLL_MS = 900;
const SUCCESS_DISPLAY_MS = 1_800;

export function QrStaffCameraOverlay({
  jobId,
  authJobStepId,
  stepCode,
  purpose,
  expiresAt,
  active,
  onSuccessComplete,
  onDismiss,
}: QrStaffCameraOverlayProps) {
  const [phase, setPhase] = useState<'scanning' | 'success'>('scanning');
  const [frame, setFrame] = useState<JobCameraPreviewFrame | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  const onSuccessRef = useRef(onSuccessComplete);
  onSuccessRef.current = onSuccessComplete;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const legLabel =
    purpose === 'DELIVERY_SENDER' || stepCode?.toUpperCase().includes('SENDER')
      ? 'XÁC THỰC QR NGƯỜI GỬI'
      : purpose === 'DELIVERY_RECEIVER' || stepCode?.toUpperCase().includes('RECEIVER')
        ? 'XÁC THỰC QR NGƯỜI NHẬN'
        : 'CHỜ STAFF QUÉT MÃ QR';

  // Đếm ngược thời hạn phiên QR (nếu server cung cấp expiresAt)
  useEffect(() => {
    if (!expiresAt) {
      setRemainingSec(null);
      return;
    }
    const updateCountdown = () => {
      const diffSec = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
      setRemainingSec(Number.isFinite(diffSec) ? diffSec : null);
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // 1. Poll khung hình camera từ server: GET /api/v1/jobs/{jobId}/camera-preview.jpg
  useEffect(() => {
    if (phase !== 'scanning' || !active || !jobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const pollFrame = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      let nextDelay = CAMERA_POLL_MS;
      try {
        const res = await robotMapService.fetchJobCameraPreview(jobId);
        if (cancelled) return;
        setFrame((prev) => {
          if (res.status === 200 && res.dataUri) return res;
          if (prev?.dataUri && res.status === 204) return prev;
          return res;
        });
        if (res.status === 404 || res.status === 401 || res.status === 403) {
          nextDelay = 2_500;
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = setTimeout(() => {
            void pollFrame();
          }, nextDelay);
        }
      }
    };

    void pollFrame();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, jobId, phase]);

  // 2. Theo dõi trạng thái hoàn tất quét QR của Staff
  useEffect(() => {
    if (phase !== 'scanning' || !active || !jobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const checkVerification = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const activeWindow = await robotApiService.getStaffQrScanWindow(jobId);
        if (cancelled) return;

        const challengeMoved =
          !activeWindow ||
          (authJobStepId !== null && activeWindow.authJobStepId !== authJobStepId);

        if (challengeMoved) {
          const stepResult = await robotMapService.checkJobQrStepStatus(jobId, authJobStepId);
          if (cancelled) return;

          if (stepResult?.verified) {
            setPhase('success');
            void playSuccessTing();
            return;
          }

          if (
            stepResult &&
            (['CANCELLED', 'FAILED'].includes(stepResult.jobStatus) ||
              ['CANCELLED', 'FAILED', 'TIMED_OUT'].includes(stepResult.stepStatus || ''))
          ) {
            onDismissRef.current(authJobStepId);
            return;
          }

          if (
            stepResult &&
            (stepResult.stepStatus === 'RUNNING' || stepResult.stepStatus === 'PENDING' || stepResult.stepStatus === 'RETRYING')
          ) {
            return;
          }

          if (!stepResult) {
            const snap = await robotMapService.loadRobotSnapshot({ includeGuidance: false });
            if (cancelled) return;
            if (
              snap.snapshotReachable &&
              (snap.selectedStepType !== 'AUTHENTICATE' ||
                (authJobStepId && snap.selectedJobStepId !== authJobStepId))
            ) {
              setPhase('success');
              void playSuccessTing();
              return;
            }
          }
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = setTimeout(() => {
            void checkVerification();
          }, VERIFY_POLL_MS);
        }
      }
    };

    timer = setTimeout(() => {
      void checkVerification();
    }, VERIFY_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, authJobStepId, jobId, phase]);

  // 3. Sau khi hiển thị dấu tích thành công + tiếng "tin", tự động quay lại Map
  useEffect(() => {
    if (phase !== 'success') return;
    const timer = setTimeout(() => {
      onSuccessRef.current(authJobStepId);
    }, SUCCESS_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [authJobStepId, phase]);

  if (phase === 'success') {
    return (
      <View style={styles.successRoot} testID="qr-scan-success-screen">
        <View style={styles.successCard}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={88} color="#16A34A" />
          </View>
          <AppText style={styles.successTitle}>Đã quét mã QR thành công!</AppText>
          <AppText style={styles.successSubtitle}>
            Hệ thống đã xác nhận nhân viên. Đang quay lại màn hình bản đồ...
          </AppText>
        </View>
      </View>
    );
  }

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <View style={styles.root} testID="qr-camera-wait-screen">
      {/* CỘT TRÁI: KHUNG CAMERA ROBOT TỪ SERVER */}
      <View style={styles.cameraPane}>
        <View style={styles.cameraFrame}>
          {frame?.dataUri ? (
            <Image
              source={{ uri: frame.dataUri }}
              style={styles.cameraImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.placeholderWrap}>
              <ActivityIndicator size="large" color="#38BDF8" />
              <AppText style={styles.placeholderTitle}>
                Đang kết nối camera robot từ máy chủ
              </AppText>
              <AppText style={styles.placeholderDesc}>
                {frame?.errorMessage ||
                  'Đưa mã QR trên điện thoại Staff vào trước camera trên thân robot.'}
              </AppText>
            </View>
          )}

          {/* Khung ngắm 4 góc giúp Staff căn mã QR chuẩn vào camera */}
          <View style={styles.reticleOverlay} pointerEvents="none">
            <View style={styles.reticleBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </View>

          {/* Badge trạng thái LIVE góc trên trái camera */}
          <View style={styles.topHudBar} pointerEvents="none">
            <View style={styles.livePill}>
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: frame?.dataUri ? '#22C55E' : '#F59E0B' },
                ]}
              />
              <AppText style={styles.livePillText}>
                {frame?.dataUri ? 'CAMERA ROBOT LIVE' : 'CHỜ CAMERA SERVER'}
              </AppText>
            </View>

            {frame?.capturedAt ? (
              <View style={styles.timePill}>
                <AppText style={styles.timePillText}>
                  {new Date(frame.capturedAt).toLocaleTimeString('vi-VN')}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* CỘT PHẢI: HƯỚNG DẪN STAFF CĂN MÃ QR */}
      <View style={styles.guidePane}>
        <View style={styles.guideCard}>
          <View style={styles.purposePill}>
            <Ionicons name="qr-code-outline" size={16} color="#0369A1" />
            <AppText style={styles.purposePillText}>{legLabel}</AppText>
          </View>

          <AppText style={styles.guideHeading}>Đưa mã QR vào trước camera Robot</AppText>
          <AppText style={styles.guideLead}>
            Quan sát khung hình bên trái để căn mã QR trên app Staff nằm chính giữa vùng camera robot.
          </AppText>

          <View style={styles.stepsList}>
            <View style={styles.stepItem}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>1</AppText>
              </View>
              <AppText style={styles.stepBody}>Mở mã QR xác thực trên điện thoại Staff</AppText>
            </View>
            <View style={styles.stepItem}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>2</AppText>
              </View>
              <AppText style={styles.stepBody}>
                Giữ điện thoại cách camera robot 15–25 cm, thẳng khung ngắm
              </AppText>
            </View>
            <View style={styles.stepItem}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>3</AppText>
              </View>
              <AppText style={styles.stepBody}>
                Khi có tiếng "tin" & dấu tích xanh là xác thực xong
              </AppText>
            </View>
          </View>

          <View style={styles.metaFooter}>
            <AppText variant="caption" style={styles.metaText}>
              Job: {jobId.slice(0, 8)}...
            </AppText>
            {remainingSec !== null ? (
              <AppText variant="caption" style={styles.timerText}>
                Còn {formatCountdown(remainingSec)}
              </AppText>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const CORNER_SIZE = 28;
const CORNER_BORDER = 4;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  cameraPane: {
    flex: 1.9,
    height: '100%',
  },
  cameraFrame: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1E293B',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraImage: {
    width: '100%',
    height: '100%',
  },
  placeholderWrap: {
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  placeholderTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderDesc: {
    color: '#94A3B8',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 420,
  },
  reticleOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleBox: {
    width: 210,
    height: 210,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#22D3EE',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderBottomRightRadius: 8,
  },
  topHudBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  livePillText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  timePill: {
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  timePillText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  guidePane: {
    flex: 1,
    height: '100%',
  },
  guideCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  purposePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  purposePillText: {
    color: '#0369A1',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  guideHeading: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 25,
  },
  guideLead: {
    color: colors.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
  },
  stepsList: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '800',
  },
  stepBody: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  metaFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingRight: 72,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
  },
  metaText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  timerText: {
    color: '#0369A1',
    fontWeight: '800',
  },
  successRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: '#86EFAC',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 480,
    width: '100%',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  },
  successIconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    color: '#15803D',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  successSubtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
