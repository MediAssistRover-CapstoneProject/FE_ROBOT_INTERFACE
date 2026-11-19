import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../../components/ui';
import { RobotAuthCameraView } from '../../components/RobotAuthCameraView';
import { robotApiService } from '../../services/api';
import { robotMapService } from '../../services/api/robotMapService';
import { getServerNowMs } from '../../services/api/serverClock';
import type { DeliveryAuthPurpose } from '../../services/api/types';
import { colors, radii, spacing } from '../../theme';
import { playSuccessTing } from '../../utils/playSuccessTing';
import {
  CameraPreviewState,
  applyCameraPreviewResponse,
  createInitialCameraPreviewState,
  evaluateCameraPreviewFreshness,
} from './cameraPreviewState';
import {
  FaceAuthController,
  FaceAuthInitialContext,
  FaceAuthPhase,
  FaceAuthViewState,
  buildFaceAuthSessionKey,
} from './faceAuthController';

export interface FaceVerificationScreenProps {
  jobId?: string | null;
  authJobStepId?: string | null;
  sessionId?: string | null;
  robotId?: string | null;
  stepCode?: string | null;
  purpose?: DeliveryAuthPurpose;
  expiresAt?: string | null;
  startedAt?: string | null;
  requestCode?: string | null;
  serviceRequestId?: string | null;
  expectedAccountId?: string | null;
  expectedPersonName?: string | null;
  pickupLocationLabel?: string | null;
  deliveryLocationLabel?: string | null;
  active?: boolean;
  onSuccessComplete?: (completedStepId: string | null, sessionKey?: string | null) => void;
  onDismiss?: (
    stepId: string | null,
    reason?: 'expired' | 'cancelled' | 'step_changed',
    sessionKey?: string | null,
  ) => void;
}

const CAMERA_PREVIEW_POLL_MS = 650;
const CAMERA_FRESHNESS_CHECK_MS = 1_000;
const SUCCESS_DISPLAY_MS = 1_800;
const EXPIRED_DISMISS_MS = 2_200;

function getFaceStatusLabel(state: FaceAuthViewState): string {
  if (state.phase === 'expired') return 'Phiên quét đã hết hạn';
  if (state.phase === 'cancelled' || state.phase === 'step_changed') return 'Phiên quét đã dừng';
  if (state.lastVerifyReason && state.lastVerifyReason !== 'MATCH') return 'Chưa khớp · Vui lòng thử lại';
  if (state.phase === 'verifying') return 'Đang xác thực khuôn mặt';
  if (state.phase === 'scanning' && state.sessionId) return 'Đang quét khuôn mặt người nhận';
  return 'Đang chờ phiên xác thực';
}

export function FaceVerificationScreen({
  jobId,
  authJobStepId,
  sessionId,
  robotId,
  stepCode,
  purpose = 'DELIVERY_RECEIVER',
  expiresAt,
  startedAt,
  requestCode,
  serviceRequestId,
  expectedAccountId,
  expectedPersonName,
  pickupLocationLabel,
  deliveryLocationLabel,
  active = true,
  onSuccessComplete,
  onDismiss,
}: FaceVerificationScreenProps) {
  const controllerRef = useRef<FaceAuthController | null>(null);
  const successNotifiedRef = useRef(false);
  const lastBoundPropKeyRef = useRef<string>('');
  const activeRef = useRef(active);
  activeRef.current = active;

  const onSuccessRef = useRef(onSuccessComplete);
  onSuccessRef.current = onSuccessComplete;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const initialSessionKey = buildFaceAuthSessionKey(jobId, authJobStepId, sessionId);
  const [previewState, setPreviewState] = useState<CameraPreviewState>(() =>
    createInitialCameraPreviewState(initialSessionKey),
  );

  const initialContextRef = useRef<FaceAuthInitialContext | null>(null);
  initialContextRef.current =
    jobId && authJobStepId
      ? {
          jobId,
          authJobStepId,
          sessionId: sessionId ?? null,
          robotId: robotId ?? null,
          purpose,
          stepCode: stepCode ?? null,
          expiresAt: expiresAt ?? null,
          startedAt: startedAt ?? null,
          requestCode: requestCode ?? null,
          serviceRequestId: serviceRequestId ?? null,
          expectedAccountId: expectedAccountId ?? null,
          expectedPersonName: expectedPersonName ?? null,
          pickupLocationLabel: pickupLocationLabel ?? null,
          deliveryLocationLabel: deliveryLocationLabel ?? null,
        }
      : null;

  const [viewState, setViewState] = useState<FaceAuthViewState>(() => ({
    phase: sessionId ? 'scanning' : 'waiting_window',
    jobId: jobId ?? '',
    authJobStepId: authJobStepId ?? '',
    sessionId: sessionId ?? null,
    sessionKey: initialSessionKey,
    robotId: robotId ?? null,
    purpose,
    stepCode: stepCode ?? null,
    expiresAt: expiresAt ?? null,
    windowStartedAt: startedAt ?? null,
    remainingSec: expiresAt
      ? Math.max(0, Math.floor((Date.parse(expiresAt) - getServerNowMs()) / 1000))
      : null,
    elapsedSec: startedAt
      ? Math.max(0, Math.floor((getServerNowMs() - Date.parse(startedAt)) / 1000))
      : null,
    requestCode: requestCode ?? null,
    serviceRequestId: serviceRequestId ?? null,
    expectedAccountId: expectedAccountId ?? null,
    expectedPersonName: expectedPersonName ?? null,
    pickupLocationLabel: pickupLocationLabel ?? null,
    deliveryLocationLabel: deliveryLocationLabel ?? null,
    verifyInFlight: false,
    lastVerifyReason: null,
    feedbackMessage: sessionId
      ? null
      : 'Đang chờ máy chủ mở cửa sổ quét khuôn mặt...',
    isOffline: false,
    compartmentLocked: true,
  }));

  // 1. Khởi tạo FaceAuthController duy nhất cho cặp (jobId, authJobStepId);
  // rerender hay tạm ẩn app không làm reset expiresAt hoặc mở trùng phiên.
  useEffect(() => {
    if (!jobId || !authJobStepId || !initialContextRef.current) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      lastBoundPropKeyRef.current = '';
      return;
    }

    successNotifiedRef.current = false;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    let successTimer: ReturnType<typeof setTimeout> | null = null;

    const initialCtx = initialContextRef.current;
    lastBoundPropKeyRef.current = buildFaceAuthSessionKey(
      initialCtx.jobId,
      initialCtx.authJobStepId,
      initialCtx.sessionId,
    );

    const controller = new FaceAuthController({
      context: initialCtx,
      deps: {
        getFaceWindow: (id) =>
          robotApiService.getStaffFaceScanWindow(id, { throwOnError: true }),
        checkJobStepStatus: (id, sid) => robotMapService.checkJobQrStepStatus(id, sid),
        loadPartyInfo: (reqId, p, accId) =>
          robotMapService.loadDeliveryAuthPartyInfo(reqId, p, accId),
      },
      onStateChange: (next) => {
        setViewState(next);
      },
      onVerified: (completedStepId, verifiedSessionKey) => {
        if (successNotifiedRef.current) return;
        successNotifiedRef.current = true;
        void playSuccessTing();
        successTimer = setTimeout(() => {
          onSuccessRef.current?.(completedStepId, verifiedSessionKey ?? null);
        }, SUCCESS_DISPLAY_MS);
      },
      onDismiss: (stepId, reason, dismissedSessionKey) => {
        if (reason === 'expired') {
          dismissTimer = setTimeout(() => {
            onDismissRef.current?.(stepId, reason, dismissedSessionKey ?? null);
          }, EXPIRED_DISMISS_MS);
          return;
        }
        onDismissRef.current?.(stepId, reason, dismissedSessionKey ?? null);
      },
    });

    controllerRef.current = controller;
    controller.setActive(activeRef.current);
    controller.start();

    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      if (successTimer) clearTimeout(successTimer);
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [authJobStepId, jobId]);

  // Nếu parent nhận một sessionId hoàn toàn mới trên cùng step -> rebind rõ ràng, xóa ảnh cũ.
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl || !jobId || !authJobStepId || !sessionId || !initialContextRef.current) return;
    const incomingPropKey = buildFaceAuthSessionKey(jobId, authJobStepId, sessionId);
    const currentCtrlKey = ctrl.getState().sessionKey;
    if (
      incomingPropKey !== lastBoundPropKeyRef.current &&
      incomingPropKey !== currentCtrlKey
    ) {
      lastBoundPropKeyRef.current = incomingPropKey;
      setPreviewState(createInitialCameraPreviewState(incomingPropKey));
      ctrl.rebindContext(initialContextRef.current);
    }
  }, [authJobStepId, jobId, sessionId]);

  // Tạm dừng / tiếp tục khi app xuống nền hoặc quay lại mà giữ nguyên deadline expiresAt.
  useEffect(() => {
    controllerRef.current?.setActive(active);
  }, [active]);

  // Xóa ngay khung hình cũ mỗi khi đổi phiên (jobId / authJobStepId / sessionId).
  const activeSessionKey = buildFaceAuthSessionKey(
    viewState.jobId || jobId,
    viewState.authJobStepId || authJobStepId,
    viewState.sessionId ?? sessionId,
  );
  useEffect(() => {
    setPreviewState((prev) =>
      prev.sessionKey === activeSessionKey
        ? prev
        : createInitialCameraPreviewState(activeSessionKey),
    );
  }, [activeSessionKey]);

  // 2. Poll preview camera vật lý từ server (single in-flight, abort khi đổi phiên hoặc rời màn hình).
  const isLiveScanPhase: FaceAuthPhase[] = ['waiting_window', 'scanning', 'verifying'];
  const shouldPollPreview =
    active &&
    Boolean(jobId) &&
    isLiveScanPhase.includes(viewState.phase);

  useEffect(() => {
    if (!shouldPollPreview || !jobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let freshnessTimer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let abortCtrl: AbortController | null = null;
    const requestSessionKey = activeSessionKey;

    freshnessTimer = setInterval(() => {
      if (cancelled) return;
      setPreviewState((prev) => evaluateCameraPreviewFreshness(prev, getServerNowMs()));
    }, CAMERA_FRESHNESS_CHECK_MS);

    const pollPreview = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      let nextDelay = CAMERA_PREVIEW_POLL_MS;
      abortCtrl = new AbortController();
      try {
        const res = await robotMapService.fetchJobCameraPreview(jobId, abortCtrl.signal);
        if (cancelled) return;
        setPreviewState((prev) =>
          applyCameraPreviewResponse(prev, res, getServerNowMs(), requestSessionKey),
        );
        if (
          res.status === 404 ||
          res.status === 401 ||
          res.status === 403 ||
          res.status === 0 ||
          res.status >= 500
        ) {
          nextDelay = 2_500;
        }
      } finally {
        abortCtrl = null;
        inFlight = false;
        if (!cancelled) {
          timer = setTimeout(() => {
            void pollPreview();
          }, nextDelay);
        }
      }
    };

    void pollPreview();
    return () => {
      cancelled = true;
      abortCtrl?.abort();
      abortCtrl = null;
      if (timer) clearTimeout(timer);
      if (freshnessTimer) clearInterval(freshnessTimer);
    };
  }, [activeSessionKey, jobId, shouldPollPreview]);

  if (!jobId || !authJobStepId) {
    return (
      <View style={styles.emptyRoot} testID="face-verify-no-job-screen">
        <View style={styles.emptyCard}>
          <Ionicons name="person-circle-outline" size={64} color={colors.heroSurface} />
          <AppText style={styles.emptyTitle}>Chưa có phiên xác thực khuôn mặt</AppText>
          <AppText style={styles.emptySubtitle}>
            Màn hình này chỉ tự mở khi Robot đang thực thi bước xác thực khuôn mặt người nhận hàng còn hiệu lực từ máy chủ.
          </AppText>
        </View>
      </View>
    );
  }

  const isSender = viewState.purpose === 'DELIVERY_SENDER';
  const legLabel = isSender
    ? 'XÁC THỰC KHUÔN MẶT NGƯỜI GỬI'
    : 'XÁC THỰC KHUÔN MẶT NGƯỜI NHẬN HÀNG';
  const roleLabel = isSender ? 'NHÂN VIÊN GỬI HÀNG' : 'NGƯỜI NHẬN HÀNG';
  const staffDisplay =
    viewState.expectedPersonName ||
    (viewState.expectedAccountId
      ? `Nhân viên #${viewState.expectedAccountId.slice(0, 8)}`
      : isSender
        ? 'Nhân viên gửi được phân công'
        : 'Nhân viên nhận được phân công');

  if (viewState.phase === 'verified') {
    return (
      <View style={styles.successRoot} testID="face-verify-success-screen">
        <View style={styles.successCard}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={88} color="#16A34A" />
          </View>
          <AppText style={styles.successTitle}>Đã xác thực khuôn mặt thành công!</AppText>
          <AppText style={styles.successSubtitle}>
            {roleLabel}: {staffDisplay}. Máy chủ sẽ cấp quyền cho bước tiếp theo và màn hình đang quay về bản đồ...
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <RobotAuthCameraView
      mode="face"
      testID="face-verify-wait-screen"
      preview={previewState.sessionKey === activeSessionKey
        ? previewState
        : createInitialCameraPreviewState(activeSessionKey)}
      title={legLabel}
      remainingSec={viewState.remainingSec}
      elapsedSec={viewState.elapsedSec}
      statusText={getFaceStatusLabel(viewState)}
      feedbackMessage={viewState.feedbackMessage}
      isOffline={viewState.isOffline}
      expired={viewState.phase === 'expired'}
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
    maxWidth: 500,
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
  emptyRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 460,
    width: '100%',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
