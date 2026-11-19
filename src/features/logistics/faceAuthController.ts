import { isValidUuid, normalizeFaceJpegBase64 } from '../../services/api/faceValidation';
import { getServerNowMs } from '../../services/api/serverClock';
import type {
  DeliveryAuthPartyInfo,
  JobQrStepStatusResult,
  RobotSnapshotSummary,
} from '../../services/api/robotMapService';
import type {
  DeliveryAuthMethod,
  DeliveryAuthPurpose,
  FaceVerifyReason,
  FaceVerifyRequest,
  FaceVerifyResponse,
  StaffFaceScanWindow,
  StaffQrScanWindow,
} from '../../services/api/types';

export type FaceAuthPhase =
  | 'waiting_window'
  | 'scanning'
  | 'verifying'
  | 'verified'
  | 'expired'
  | 'cancelled'
  | 'step_changed';

export interface FaceAuthViewState {
  phase: FaceAuthPhase;
  jobId: string;
  authJobStepId: string;
  sessionId: string | null;
  sessionKey: string;
  robotId: string | null;
  purpose: DeliveryAuthPurpose;
  stepCode: string | null;
  expiresAt: string | null;
  windowStartedAt: string | null;
  remainingSec: number | null;
  elapsedSec: number | null;
  requestCode: string | null;
  serviceRequestId: string | null;
  expectedAccountId: string | null;
  expectedPersonName: string | null;
  pickupLocationLabel: string | null;
  deliveryLocationLabel: string | null;
  verifyInFlight: boolean;
  lastVerifyReason: FaceVerifyReason | null;
  feedbackMessage: string | null;
  isOffline: boolean;
  compartmentLocked: boolean;
}

export interface FaceAuthCameraFrame {
  imageBase64: string;
  capturedAtMs: number;
  width?: number;
  height?: number;
  cameraSource?: string;
}

export type FaceFrameSubmitResult =
  | { submitted: true; response: FaceVerifyResponse }
  | {
      submitted: false;
      reason:
        | 'DISPOSED'
        | 'NO_ACTIVE_WINDOW'
        | 'EXPIRED'
        | 'IN_FLIGHT'
        | 'MISSING_TRANSPORT_SESSION'
        | 'INVALID_FRAME'
        | 'STALE_FRAME'
        | 'STALE_CONTEXT'
        | 'VERIFIER_UNAVAILABLE'
        | 'NETWORK_ERROR';
      message: string;
    };

export type ActiveAuthOverlayState =
  | {
      method: 'QR_CODE';
      jobId: string;
      authJobStepId: string | null;
      stepCode: string | null;
      purpose?: DeliveryAuthPurpose;
      expiresAt?: string | null;
    }
  | {
      method: 'FACE_VERIFICATION';
      jobId: string;
      authJobStepId: string | null;
      sessionId: string | null;
      robotId?: string | null;
      stepCode: string | null;
      purpose: DeliveryAuthPurpose;
      expiresAt?: string | null;
      startedAt?: string | null;
      requestCode?: string | null;
      serviceRequestId?: string | null;
      expectedAccountId?: string | null;
      expectedPersonName?: string | null;
      pickupLocationLabel?: string | null;
      deliveryLocationLabel?: string | null;
    };

export interface ResolveAuthOverlayDeps {
  handledStepIds: ReadonlySet<string>;
  handledSessionKeys?: ReadonlySet<string>;
  expectedRobotId?: string | null;
  now?: () => number;
  checkJobStepStatus: (jobId: string, stepId?: string | null) => Promise<JobQrStepStatusResult | null>;
  getQrWindow: (jobId: string) => Promise<StaffQrScanWindow | null>;
  getFaceWindow: (jobId: string) => Promise<StaffFaceScanWindow | null>;
  loadPartyInfo?: (
    serviceRequestId: string | null | undefined,
    purpose: DeliveryAuthPurpose,
    expectedAccountId?: string | null,
  ) => Promise<DeliveryAuthPartyInfo>;
}

export interface FaceAuthControllerDependencies {
  getFaceWindow: (jobId: string) => Promise<StaffFaceScanWindow | null>;
  verifyFace?: (jobId: string, body: FaceVerifyRequest) => Promise<FaceVerifyResponse>;
  checkJobStepStatus: (jobId: string, stepId?: string | null) => Promise<JobQrStepStatusResult | null>;
  loadPartyInfo?: (
    serviceRequestId: string | null | undefined,
    purpose: DeliveryAuthPurpose,
    expectedAccountId?: string | null,
  ) => Promise<DeliveryAuthPartyInfo>;
  /** Nguồn cung cấp transportSessionId MQTT thật (Pi giữ). Không tự sinh hoặc dùng sessionId thay thế. */
  getTransportSessionId?: () => string | null | undefined;
  now?: () => number;
}

export interface FaceAuthInitialContext {
  jobId: string;
  authJobStepId: string;
  sessionId?: string | null;
  robotId?: string | null;
  purpose: DeliveryAuthPurpose;
  stepCode?: string | null;
  expiresAt?: string | null;
  startedAt?: string | null;
  requestCode?: string | null;
  serviceRequestId?: string | null;
  expectedAccountId?: string | null;
  expectedPersonName?: string | null;
  pickupLocationLabel?: string | null;
  deliveryLocationLabel?: string | null;
}

export interface FaceAuthControllerOptions {
  context: FaceAuthInitialContext;
  deps: FaceAuthControllerDependencies;
  pollIntervalMs?: number;
  expectedCameraSource?: string;
  onStateChange?: (state: FaceAuthViewState) => void;
  onVerified?: (completedStepId: string, sessionKey?: string) => void;
  onDismiss?: (
    stepId: string,
    reason: 'expired' | 'cancelled' | 'step_changed',
    sessionKey?: string,
  ) => void;
}

export const FACE_POLL_INTERVAL_MS = 900;
const MAX_FRAME_AGE_MS = 2_000;
const MAX_FUTURE_FRAME_SKEW_MS = 2_000;
const MAX_RECOMMENDED_WIDTH = 960;
const MAX_RECOMMENDED_HEIGHT = 720;

const FACE_REASON_MESSAGES: Record<string, string> = {
  NO_FACE: 'Chưa thấy khuôn mặt. Vui lòng đứng thẳng trước camera trên thân robot.',
  MULTIPLE_FACES: 'Phát hiện nhiều khuôn mặt. Vui lòng chỉ một nhân viên đứng trước camera.',
  LOW_QUALITY: 'Hình ảnh chưa rõ nét. Vui lòng đứng cách 50–80 cm, đủ ánh sáng và giữ yên.',
  NO_MATCH: 'Khuôn mặt chưa khớp với nhân viên được giao chặng này. Vui lòng thử lại.',
  FACE_AI_UNAVAILABLE: 'Dịch vụ nhận diện khuôn mặt tạm thời gián đoạn. Đang chờ thử lại.',
};

export function mapFaceVerifyReasonToMessage(reason?: string | null): string {
  if (!reason) return 'Xác thực khuôn mặt chưa thành công. Vui lòng thử lại.';
  return FACE_REASON_MESSAGES[reason] ?? `Xác thực chưa khớp (${reason}). Vui lòng thử lại.`;
}

function inferPurposeFromStepCode(stepCode?: string | null): DeliveryAuthPurpose | null {
  if (!stepCode) return null;
  const upper = stepCode.toUpperCase();
  if (upper.endsWith('_SENDER') || upper.includes('SENDER')) return 'DELIVERY_SENDER';
  if (upper.endsWith('_RECEIVER') || upper.includes('RECEIVER')) return 'DELIVERY_RECEIVER';
  return null;
}

function isJobOrStepTerminalFailure(info: JobQrStepStatusResult | null): boolean {
  if (!info) return false;
  if (info.cancelRequestedAt || info.interruptionRequestedAt) return true;
  if (['CANCELLED', 'FAILED'].includes(info.jobStatus)) return true;
  if (['CANCELLED', 'FAILED', 'TIMED_OUT'].includes(info.stepStatus || '')) return true;
  return false;
}

export function buildFaceAuthSessionKey(
  jobId: string | null | undefined,
  authJobStepId: string | null | undefined,
  sessionId: string | null | undefined,
): string {
  const j = (jobId ?? '').trim().toLowerCase();
  const st = (authJobStepId ?? '').trim().toLowerCase();
  const s = (sessionId ?? '').trim().toLowerCase();
  return `${j}:${st}:${s}`;
}

export function shouldOpenAuthOverlay(
  current: ActiveAuthOverlayState | null,
  next: ActiveAuthOverlayState | null,
  handledStepIds: ReadonlySet<string>,
  handledSessionKeys?: ReadonlySet<string>,
): boolean {
  if (!next) return false;
  if (next.authJobStepId && handledStepIds.has(next.authJobStepId)) {
    return false;
  }
  if (next.method === 'FACE_VERIFICATION') {
    if (
      next.purpose !== 'DELIVERY_RECEIVER' ||
      !isValidUuid(next.authJobStepId) ||
      !isValidUuid(next.sessionId)
    ) {
      return false;
    }
    const nextKey = buildFaceAuthSessionKey(next.jobId, next.authJobStepId, next.sessionId);
    if (handledSessionKeys?.has(nextKey)) {
      return false;
    }
    if (
      current?.method === 'FACE_VERIFICATION' &&
      buildFaceAuthSessionKey(current.jobId, current.authJobStepId, current.sessionId) === nextKey
    ) {
      return false;
    }
    if (current !== null) {
      return false;
    }
    return true;
  }
  if (next.method === 'QR_CODE') {
    return current === null;
  }
  return false;
}

/**
 * Phân nhánh đúng phương thức AUTHENTICATE (QR_CODE vs FACE_VERIFICATION vs STAFF_CONFIRMATION)
 * từ snapshot và API job/step/window của BE. Không mặc định ép mọi AUTHENTICATE là QR.
 * Chỉ mở màn camera Face khi đúng bước NGƯỜI NHẬN (DELIVERY_RECEIVER), đúng robot/job,
 * bước đang RUNNING và GET /face-auth đã có cửa sổ sessionId còn hạn.
 */
export async function resolveAuthenticateOverlayForSnapshot(
  snap: Pick<
    RobotSnapshotSummary,
    'activeJobId' | 'selectedJobStepId' | 'selectedStepType' | 'selectedStepCode' | 'robotId'
  >,
  deps: ResolveAuthOverlayDeps,
): Promise<ActiveAuthOverlayState | null> {
  const nowMs = (deps.now ?? getServerNowMs)();
  const jobId = snap.activeJobId;
  const stepId = snap.selectedJobStepId ?? null;
  if (!jobId || snap.selectedStepType !== 'AUTHENTICATE') {
    return null;
  }
  const expectedRobot = deps.expectedRobotId?.trim() || null;
  if (expectedRobot && snap.robotId && expectedRobot.toLowerCase() !== snap.robotId.toLowerCase()) {
    return null;
  }
  if (stepId && deps.handledStepIds.has(stepId)) {
    return null;
  }

  const stepInfo = await deps.checkJobStepStatus(jobId, stepId).catch(() => null);
  if (stepInfo) {
    if (stepInfo.jobId && stepInfo.jobId.toLowerCase() !== jobId.toLowerCase()) {
      return null;
    }
    const scopeRobot = expectedRobot || snap.robotId || null;
    if (
      scopeRobot &&
      stepInfo.robotId &&
      scopeRobot.toLowerCase() !== stepInfo.robotId.toLowerCase()
    ) {
      return null;
    }
    if (isJobOrStepTerminalFailure(stepInfo)) return null;
    if (stepInfo.verified || stepInfo.stepStatus === 'SUCCEEDED' || stepInfo.jobStatus === 'SUCCEEDED') {
      return null;
    }
    if (stepInfo.jobStatus && stepInfo.jobStatus !== 'RUNNING') {
      return null;
    }
    if (stepInfo.stepStatus && stepInfo.stepStatus !== 'RUNNING') {
      return null;
    }
    if (
      stepId &&
      stepInfo.selectedJobStepId &&
      stepInfo.selectedJobStepId.toLowerCase() !== stepId.toLowerCase()
    ) {
      return null;
    }
  }

  const method: DeliveryAuthMethod | null = stepInfo?.authMethod ?? null;
  if (method === 'STAFF_CONFIRMATION') {
    return null;
  }

  const strictPurpose: DeliveryAuthPurpose | null =
    stepInfo?.purpose ??
    inferPurposeFromStepCode(snap.selectedStepCode ?? stepInfo?.stepCode);
  const qrFallbackPurpose: DeliveryAuthPurpose = strictPurpose ?? 'DELIVERY_SENDER';

  const enrichFaceParty = async (
    base: Extract<ActiveAuthOverlayState, { method: 'FACE_VERIFICATION' }>,
  ): Promise<ActiveAuthOverlayState> => {
    if (
      deps.loadPartyInfo &&
      !base.expectedPersonName &&
      (base.serviceRequestId || base.expectedAccountId)
    ) {
      const party = await deps
        .loadPartyInfo(base.serviceRequestId, base.purpose, base.expectedAccountId)
        .catch(() => null);
      if (party) {
        return {
          ...base,
          requestCode: base.requestCode ?? party.requestCode,
          expectedAccountId: base.expectedAccountId ?? party.expectedAccountId,
          expectedPersonName: party.expectedPersonName,
          pickupLocationLabel: base.pickupLocationLabel ?? party.pickupLocationLabel,
          deliveryLocationLabel: base.deliveryLocationLabel ?? party.deliveryLocationLabel,
        };
      }
    }
    return base;
  };

  const resolveValidFaceOverlay = async (
    requireReceiverPurpose: boolean,
  ): Promise<ActiveAuthOverlayState | null> => {
    if (requireReceiverPurpose && strictPurpose !== 'DELIVERY_RECEIVER') {
      return null;
    }
    const faceWin = await deps.getFaceWindow(jobId).catch(() => null);
    const faceExpiresMs = faceWin ? Date.parse(faceWin.expiresAt) : NaN;
    const matchingFaceWin =
      faceWin &&
      isValidUuid(faceWin.authJobStepId) &&
      isValidUuid(faceWin.sessionId) &&
      faceWin.jobId.toLowerCase() === jobId.toLowerCase() &&
      (!stepId || faceWin.authJobStepId.toLowerCase() === stepId.toLowerCase()) &&
      Number.isFinite(faceExpiresMs) &&
      faceExpiresMs > nowMs
        ? faceWin
        : null;

    if (!matchingFaceWin) {
      return null;
    }
    if (deps.handledStepIds.has(matchingFaceWin.authJobStepId)) {
      return null;
    }
    const sessionKey = buildFaceAuthSessionKey(
      matchingFaceWin.jobId,
      matchingFaceWin.authJobStepId,
      matchingFaceWin.sessionId,
    );
    if (deps.handledSessionKeys?.has(sessionKey)) {
      return null;
    }

    return enrichFaceParty({
      method: 'FACE_VERIFICATION',
      jobId: matchingFaceWin.jobId,
      authJobStepId: matchingFaceWin.authJobStepId,
      sessionId: matchingFaceWin.sessionId,
      robotId: expectedRobot ?? snap.robotId ?? stepInfo?.robotId ?? null,
      stepCode: snap.selectedStepCode ?? stepInfo?.stepCode ?? null,
      purpose: 'DELIVERY_RECEIVER',
      expiresAt: matchingFaceWin.expiresAt,
      startedAt: matchingFaceWin.startedAt ?? null,
      requestCode: stepInfo?.requestCode ?? null,
      serviceRequestId: stepInfo?.serviceRequestId ?? null,
      expectedAccountId: stepInfo?.expectedAccountId ?? null,
      expectedPersonName: stepInfo?.expectedPersonName ?? null,
      pickupLocationLabel: stepInfo?.pickupLocationLabel ?? null,
      deliveryLocationLabel: stepInfo?.deliveryLocationLabel ?? null,
    });
  };

  if (method === 'FACE_VERIFICATION') {
    return resolveValidFaceOverlay(true);
  }

  if (method === 'QR_CODE') {
    const challenge = await deps.getQrWindow(jobId).catch(() => null);
    const matchingQr =
      challenge &&
      (!stepId || challenge.authJobStepId.toLowerCase() === stepId.toLowerCase())
        ? challenge
        : null;
    if (matchingQr) {
      if (deps.handledStepIds.has(matchingQr.authJobStepId)) return null;
      return {
        method: 'QR_CODE',
        jobId: matchingQr.jobId,
        authJobStepId: matchingQr.authJobStepId,
        stepCode: snap.selectedStepCode ?? stepInfo?.stepCode ?? null,
        purpose: matchingQr.purpose ?? qrFallbackPurpose,
        expiresAt: matchingQr.expiresAt,
      };
    }
    if (stepId && stepInfo?.stepStatus === 'RUNNING') {
      return {
        method: 'QR_CODE',
        jobId,
        authJobStepId: stepId,
        stepCode: snap.selectedStepCode ?? stepInfo?.stepCode ?? null,
        purpose: qrFallbackPurpose,
        expiresAt: stepInfo?.expiresAt ?? null,
      };
    }
    return null;
  }

  // Fallback khi /jobs/{id} tạm chưa trả authMethod: dò qr-challenge trước, sau đó face-auth (chỉ cho RECEIVER).
  const challenge = await deps.getQrWindow(jobId).catch(() => null);
  if (challenge && (!stepId || challenge.authJobStepId.toLowerCase() === stepId.toLowerCase())) {
    if (deps.handledStepIds.has(challenge.authJobStepId)) return null;
    return {
      method: 'QR_CODE',
      jobId: challenge.jobId,
      authJobStepId: challenge.authJobStepId,
      stepCode: snap.selectedStepCode ?? stepInfo?.stepCode ?? null,
      purpose: challenge.purpose ?? qrFallbackPurpose,
      expiresAt: challenge.expiresAt,
    };
  }

  const faceOverlay = await resolveValidFaceOverlay(true);
  if (faceOverlay) {
    return faceOverlay;
  }

  if (stepId && stepInfo?.stepStatus === 'RUNNING') {
    return {
      method: 'QR_CODE',
      jobId,
      authJobStepId: stepId,
      stepCode: snap.selectedStepCode ?? stepInfo?.stepCode ?? null,
      purpose: qrFallbackPurpose,
      expiresAt: stepInfo?.expiresAt ?? null,
    };
  }

  return null;
}

export class FaceAuthController {
  private readonly deps: FaceAuthControllerDependencies;
  private readonly pollIntervalMs: number;
  private readonly expectedCameraSource?: string;
  private readonly onStateChange?: (state: FaceAuthViewState) => void;
  private readonly onVerified?: (completedStepId: string, sessionKey?: string) => void;
  private readonly onDismiss?: (
    stepId: string,
    reason: 'expired' | 'cancelled' | 'step_changed',
    sessionKey?: string,
  ) => void;
  private readonly now: () => number;

  private state: FaceAuthViewState;
  private active = true;
  private disposed = false;
  private generationId = 0;
  private hadActiveWindow = false;
  private verifyInFlight = false;
  private pollInFlight = false;
  private partyLoadedKey: string | null = null;
  private windowOpenedAtMs = 0;
  private lastSubmittedFrameAtMs: number | null = null;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: FaceAuthControllerOptions) {
    this.deps = options.deps;
    this.pollIntervalMs = options.pollIntervalMs ?? FACE_POLL_INTERVAL_MS;
    this.expectedCameraSource = options.expectedCameraSource;
    this.onStateChange = options.onStateChange;
    this.onVerified = options.onVerified;
    this.onDismiss = options.onDismiss;
    this.now = options.deps.now ?? (() => getServerNowMs());
    this.state = this.buildInitialState(options.context);
    if (this.state.sessionId) {
      this.hadActiveWindow = true;
      this.windowOpenedAtMs = this.now();
    }
  }

  private computeRemainingSec(expiresAt: string | null): number | null {
    if (!expiresAt) return null;
    const ms = Date.parse(expiresAt);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor((ms - this.now()) / 1000));
  }

  private computeElapsedSec(windowStartedAt: string | null): number | null {
    if (!windowStartedAt) return null;
    const ms = Date.parse(windowStartedAt);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor((this.now() - ms) / 1000));
  }

  private buildInitialState(ctx: FaceAuthInitialContext): FaceAuthViewState {
    const expiresAt = ctx.expiresAt ?? null;
    const sessionId = ctx.sessionId ?? null;
    const windowStartedAt =
      typeof ctx.startedAt === 'string' && Number.isFinite(Date.parse(ctx.startedAt))
        ? ctx.startedAt
        : null;
    const isWindowUnexpired =
      Boolean(sessionId) && (!expiresAt || Date.parse(expiresAt) > this.now());
    const activeSessionId = isWindowUnexpired ? sessionId : null;
    return {
      phase: isWindowUnexpired ? 'scanning' : 'waiting_window',
      jobId: ctx.jobId,
      authJobStepId: ctx.authJobStepId,
      sessionId: activeSessionId,
      sessionKey: buildFaceAuthSessionKey(ctx.jobId, ctx.authJobStepId, activeSessionId),
      robotId: ctx.robotId ?? null,
      purpose: ctx.purpose,
      stepCode: ctx.stepCode ?? null,
      expiresAt,
      windowStartedAt,
      remainingSec: this.computeRemainingSec(expiresAt),
      elapsedSec: this.computeElapsedSec(windowStartedAt),
      requestCode: ctx.requestCode ?? null,
      serviceRequestId: ctx.serviceRequestId ?? null,
      expectedAccountId: ctx.expectedAccountId ?? null,
      expectedPersonName: ctx.expectedPersonName ?? null,
      pickupLocationLabel: ctx.pickupLocationLabel ?? null,
      deliveryLocationLabel: ctx.deliveryLocationLabel ?? null,
      verifyInFlight: false,
      lastVerifyReason: null,
      feedbackMessage: isWindowUnexpired
        ? null
        : 'Đang chờ máy chủ mở cửa sổ quét khuôn mặt...',
      isOffline: false,
      compartmentLocked: true,
    };
  }

  public getState(): FaceAuthViewState {
    return { ...this.state };
  }

  private emit(patch: Partial<FaceAuthViewState>) {
    if (this.disposed) return;
    const nextJobId = patch.jobId ?? this.state.jobId;
    const nextStepId = patch.authJobStepId ?? this.state.authJobStepId;
    const nextSessionId = patch.sessionId !== undefined ? patch.sessionId : this.state.sessionId;
    const nextExpiresAt = patch.expiresAt !== undefined ? patch.expiresAt : this.state.expiresAt;
    const nextStartedAt =
      patch.windowStartedAt !== undefined ? patch.windowStartedAt : this.state.windowStartedAt;
    this.state = {
      ...this.state,
      ...patch,
      sessionKey: buildFaceAuthSessionKey(nextJobId, nextStepId, nextSessionId),
      remainingSec:
        patch.remainingSec !== undefined
          ? patch.remainingSec
          : this.computeRemainingSec(nextExpiresAt),
      elapsedSec:
        patch.elapsedSec !== undefined
          ? patch.elapsedSec
          : this.computeElapsedSec(nextStartedAt),
    };
    this.onStateChange?.(this.getState());
  }

  private isCurrent(gen: number): boolean {
    return !this.disposed && this.generationId === gen;
  }

  private stopTimers() {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private isTerminalPhase(): boolean {
    return ['verified', 'expired', 'cancelled', 'step_changed'].includes(this.state.phase);
  }

  public start() {
    if (this.disposed) return;
    this.generationId += 1;
    const gen = this.generationId;
    this.onStateChange?.(this.getState());
    if (!this.active) return;
    this.startCountdownTimer(gen);
    void this.pollOnce(gen);
    void this.ensurePartyLoaded(gen);
  }

  /**
   * Tạm dừng / khôi phục khi app xuống nền hoặc quay lại mà tuyệt đối không gia hạn hay reset expiresAt.
   */
  public setActive(nextActive: boolean) {
    if (this.disposed) return;
    if (this.active === nextActive) return;
    this.active = nextActive;
    if (!nextActive) {
      this.stopTimers();
      return;
    }
    if (this.isTerminalPhase()) return;
    if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= this.now()) {
      this.transitionToTerminal('expired', 'Cửa sổ xác thực khuôn mặt đã hết hạn.', {
        isOffline: false,
      });
      return;
    }
    this.emit({
      remainingSec: this.computeRemainingSec(this.state.expiresAt),
      elapsedSec: this.computeElapsedSec(this.state.windowStartedAt),
    });
    this.startCountdownTimer(this.generationId);
    void this.pollOnce(this.generationId);
    void this.ensurePartyLoaded(this.generationId);
  }

  /**
   * Chuyển ngữ cảnh sang chặng/bước/job mới (xóa sạch session cũ tránh dùng nhầm đầu gửi cho đầu nhận).
   */
  public rebindContext(next: FaceAuthInitialContext) {
    if (this.disposed) return;
    this.stopTimers();
    this.generationId += 1;
    this.hadActiveWindow = Boolean(next.sessionId);
    this.verifyInFlight = false;
    this.pollInFlight = false;
    this.partyLoadedKey = null;
    this.windowOpenedAtMs = next.sessionId ? this.now() : 0;
    this.lastSubmittedFrameAtMs = null;
    this.state = this.buildInitialState(next);
    const gen = this.generationId;
    this.onStateChange?.(this.getState());
    if (!this.active) return;
    this.startCountdownTimer(gen);
    void this.pollOnce(gen);
    void this.ensurePartyLoaded(gen);
  }

  private startCountdownTimer(gen: number) {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
    }
    this.countdownTimer = setInterval(() => {
      if (!this.isCurrent(gen) || !this.active || this.isTerminalPhase()) return;
      const nextRemaining = this.computeRemainingSec(this.state.expiresAt);
      const nextElapsed = this.computeElapsedSec(this.state.windowStartedAt);
      if (nextRemaining !== this.state.remainingSec || nextElapsed !== this.state.elapsedSec) {
        this.emit({ remainingSec: nextRemaining, elapsedSec: nextElapsed });
      }
      if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= this.now()) {
        void this.pollOnce(gen);
      }
    }, 1_000);
  }

  private scheduleNextPoll(gen: number) {
    if (!this.isCurrent(gen) || !this.active || this.isTerminalPhase()) return;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => {
      void this.pollOnce(gen);
    }, this.pollIntervalMs);
  }

  private async ensurePartyLoaded(gen: number) {
    if (!this.deps.loadPartyInfo) return;
    const { serviceRequestId, purpose, expectedAccountId, expectedPersonName } = this.state;
    if (expectedPersonName || (!serviceRequestId && !expectedAccountId)) return;
    const key = `${serviceRequestId ?? ''}:${purpose}:${expectedAccountId ?? ''}`;
    if (this.partyLoadedKey === key) return;
    this.partyLoadedKey = key;
    try {
      const party = await this.deps.loadPartyInfo(serviceRequestId, purpose, expectedAccountId);
      if (!this.isCurrent(gen)) return;
      this.emit({
        requestCode: this.state.requestCode ?? party.requestCode,
        expectedAccountId: this.state.expectedAccountId ?? party.expectedAccountId,
        expectedPersonName: party.expectedPersonName ?? this.state.expectedPersonName,
        pickupLocationLabel: this.state.pickupLocationLabel ?? party.pickupLocationLabel,
        deliveryLocationLabel:
          this.state.deliveryLocationLabel ?? party.deliveryLocationLabel,
      });
    } catch {
      // Bỏ qua lỗi phụ khi tra cứu tên người nhận
    }
  }

  private checkAuthoritativeVerified(stepInfo: JobQrStepStatusResult | null): boolean {
    if (!stepInfo || !stepInfo.verified) return false;
    if (stepInfo.jobId && stepInfo.jobId.toLowerCase() !== this.state.jobId.toLowerCase()) {
      return false;
    }
    if (
      stepInfo.authJobStepId &&
      stepInfo.authJobStepId.toLowerCase() !== this.state.authJobStepId.toLowerCase()
    ) {
      return false;
    }
    if (stepInfo.purpose && stepInfo.purpose !== this.state.purpose) {
      return false;
    }
    if (stepInfo.verifiedPurpose && stepInfo.verifiedPurpose !== this.state.purpose) {
      return false;
    }
    if (stepInfo.authMethod && stepInfo.authMethod !== 'FACE_VERIFICATION') {
      return false;
    }
    if (
      this.state.expectedAccountId &&
      stepInfo.verifiedActorAccountId &&
      this.state.expectedAccountId.toLowerCase() !== stepInfo.verifiedActorAccountId.toLowerCase()
    ) {
      return false;
    }
    return true;
  }

  private transitionToTerminal(
    phase: 'verified' | 'expired' | 'cancelled' | 'step_changed',
    feedbackMessage: string,
    extra: Partial<FaceAuthViewState> = {},
  ) {
    const stepId = this.state.authJobStepId;
    const priorSessionKey = this.state.sessionKey;
    this.stopTimers();
    this.verifyInFlight = false;
    this.emit({
      phase,
      sessionId: phase === 'verified' ? this.state.sessionId : null,
      verifyInFlight: false,
      feedbackMessage,
      compartmentLocked: true,
      ...extra,
    });
    if (phase === 'verified') {
      this.onVerified?.(stepId, priorSessionKey);
    } else {
      this.onDismiss?.(stepId, phase, priorSessionKey);
    }
  }

  public async pollOnce(gen = this.generationId): Promise<void> {
    if (!this.isCurrent(gen) || this.isTerminalPhase() || this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    const targetJobId = this.state.jobId;
    const targetStepId = this.state.authJobStepId;
    const targetRobotId = this.state.robotId;

    try {
      const [faceResult, stepResult] = await Promise.all([
        this.deps
          .getFaceWindow(targetJobId)
          .then((window) => ({ ok: true as const, window }))
          .catch(() => ({ ok: false as const, window: null })),
        this.deps
          .checkJobStepStatus(targetJobId, targetStepId)
          .then((info) => ({ ok: true as const, info }))
          .catch(() => ({ ok: false as const, info: null })),
      ]);

      if (!this.isCurrent(gen) || this.isTerminalPhase()) return;

      const stepInfo = stepResult.info;
      const faceWin = faceResult.window;

      // Xác minh job/robot không bị lệch phạm vi
      if (stepInfo) {
        if (stepInfo.jobId && stepInfo.jobId.toLowerCase() !== targetJobId.toLowerCase()) {
          this.transitionToTerminal('cancelled', 'Phiên xác thực không khớp nhiệm vụ hiện tại.');
          return;
        }
        if (
          targetRobotId &&
          stepInfo.robotId &&
          stepInfo.robotId.toLowerCase() !== targetRobotId.toLowerCase()
        ) {
          this.transitionToTerminal('cancelled', 'Nhiệm vụ đã chuyển sang robot khác.');
          return;
        }
        // Đồng bộ metadata người nhận & địa điểm từ BE nếu chưa có
        this.emit({
          serviceRequestId: this.state.serviceRequestId ?? stepInfo.serviceRequestId ?? null,
          requestCode: this.state.requestCode ?? stepInfo.requestCode ?? null,
          expectedAccountId: this.state.expectedAccountId ?? stepInfo.expectedAccountId ?? null,
          expectedPersonName: this.state.expectedPersonName ?? stepInfo.expectedPersonName ?? null,
          pickupLocationLabel:
            this.state.pickupLocationLabel ?? stepInfo.pickupLocationLabel ?? null,
          deliveryLocationLabel:
            this.state.deliveryLocationLabel ?? stepInfo.deliveryLocationLabel ?? null,
        });
        void this.ensurePartyLoaded(gen);
      }

      // 1. Chỉ công nhận thành công khi BE xác nhận đúng bước + đúng chặng
      if (this.checkAuthoritativeVerified(stepInfo)) {
        this.transitionToTerminal('verified', 'Xác thực khuôn mặt thành công!', {
          isOffline: false,
          lastVerifyReason: 'MATCH',
        });
        return;
      }

      // 2. Hủy job / dừng bước / bước thất bại
      if (isJobOrStepTerminalFailure(stepInfo)) {
        this.transitionToTerminal('cancelled', 'Nhiệm vụ hoặc bước xác thực đã bị hủy.');
        return;
      }

      // 3. Phát hiện mất kết nối khi không thể liên lạc được cả 2 đầu API
      if (!faceResult.ok || (!faceWin && !stepInfo)) {
        if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= this.now()) {
          this.transitionToTerminal('expired', 'Cửa sổ xác thực khuôn mặt đã hết hạn.', {
            isOffline: !faceResult.ok || !stepResult.ok,
          });
          return;
        }
        this.emit({
          isOffline: true,
          feedbackMessage: 'Mất kết nối máy chủ. Đang thử đồng bộ lại phiên xác thực...',
        });
        return;
      }

      // 4. Đổi phương thức hoặc chuyển bước sang step khác
      if (stepInfo?.authMethod && stepInfo.authMethod !== 'FACE_VERIFICATION') {
        this.transitionToTerminal('step_changed', 'Phương thức xác thực của bước đã thay đổi.');
        return;
      }
      if (
        stepInfo?.selectedJobStepId &&
        stepInfo.selectedJobStepId.toLowerCase() !== targetStepId.toLowerCase()
      ) {
        this.transitionToTerminal('step_changed', 'Robot đã chuyển sang bước khác.');
        return;
      }

      // 5. Khi nhận 200 từ GET /face-auth
      if (faceWin) {
        if (faceWin.jobId.toLowerCase() !== targetJobId.toLowerCase()) {
          this.emit({
            isOffline: false,
            feedbackMessage: 'Phiên cửa sổ nhận về không khớp Job hiện tại.',
          });
          return;
        }
        if (faceWin.authJobStepId.toLowerCase() !== targetStepId.toLowerCase()) {
          this.transitionToTerminal('step_changed', 'Hệ thống đã chuyển sang chặng/bước mới.');
          return;
        }
        const incomingExpiresMs = Date.parse(faceWin.expiresAt);
        if (!Number.isFinite(incomingExpiresMs) || incomingExpiresMs <= this.now()) {
          this.transitionToTerminal('expired', 'Cửa sổ xác thực khuôn mặt đã hết hạn.', {
            isOffline: false,
          });
          return;
        }

        const isSameSession =
          this.state.sessionId !== null &&
          faceWin.sessionId.toLowerCase() === this.state.sessionId.toLowerCase();
        // Reconnect/rerender không bao giờ gia hạn hạn chót expiresAt của cùng sessionId
        let effectiveExpiresAt = faceWin.expiresAt;
        if (isSameSession && this.state.expiresAt) {
          const currentExpiresMs = Date.parse(this.state.expiresAt);
          if (Number.isFinite(currentExpiresMs) && currentExpiresMs < incomingExpiresMs) {
            effectiveExpiresAt = this.state.expiresAt;
          }
        }

        if (!isSameSession) {
          this.windowOpenedAtMs = this.now();
          this.lastSubmittedFrameAtMs = null;
        }
        const nextVerifyReason = isSameSession ? this.state.lastVerifyReason : null;
        this.hadActiveWindow = true;
        this.emit({
          phase: this.verifyInFlight ? 'verifying' : 'scanning',
          sessionId: faceWin.sessionId,
          expiresAt: effectiveExpiresAt,
          windowStartedAt:
            faceWin.startedAt ?? (isSameSession ? this.state.windowStartedAt : null),
          lastVerifyReason: nextVerifyReason,
          isOffline: false,
          feedbackMessage:
            nextVerifyReason && nextVerifyReason !== 'MATCH'
              ? mapFaceVerifyReasonToMessage(nextVerifyReason)
              : null,
        });
        return;
      }

      // 6. Khi GET /face-auth trả về 204 (faceWin === null) nhưng kết nối BE vẫn sống
      const effectiveExpiresAt = this.state.expiresAt ?? stepInfo?.expiresAt ?? null;
      if (effectiveExpiresAt && Date.parse(effectiveExpiresAt) <= this.now()) {
        this.transitionToTerminal('expired', 'Cửa sổ xác thực khuôn mặt đã hết hạn.', {
          isOffline: false,
        });
        return;
      }

      if (stepInfo?.jobStatus === 'SUCCEEDED') {
        this.transitionToTerminal('step_changed', 'Nhiệm vụ đã kết thúc nhưng bước chưa được xác nhận.');
        return;
      }

      // Chưa có cửa sổ Face (204) -> giữ trạng thái chờ thực tế, không bao giờ tự báo thành công
      this.emit({
        phase: 'waiting_window',
        sessionId: null,
        expiresAt: effectiveExpiresAt,
        isOffline: false,
        feedbackMessage: this.hadActiveWindow
          ? 'Cửa sổ quét tạm đóng. Đang chờ máy chủ mở lại hoặc cập nhật bước...'
          : 'Đang chờ máy chủ mở cửa sổ quét khuôn mặt (HTTP 204)...',
      });
    } finally {
      this.pollInFlight = false;
      this.scheduleNextPoll(gen);
    }
  }

  /**
   * Gửi khung hình JPEG base64 mới khi thành phần này được cấp quyền sở hữu camera và transportSessionId MQTT thật.
   * Mặc định Tablet để Pi (StaffFaceScanner) đảm nhiệm; hàm này dùng khi cần gửi trực tiếp với phiên thật hoặc kiểm thử hợp đồng.
   */
  public async submitFrame(frame: FaceAuthCameraFrame): Promise<FaceFrameSubmitResult> {
    if (this.disposed || this.isTerminalPhase()) {
      return {
        submitted: false,
        reason: 'DISPOSED',
        message: 'Phiên xác thực đã đóng.',
      };
    }
    if (this.verifyInFlight) {
      return {
        submitted: false,
        reason: 'IN_FLIGHT',
        message: 'Đang xử lý khung hình trước đó, chặn gửi trùng.',
      };
    }
    if (!this.deps.verifyFace) {
      return {
        submitted: false,
        reason: 'VERIFIER_UNAVAILABLE',
        message: 'Camera trên thân robot (Raspberry Pi) đang đảm nhận chụp và gửi ảnh.',
      };
    }

    const { jobId, authJobStepId, sessionId, expiresAt, purpose } = this.state;
    if (!sessionId) {
      return {
        submitted: false,
        reason: 'NO_ACTIVE_WINDOW',
        message: 'Chưa có cửa sổ quét khuôn mặt đang hoạt động.',
      };
    }
    const nowMs = this.now();
    if (expiresAt && Date.parse(expiresAt) <= nowMs) {
      this.transitionToTerminal('expired', 'Cửa sổ xác thực khuôn mặt đã hết hạn.');
      return {
        submitted: false,
        reason: 'EXPIRED',
        message: 'Cửa sổ xác thực khuôn mặt đã hết hạn.',
      };
    }

    if (
      this.expectedCameraSource &&
      frame.cameraSource &&
      frame.cameraSource !== this.expectedCameraSource
    ) {
      return {
        submitted: false,
        reason: 'INVALID_FRAME',
        message: 'Khung hình không đến từ nguồn camera được cấu hình.',
      };
    }

    if (
      typeof frame.width === 'number' &&
      (frame.width <= 0 || frame.width > MAX_RECOMMENDED_WIDTH)
    ) {
      return {
        submitted: false,
        reason: 'INVALID_FRAME',
        message: `Chiều rộng ảnh phải từ 1 đến ${MAX_RECOMMENDED_WIDTH}px.`,
      };
    }
    if (
      typeof frame.height === 'number' &&
      (frame.height <= 0 || frame.height > MAX_RECOMMENDED_HEIGHT)
    ) {
      return {
        submitted: false,
        reason: 'INVALID_FRAME',
        message: `Chiều cao ảnh phải từ 1 đến ${MAX_RECOMMENDED_HEIGHT}px.`,
      };
    }

    if (
      !Number.isFinite(frame.capturedAtMs) ||
      frame.capturedAtMs < this.windowOpenedAtMs ||
      frame.capturedAtMs === this.lastSubmittedFrameAtMs ||
      frame.capturedAtMs > nowMs + MAX_FUTURE_FRAME_SKEW_MS ||
      nowMs - frame.capturedAtMs > MAX_FRAME_AGE_MS
    ) {
      return {
        submitted: false,
        reason: 'STALE_FRAME',
        message: 'Khung hình đã cũ hoặc trùng khung hình đã gửi.',
      };
    }

    let normalizedImage: string;
    try {
      normalizedImage = normalizeFaceJpegBase64(frame.imageBase64);
    } catch (err) {
      return {
        submitted: false,
        reason: 'INVALID_FRAME',
        message: err instanceof Error ? err.message : 'Ảnh JPEG base64 không hợp lệ.',
      };
    }

    const transportSessionId = this.deps.getTransportSessionId?.()?.trim() ?? null;
    if (
      !isValidUuid(transportSessionId) ||
      transportSessionId.toLowerCase() === sessionId.toLowerCase() ||
      transportSessionId.toLowerCase() === jobId.toLowerCase() ||
      transportSessionId.toLowerCase() === authJobStepId.toLowerCase()
    ) {
      return {
        submitted: false,
        reason: 'MISSING_TRANSPORT_SESSION',
        message:
          'Thiếu transportSessionId MQTT thật từ BE/Pi. Không được tự sinh UUID hoặc dùng sessionId cửa sổ Face.',
      };
    }

    const gen = this.generationId;
    this.verifyInFlight = true;
    this.lastSubmittedFrameAtMs = frame.capturedAtMs;
    this.emit({ phase: 'verifying', verifyInFlight: true });

    try {
      const response = await this.deps.verifyFace(jobId, {
        sessionId,
        authJobStepId,
        transportSessionId,
        image: normalizedImage,
      });

      if (
        !this.isCurrent(gen) ||
        this.state.jobId !== jobId ||
        this.state.authJobStepId !== authJobStepId ||
        this.state.sessionId !== sessionId ||
        this.state.purpose !== purpose
      ) {
        return {
          submitted: false,
          reason: 'STALE_CONTEXT',
          message: 'Bỏ qua kết quả về muộn của bước hoặc phiên trước.',
        };
      }

      if (!response.verified) {
        const message = mapFaceVerifyReasonToMessage(response.reason);
        this.emit({
          phase: 'scanning',
          verifyInFlight: false,
          lastVerifyReason: response.reason,
          feedbackMessage: message,
          isOffline: false,
          compartmentLocked: true,
        });
        return { submitted: true, response };
      }

      // Khi verified=true, làm mới trạng thái job/step từ BE trước khi xác nhận UI
      const stepInfo = await this.deps.checkJobStepStatus(jobId, authJobStepId).catch(() => null);
      if (
        !this.isCurrent(gen) ||
        this.state.jobId !== jobId ||
        this.state.authJobStepId !== authJobStepId ||
        this.state.sessionId !== sessionId ||
        this.state.purpose !== purpose
      ) {
        return {
          submitted: false,
          reason: 'STALE_CONTEXT',
          message: 'Bỏ qua kết quả về muộn sau khi bước đã chuyển.',
        };
      }

      if (isJobOrStepTerminalFailure(stepInfo)) {
        this.transitionToTerminal('cancelled', 'Nhiệm vụ đã bị hủy trong lúc xác thực.');
        return { submitted: true, response };
      }

      if (this.checkAuthoritativeVerified(stepInfo)) {
        this.transitionToTerminal('verified', 'Xác thực khuôn mặt thành công!', {
          isOffline: false,
          lastVerifyReason: response.reason || 'MATCH',
        });
      } else {
        this.emit({
          phase: 'scanning',
          verifyInFlight: false,
          isOffline: stepInfo === null,
          feedbackMessage:
            'Đã nhận kết quả khớp, đang đồng bộ xác nhận bước từ hệ thống...',
          compartmentLocked: true,
        });
      }
      return { submitted: true, response };
    } catch (err) {
      if (!this.isCurrent(gen)) {
        return {
          submitted: false,
          reason: 'STALE_CONTEXT',
          message: 'Bỏ qua lỗi mạng của phiên cũ.',
        };
      }
      const message = err instanceof Error ? err.message : 'Lỗi kết nối xác thực khuôn mặt.';
      this.emit({
        phase: this.state.sessionId ? 'scanning' : 'waiting_window',
        verifyInFlight: false,
        feedbackMessage: message,
        compartmentLocked: true,
      });
      return {
        submitted: false,
        reason: 'NETWORK_ERROR',
        message,
      };
    } finally {
      if (this.isCurrent(gen)) {
        this.verifyInFlight = false;
      }
    }
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generationId += 1;
    this.stopTimers();
  }
}
