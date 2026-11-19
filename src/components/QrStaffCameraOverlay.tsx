import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from './ui';
import { robotApiService } from '../services/api';
import { robotMapService } from '../services/api/robotMapService';
import { getServerNowMs } from '../services/api/serverClock';
import { RobotAuthCameraView } from './RobotAuthCameraView';
import {
  CameraPreviewState,
  applyCameraPreviewResponse,
  createInitialCameraPreviewState,
  evaluateCameraPreviewFreshness,
} from '../features/logistics/cameraPreviewState';
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
  const previewSessionKey = ['QR', jobId, authJobStepId ?? '', purpose ?? '', expiresAt ?? ''].join(':');
  const [previewState, setPreviewState] = useState<CameraPreviewState>(() =>
    createInitialCameraPreviewState(previewSessionKey),
  );
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
      const diffSec = Math.max(0, Math.ceil((Date.parse(expiresAt) - getServerNowMs()) / 1000));
      setRemainingSec(Number.isFinite(diffSec) ? diffSec : null);
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    setPreviewState(createInitialCameraPreviewState(previewSessionKey));
  }, [previewSessionKey]);

  // Display frames from the robot camera, scoped to the active QR step.
  useEffect(() => {
    if (phase !== 'scanning' || !active || !jobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortCtrl: AbortController | null = null;
    let inFlight = false;
    const freshnessTimer = setInterval(() => {
      if (!cancelled) {
        setPreviewState(prev => evaluateCameraPreviewFreshness(prev, getServerNowMs()));
      }
    }, 1_000);

    const pollFrame = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      let nextDelay = CAMERA_POLL_MS;
      abortCtrl = new AbortController();
      try {
        const res = await robotMapService.fetchJobCameraPreview(jobId, abortCtrl.signal);
        if (cancelled) return;
        setPreviewState(prev =>
          applyCameraPreviewResponse(prev, res, getServerNowMs(), previewSessionKey),
        );
        if ([0, 401, 403, 404].includes(res.status) || res.status >= 500) {
          nextDelay = 2_500;
        }
      } finally {
        abortCtrl = null;
        inFlight = false;
        if (!cancelled) {
          timer = setTimeout(() => { void pollFrame(); }, nextDelay);
        }
      }
    };

    void pollFrame();
    return () => {
      cancelled = true;
      abortCtrl?.abort();
      if (timer) clearTimeout(timer);
      clearInterval(freshnessTimer);
    };
  }, [active, jobId, phase, previewSessionKey]);

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
              onDismissRef.current(authJobStepId);
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

  return (
    <RobotAuthCameraView
      mode="qr"
      testID="qr-camera-wait-screen"
      preview={previewState.sessionKey === previewSessionKey
        ? previewState
        : createInitialCameraPreviewState(previewSessionKey)}
      title={legLabel}
      remainingSec={remainingSec}
      statusText="Đang chờ robot xác thực mã QR"
      expired={remainingSec === 0}
    />
  );
}

const styles = StyleSheet.create({
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
