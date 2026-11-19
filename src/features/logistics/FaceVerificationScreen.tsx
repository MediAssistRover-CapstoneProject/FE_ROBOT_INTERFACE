import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../../components/ui';
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
  getCameraFeedLabel,
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

function formatClockSec(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type ProgressionStageKey = 'connecting' | 'scanning' | 'verifying' | 'outcome';

function resolveProgressionInfo(state: FaceAuthViewState): {
  activeStage: ProgressionStageKey;
  outcomeLabel: string;
  outcomeTone: 'neutral' | 'success' | 'warning' | 'danger';
  headlineStatus: string;
} {
  if (state.phase === 'verified') {
    return {
      activeStage: 'outcome',
      outcomeLabel: 'Thành công',
      outcomeTone: 'success',
      headlineStatus: 'Thành công',
    };
  }
  if (state.phase === 'expired') {
    return {
      activeStage: 'outcome',
      outcomeLabel: 'Hết hạn',
      outcomeTone: 'danger',
      headlineStatus: 'Hết hạn',
    };
  }
  if (state.phase === 'cancelled' || state.phase === 'step_changed') {
    return {
      activeStage: 'outcome',
      outcomeLabel: 'Đã dừng',
      outcomeTone: 'danger',
      headlineStatus: 'Đã dừng',
    };
  }
  if (state.lastVerifyReason && state.lastVerifyReason !== 'MATCH') {
    return {
      activeStage: 'outcome',
      outcomeLabel: 'Chưa khớp',
      outcomeTone: 'warning',
      headlineStatus: 'Chưa khớp · Vui lòng thử lại',
    };
  }
  if (state.phase === 'verifying') {
    return {
      activeStage: 'verifying',
      outcomeLabel: 'Thành công / Chưa khớp / Hết hạn',
      outcomeTone: 'neutral',
      headlineStatus: 'Đang xác thực',
    };
  }
  if (state.phase === 'scanning' && state.sessionId) {
    return {
      activeStage: 'scanning',
      outcomeLabel: 'Thành công / Chưa khớp / Hết hạn',
      outcomeTone: 'neutral',
      headlineStatus: 'Đang quét',
    };
  }
  return {
    activeStage: 'connecting',
    outcomeLabel: 'Thành công / Chưa khớp / Hết hạn',
    outcomeTone: 'neutral',
    headlineStatus: 'Đang kết nối',
  };
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

  const progression = resolveProgressionInfo(viewState);
  const cameraBadgeText =
    viewState.phase === 'expired'
      ? 'Hết hạn'
      : getCameraFeedLabel(previewState.feedStatus, viewState.isOffline);
  const isLiveFeed =
    !viewState.isOffline &&
    viewState.phase !== 'expired' &&
    previewState.feedStatus === 'live' &&
    Boolean(previewState.dataUri);

  const statusDotColor =
    viewState.isOffline ||
    viewState.phase === 'expired' ||
    previewState.feedStatus === 'network_error'
      ? '#EF4444'
      : isLiveFeed
        ? '#22C55E'
        : '#F59E0B';

  const placeholderTitle =
    viewState.phase === 'expired'
      ? 'Phiên quét khuôn mặt đã hết hạn'
      : viewState.isOffline || previewState.feedStatus === 'network_error'
        ? 'Mất kết nối mạng với máy chủ'
        : previewState.feedStatus === 'stale'
          ? 'Khung hình camera đang bị đứng'
          : 'Đang kết nối camera robot';

  const placeholderDesc =
    viewState.phase === 'expired'
      ? 'Hết thời gian chờ xác thực. Hệ thống đang giữ khoang hàng khóa và quay về màn hình bản đồ.'
      : viewState.isOffline || previewState.feedStatus === 'network_error'
        ? previewState.errorMessage ||
          viewState.feedbackMessage ||
          'Đang thử kết nối lại máy chủ backend và camera robot...'
        : previewState.feedStatus === 'unavailable_endpoint'
          ? 'Camera trên thân robot (Raspberry Pi · StaffFaceScanner) đang quét trực tiếp và gửi lên máy chủ. Máy chủ hiện chưa bật JPEG preview cho đơn giao hàng (HTTP 404).'
          : previewState.feedStatus === 'stale'
            ? previewState.errorMessage || 'Đang chờ khung hình mới từ camera trên thân robot...'
            : viewState.feedbackMessage || 'Vui lòng nhìn vào camera trên thân robot';

  const stages: Array<{ key: ProgressionStageKey; label: string; tone?: 'warning' | 'danger' | 'success' }> = [
    { key: 'connecting', label: 'Đang kết nối' },
    { key: 'scanning', label: 'Đang quét' },
    { key: 'verifying', label: 'Đang xác thực' },
    {
      key: 'outcome',
      label: progression.outcomeLabel,
      tone:
        progression.outcomeTone === 'warning'
          ? 'warning'
          : progression.outcomeTone === 'danger'
            ? 'danger'
            : progression.outcomeTone === 'success'
              ? 'success'
              : undefined,
    },
  ];

  return (
    <View style={styles.root} testID="face-verify-wait-screen">
      {/* CỘT TRÁI: KHUNG CAMERA ROBOT LỚN */}
      <View style={styles.cameraPane}>
        <View style={styles.cameraFrame}>
          {isLiveFeed && previewState.dataUri ? (
            <Image
              source={{ uri: previewState.dataUri }}
              style={styles.cameraImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.placeholderWrap}>
              {viewState.isOffline ||
              previewState.feedStatus === 'network_error' ||
              viewState.phase === 'expired' ? (
                <Ionicons name="cloud-offline-outline" size={76} color="#F87171" />
              ) : (
                <ActivityIndicator size="large" color="#38BDF8" />
              )}
              <AppText style={styles.placeholderTitle}>{placeholderTitle}</AppText>
              <AppText style={styles.placeholderDesc}>{placeholderDesc}</AppText>
            </View>
          )}

          {/* Khung hướng dẫn đặt khuôn mặt ở giữa */}
          <View style={styles.reticleOverlay} pointerEvents="none">
            <View style={styles.reticleBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <View style={styles.centerInstructionBadge}>
              <AppText style={styles.centerInstructionText}>
                Vui lòng nhìn vào camera trên thân robot
              </AppText>
            </View>
          </View>

          {/* HUD trạng thái phía trên */}
          <View style={styles.topHudBar} pointerEvents="none">
            <View style={styles.livePill} testID="face-camera-feed-pill">
              <View style={[styles.liveDot, { backgroundColor: statusDotColor }]} />
              <AppText style={styles.livePillText}>{cameraBadgeText}</AppText>
            </View>

            <View style={styles.hudRightGroup}>
              {viewState.elapsedSec !== null ? (
                <View style={styles.timePill}>
                  <AppText style={styles.timePillText}>
                    Đã quét {formatClockSec(viewState.elapsedSec)}
                  </AppText>
                </View>
              ) : null}
              {viewState.remainingSec !== null ? (
                <View style={styles.timePill} testID="face-remaining-timer">
                  <AppText style={styles.timePillText}>
                    Còn {formatClockSec(viewState.remainingSec)}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          {/* Thanh thông báo lỗi / trạng thái thực tế bên dưới khung camera */}
          {viewState.feedbackMessage ? (
            <View style={styles.bottomFeedbackBanner} pointerEvents="none">
              <Ionicons
                name={
                  viewState.isOffline || viewState.phase === 'expired'
                    ? 'warning-outline'
                    : 'information-circle-outline'
                }
                size={18}
                color="#FDE68A"
              />
              <AppText style={styles.bottomFeedbackText}>{viewState.feedbackMessage}</AppText>
            </View>
          ) : null}
        </View>
      </View>

      {/* CỘT PHẢI: TRẠNG THÁI TIẾN TRÌNH & THÔNG TIN NGƯỜI NHẬN */}
      <View style={styles.guidePane}>
        <View style={styles.guideCard}>
          <View style={styles.purposePill}>
            <Ionicons name="person-circle-outline" size={16} color="#FFFFFF" />
            <AppText style={styles.purposePillText}>{legLabel}</AppText>
          </View>

          <AppText style={styles.guideHeading}>
            Vui lòng nhìn vào camera trên thân robot
          </AppText>

          {/* Chuỗi trạng thái trực quan */}
          <View style={styles.stageRow} testID="face-progression-strip">
            {stages.map((st, idx) => {
              const isActive = progression.activeStage === st.key;
              const pillStyle =
                isActive && st.tone === 'danger'
                  ? styles.stagePillDanger
                  : isActive && st.tone === 'warning'
                    ? styles.stagePillWarning
                    : isActive
                      ? styles.stagePillActive
                      : styles.stagePillIdle;
              const textStyle = isActive ? styles.stageTextActive : styles.stageTextIdle;
              return (
                <View key={st.key} style={styles.stageItemWrap}>
                  <View style={[styles.stagePill, pillStyle]}>
                    <AppText style={textStyle} numberOfLines={1}>
                      {st.label}
                    </AppText>
                  </View>
                  {idx < stages.length - 1 ? (
                    <AppText style={styles.stageArrow}>→</AppText>
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Thẻ thông tin người nhận & trạng thái khóa ngăn */}
          <View style={styles.partyBox}>
            <View style={styles.partyRow}>
              <View style={styles.partyCell}>
                <AppText style={styles.partyLabel}>{roleLabel}</AppText>
                <AppText style={styles.partyValue} numberOfLines={2}>
                  {staffDisplay}
                </AppText>
              </View>
              <View style={styles.partyCell}>
                <AppText style={styles.partyLabel}>KHOANG HÀNG</AppText>
                <AppText style={[styles.partyValue, { color: '#FDE68A' }]}>
                  Đang khóa
                </AppText>
              </View>
            </View>
            {(viewState.requestCode ||
              viewState.pickupLocationLabel ||
              viewState.deliveryLocationLabel) ? (
              <AppText variant="caption" style={styles.routeMetaText}>
                {viewState.requestCode ? `Đơn ${viewState.requestCode}` : 'Đơn giao nhận'}
                {viewState.pickupLocationLabel || viewState.deliveryLocationLabel
                  ? ` · ${viewState.pickupLocationLabel || 'Điểm gửi'} → ${viewState.deliveryLocationLabel || 'Điểm nhận'}`
                  : ''}
              </AppText>
            ) : null}
          </View>

          <View style={styles.stepsList}>
            <View style={styles.stepItem}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>1</AppText>
              </View>
              <AppText style={styles.stepBody}>
                Đứng thẳng cách camera trên thân robot 50–80 cm, đủ ánh sáng
              </AppText>
            </View>
            <View style={styles.stepItem}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>2</AppText>
              </View>
              <AppText style={styles.stepBody}>
                Không đeo khẩu trang hoặc kính râm, chỉ một người trong khung ngắm
              </AppText>
            </View>
            <View style={styles.stepItem}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>3</AppText>
              </View>
              <AppText style={styles.stepBody}>
                {progression.headlineStatus} · Khi máy chủ xác nhận khớp, ngăn hàng mới mở khóa
              </AppText>
            </View>
          </View>

          <View style={styles.metaFooter}>
            <AppText variant="caption" style={styles.metaText}>
              Job {viewState.jobId.slice(0, 8)} · Step {viewState.authJobStepId.slice(0, 8)}
              {viewState.sessionId ? ` · Phiên ${viewState.sessionId.slice(0, 8)}` : ' · Chờ phiên'}
            </AppText>
          </View>
        </View>
      </View>
    </View>
  );
}

const CORNER_SIZE = 30;
const CORNER_BORDER = 4;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  cameraPane: {
    flex: 2.0,
    height: '100%',
  },
  cameraFrame: {
    flex: 1,
    backgroundColor: colors.darkDeepBg,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#0E5B7E',
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
    paddingBottom: 56,
  },
  placeholderTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  placeholderDesc: {
    color: '#CBD5E1',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 460,
  },
  reticleOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  reticleBox: {
    width: 230,
    height: 270,
    position: 'relative',
    borderRadius: 115,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(34, 211, 238, 0.45)',
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
    borderTopLeftRadius: 14,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderTopRightRadius: 14,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderBottomLeftRadius: 14,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderBottomRightRadius: 14,
  },
  centerInstructionBadge: {
    backgroundColor: 'rgba(10, 41, 59, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  centerInstructionText: {
    color: '#E0F2FE',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  topHudBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hudRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(10, 41, 59, 0.92)',
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
    letterSpacing: 0.3,
  },
  timePill: {
    backgroundColor: 'rgba(10, 41, 59, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  timePillText: {
    color: '#E0F2FE',
    fontSize: 12,
    fontWeight: '800',
  },
  bottomFeedbackBanner: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(11, 56, 81, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  bottomFeedbackText: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  guidePane: {
    flex: 1.05,
    height: '100%',
  },
  guideCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
  purposePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: colors.heroSurface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  purposePillText: {
    color: colors.textInverse,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  guideHeading: {
    color: colors.textPrimary,
    fontSize: 17.5,
    fontWeight: '800',
    lineHeight: 23,
  },
  stageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  stageItemWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stagePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  stagePillIdle: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  stagePillActive: {
    backgroundColor: colors.heroSurface,
    borderColor: colors.heroSurface,
  },
  stagePillWarning: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  stagePillDanger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  stageTextIdle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  stageTextActive: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  stageArrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  partyBox: {
    backgroundColor: colors.heroBlockBg,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  partyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  partyCell: {
    flex: 1,
    backgroundColor: colors.heroNestedBg,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    gap: 2,
  },
  partyLabel: {
    color: '#BAE6FD',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  partyValue: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  routeMetaText: {
    color: '#E0F2FE',
    fontWeight: '600',
    marginTop: 2,
  },
  stepsList: {
    gap: spacing.xs + 2,
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
    backgroundColor: colors.heroSurface,
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
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 17.5,
  },
  metaFooter: {
    marginTop: 'auto',
    paddingTop: spacing.sm,
    paddingRight: 72,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
  },
  metaText: {
    color: colors.textMuted,
    fontWeight: '600',
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
