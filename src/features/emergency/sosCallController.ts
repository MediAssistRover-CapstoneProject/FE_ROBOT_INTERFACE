import { generateUuid } from '../../services/api/config';
import {
  DeviceIncidentStatusResponse,
  DeviceMediaSessionEvent,
  DeviceMediaSessionView,
  SosResponse,
  SosRoutingStatus,
} from '../../services/api/types';

export type MedicalIncidentState =
  | 'INITIALIZING'
  | 'SENDING'
  | 'SENT_WAITING'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'FALSE_ALARM'
  | 'FAILED';

export type MediaCallState =
  | 'WAITING_STAFF'
  | 'CONNECTING_MEDIA'
  | 'CONNECTED'
  | 'RING_TIMED_OUT'
  | 'MEDIA_ERROR'
  | 'ENDED';

export interface SosApiLogSnapshot {
  lastCall: string;
  lastResult: string;
  status: string;
  latencyMs: number;
}

export interface SosCallSnapshot {
  incidentState: MedicalIncidentState;
  callState: MediaCallState;
  incidentId: string | null;
  robotId: string | null;
  mediaSessionId: string | null;
  sosRoutingStatus: SosRoutingStatus | null;
  errorMessage: string | null;
  unansweredNotice: string | null;
  isRingingSession: boolean;
  isRetrying: boolean;
  operationKey: string;
  apiLogs: SosApiLogSnapshot;
}

export interface SosTriggerParams {
  description: string;
  severity: 'WARNING' | 'CRITICAL';
  xM?: number;
  yM?: number;
  mapId?: string;
  operationKey: string;
}

export interface SosCallControllerDependencies {
  triggerSos: (params: SosTriggerParams) => Promise<SosResponse>;
  getIncidentStatus: (incidentId: string) => Promise<DeviceIncidentStatusResponse>;
  getDeviceMediaSession: () => Promise<DeviceMediaSessionEvent | null>;
  subscribeMediaEvents?: (
    onEvent: (event: DeviceMediaSessionEvent) => void,
    onError?: (err: unknown) => void,
  ) => () => void;
  getRobotId?: () => string | null;
}

export interface SosCallControllerOptions {
  deps: SosCallControllerDependencies;
  sosParams: Omit<SosTriggerParams, 'operationKey'>;
  operationKey?: string;
  ringTimeoutMs?: number;
  pollIntervalMs?: number;
  returnDelayMs?: number;
  onStateChange?: (snapshot: SosCallSnapshot) => void;
  onNavigateBackToMap?: () => void;
}

// Verified against BE MediaProperties (`app.media.ring-timeout-sec`, default 60s).
// Do not derive ring timeout from `session.expiresAt` (`app.media.session-max-sec`, default 1800s).
export const SOS_RING_TIMEOUT_SEC = 60;
export const SOS_RING_TIMEOUT_MS = SOS_RING_TIMEOUT_SEC * 1000;
export const SOS_POLL_INTERVAL_MS = 2500;
export const SOS_TIMEOUT_RETURN_DELAY_MS = 2200;
export const SOS_RING_NULL_GRACE_MS = 5000;
export const SOS_UNANSWERED_NOTICE = 'Chưa có nhân viên bắt máy. Yêu cầu SOS đã được gửi';

const TERMINAL_INCIDENT_STATES = new Set<string>(['RESOLVED', 'CLOSED', 'FALSE_ALARM']);

function normalizeUuid(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function isMatchingSosMediaSession(
  session: DeviceMediaSessionView | null | undefined,
  expectedIncidentId: string | null,
  expectedRobotId?: string | null,
): session is DeviceMediaSessionView {
  if (!session || !session.sessionId) return false;
  if (typeof session.mode === 'string' && session.mode.toUpperCase() === 'MONITOR') {
    return false;
  }

  const targetIncident = normalizeUuid(expectedIncidentId);
  const sessionIncident = normalizeUuid(session.incidentId);
  if (!targetIncident || !sessionIncident || sessionIncident !== targetIncident) {
    return false;
  }

  const targetRobot = normalizeUuid(expectedRobotId);
  const sessionRobot = normalizeUuid(session.robotId);
  if (targetRobot && sessionRobot && sessionRobot !== targetRobot) {
    return false;
  }

  return true;
}

export function isStaffAnsweredMediaState(state?: string | null): boolean {
  if (typeof state !== 'string') return false;
  const upper = state.toUpperCase();
  return upper === 'CONNECTING' || upper === 'ACTIVE' || upper === 'RECONNECTING';
}

export function isServerRingExpiredSession(
  session: DeviceMediaSessionView | null | undefined,
  staffAlreadyAnswered: boolean,
): boolean {
  if (staffAlreadyAnswered || !session || typeof session.state !== 'string') {
    return false;
  }
  const upperState = session.state.toUpperCase();
  const upperReason =
    typeof session.endReason === 'string' ? session.endReason.trim().toUpperCase() : '';

  if (upperState === 'EXPIRED') {
    if (!upperReason) return true;
    return upperReason === 'STAFF_NOT_ANSWERED' || upperReason !== 'SESSION_EXPIRED';
  }
  return upperState === 'ENDED' && upperReason === 'STAFF_NOT_ANSWERED';
}

export function createSosCallController(options: SosCallControllerOptions) {
  const {
    deps,
    sosParams,
    operationKey = generateUuid(),
    ringTimeoutMs = SOS_RING_TIMEOUT_MS,
    pollIntervalMs = SOS_POLL_INTERVAL_MS,
    returnDelayMs = SOS_TIMEOUT_RETURN_DELAY_MS,
    onStateChange,
    onNavigateBackToMap,
  } = options;

  const frozenTriggerParams: SosTriggerParams = {
    description: sosParams.description,
    severity: sosParams.severity,
    xM: sosParams.xM,
    yM: sosParams.yM,
    mapId: sosParams.mapId,
    operationKey,
  };

  let state: SosCallSnapshot = {
    incidentState: 'INITIALIZING',
    callState: 'WAITING_STAFF',
    incidentId: null,
    robotId: normalizeUuid(deps.getRobotId?.()),
    mediaSessionId: null,
    sosRoutingStatus: null,
    errorMessage: null,
    unansweredNotice: null,
    isRingingSession: false,
    isRetrying: false,
    operationKey,
    apiLogs: {
      lastCall: 'POST /api/v1/pi/incidents/sos',
      lastResult: 'Chuẩn bị gửi tín hiệu cấp cứu SOS...',
      status: 'READY',
      latencyMs: 0,
    },
  };

  let generationId = 1;
  let disposed = false;
  let hasStarted = false;
  let isSending = false;
  let staffAnswered = false;
  let timedOut = false;
  let isFinalizingTimeout = false;
  let observedRingingSessionId: string | null = null;
  let trackingStartedAtMs = 0;

  let ringTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let autoReturnTimer: ReturnType<typeof setTimeout> | null = null;
  let sseUnsubscribe: (() => void) | null = null;

  const isStale = (capturedGen: number) => disposed || capturedGen !== generationId;

  const isTerminalIncident = () => TERMINAL_INCIDENT_STATES.has(state.incidentState);

  const emit = () => {
    if (disposed) return;
    onStateChange?.({ ...state, apiLogs: { ...state.apiLogs } });
  };

  const patchState = (partial: Partial<SosCallSnapshot>) => {
    state = { ...state, ...partial };
    emit();
  };

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  };

  const stopRingTimer = () => {
    clearTimer(ringTimeoutTimer);
    ringTimeoutTimer = null;
  };

  const stopPollingAndStreams = () => {
    clearTimer(pollTimer);
    pollTimer = null;
    if (sseUnsubscribe) {
      const unsubscribe = sseUnsubscribe;
      sseUnsubscribe = null;
      unsubscribe();
    }
  };

  const stopAllAsyncWork = () => {
    stopRingTimer();
    stopPollingAndStreams();
    clearTimer(autoReturnTimer);
    autoReturnTimer = null;
  };

  const enterRingTimedOutState = (capturedGen: number) => {
    if (isStale(capturedGen) || staffAnswered || timedOut || isTerminalIncident()) {
      return;
    }
    timedOut = true;
    isFinalizingTimeout = false;
    stopRingTimer();
    stopPollingAndStreams();

    patchState({
      callState: 'RING_TIMED_OUT',
      isRingingSession: false,
      unansweredNotice: SOS_UNANSWERED_NOTICE,
    });

    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      if (isStale(capturedGen) || staffAnswered) return;
      onNavigateBackToMap?.();
    }, returnDelayMs);
  };

  const applyMediaEvent = (
    mediaEvent: DeviceMediaSessionEvent | null | undefined,
    capturedGen: number,
  ) => {
    if (isStale(capturedGen) || timedOut || !state.incidentId) return;
    if (mediaEvent == null) return;

    const session = mediaEvent.session ?? null;

    if (!session) {
      const elapsedMs = trackingStartedAtMs > 0 ? Date.now() - trackingStartedAtMs : 0;
      const nullExpireThresholdMs = Math.max(
        Math.floor(ringTimeoutMs * 0.8),
        ringTimeoutMs - SOS_RING_NULL_GRACE_MS,
      );
      if (observedRingingSessionId && !staffAnswered && elapsedMs >= nullExpireThresholdMs) {
        enterRingTimedOutState(capturedGen);
      }
      return;
    }

    if (!isMatchingSosMediaSession(session, state.incidentId, state.robotId)) {
      return;
    }

    const upperState = typeof session.state === 'string' ? session.state.toUpperCase() : '';

    if (isStaffAnsweredMediaState(upperState)) {
      staffAnswered = true;
      isFinalizingTimeout = false;
      stopRingTimer();
      clearTimer(autoReturnTimer);
      autoReturnTimer = null;

      const nextCallState: MediaCallState =
        upperState === 'ACTIVE' ? 'CONNECTED' : 'CONNECTING_MEDIA';

      patchState({
        mediaSessionId: session.sessionId,
        callState: nextCallState,
        isRingingSession: false,
        unansweredNotice: null,
      });
      return;
    }

    if (isServerRingExpiredSession(session, staffAnswered)) {
      patchState({ mediaSessionId: session.sessionId });
      enterRingTimedOutState(capturedGen);
      return;
    }

    if (upperState === 'RINGING') {
      if (!staffAnswered) {
        observedRingingSessionId = session.sessionId;
        patchState({
          mediaSessionId: session.sessionId,
          callState: 'WAITING_STAFF',
          isRingingSession: true,
        });
      }
      return;
    }

    if (upperState === 'FAILED') {
      stopRingTimer();
      patchState({
        mediaSessionId: session.sessionId,
        callState: 'MEDIA_ERROR',
        isRingingSession: false,
      });
      return;
    }

    if (upperState === 'ENDED' || upperState === 'EXPIRED') {
      stopRingTimer();
      patchState({
        mediaSessionId: session.sessionId,
        callState: 'ENDED',
        isRingingSession: false,
      });
    }
  };

  const applyIncidentStatus = (
    statusRes: DeviceIncidentStatusResponse,
    capturedGen: number,
  ): boolean => {
    if (isStale(capturedGen)) return false;
    const raw = typeof statusRes.status === 'string' ? statusRes.status.toUpperCase() : '';
    let nextIncidentState: MedicalIncidentState = state.incidentState;
    if (raw === 'OPEN' || raw === 'REPORTED') {
      nextIncidentState = 'SENT_WAITING';
    } else if (raw === 'ACKNOWLEDGED') {
      nextIncidentState = 'ACKNOWLEDGED';
    } else if (raw === 'IN_PROGRESS') {
      nextIncidentState = 'IN_PROGRESS';
    } else if (raw === 'RESOLVED') {
      nextIncidentState = 'RESOLVED';
    } else if (raw === 'CLOSED') {
      nextIncidentState = 'CLOSED';
    } else if (raw === 'FALSE_ALARM') {
      nextIncidentState = 'FALSE_ALARM';
    }

    const terminal = TERMINAL_INCIDENT_STATES.has(nextIncidentState);
    if (terminal) {
      stopAllAsyncWork();
      patchState({
        incidentState: nextIncidentState,
        callState: 'ENDED',
        isRingingSession: false,
      });
      return true;
    }

    if (nextIncidentState !== state.incidentState) {
      patchState({ incidentState: nextIncidentState });
    }
    return false;
  };

  const finalizeRingTimeout = async (capturedGen: number) => {
    if (
      isStale(capturedGen) ||
      staffAnswered ||
      timedOut ||
      isTerminalIncident() ||
      isFinalizingTimeout
    ) {
      return;
    }
    isFinalizingTimeout = true;
    try {
      const latestMedia = await deps.getDeviceMediaSession().catch(() => null);
      if (isStale(capturedGen) || staffAnswered || timedOut || isTerminalIncident()) {
        return;
      }
      applyMediaEvent(latestMedia, capturedGen);
      if (isStale(capturedGen) || staffAnswered || timedOut || isTerminalIncident()) {
        return;
      }
      enterRingTimedOutState(capturedGen);
    } finally {
      isFinalizingTimeout = false;
    }
  };

  const runPollOnce = async (capturedGen: number) => {
    if (isStale(capturedGen) || timedOut || isTerminalIncident() || !state.incidentId) {
      return;
    }
    const targetIncidentId = state.incidentId;
    const startMs = Date.now();
    let stoppedByIncident = false;

    try {
      const statusRes = await deps.getIncidentStatus(targetIncidentId);
      if (isStale(capturedGen) || timedOut) return;

      state = {
        ...state,
        apiLogs: {
          lastCall: `GET /api/v1/pi/incidents/${targetIncidentId.slice(0, 8)}...`,
          lastResult: JSON.stringify(statusRes),
          status: '200 OK',
          latencyMs: Date.now() - startMs,
        },
      };
      emit();

      stoppedByIncident = applyIncidentStatus(statusRes, capturedGen);
    } catch (err: unknown) {
      if (isStale(capturedGen) || timedOut) return;
      const pollErrMsg = err instanceof Error ? err.message : String(err);
      patchState({
        apiLogs: {
          ...state.apiLogs,
          lastCall: `GET /api/v1/pi/incidents/${targetIncidentId.slice(0, 8)}...`,
          lastResult: `Polling error: ${pollErrMsg}`,
          status: 'POLL_ERR',
        },
      });
    }

    if (isStale(capturedGen) || timedOut || stoppedByIncident || isTerminalIncident()) {
      return;
    }

    const mediaRes = await deps.getDeviceMediaSession().catch(() => null);
    if (isStale(capturedGen) || timedOut || isTerminalIncident()) {
      return;
    }
    applyMediaEvent(mediaRes, capturedGen);
  };

  const scheduleNextPoll = (capturedGen: number) => {
    if (isStale(capturedGen) || timedOut || isTerminalIncident() || !state.incidentId) {
      return;
    }
    clearTimer(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void (async () => {
        await runPollOnce(capturedGen);
        if (!isStale(capturedGen) && !timedOut && !isTerminalIncident()) {
          scheduleNextPoll(capturedGen);
        }
      })();
    }, pollIntervalMs);
  };

  const beginCallTracking = (capturedGen: number) => {
    if (isStale(capturedGen) || !state.incidentId) return;
    trackingStartedAtMs = Date.now();

    stopAllAsyncWork();

    if (!staffAnswered && !timedOut && !isTerminalIncident()) {
      ringTimeoutTimer = setTimeout(() => {
        ringTimeoutTimer = null;
        void finalizeRingTimeout(capturedGen);
      }, ringTimeoutMs);
    }

    if (deps.subscribeMediaEvents) {
      sseUnsubscribe = deps.subscribeMediaEvents(
        (evt) => {
          applyMediaEvent(evt, capturedGen);
        },
        () => {
          // Polling remains active as the resilient fallback when SSE disconnects
        },
      );
    }

    scheduleNextPoll(capturedGen);
  };

  const sendSosInternal = async (capturedGen: number) => {
    if (isStale(capturedGen) || isSending) return;
    isSending = true;

    patchState({
      isRetrying: true,
      errorMessage: null,
      unansweredNotice: null,
      incidentState: 'SENDING',
      callState: 'WAITING_STAFF',
      isRingingSession: false,
    });

    const startMs = Date.now();
    try {
      const res = await deps.triggerSos(frozenTriggerParams);
      if (isStale(capturedGen)) return;

      const latency = Date.now() - startMs;
      const assignedId = res?.incident?.incidentId;
      if (!assignedId) {
        throw new Error('Máy chủ không trả về mã sự cố incidentId hợp lệ');
      }

      const resolvedRobotId =
        normalizeUuid(res?.incident?.robotId) ?? normalizeUuid(deps.getRobotId?.());

      patchState({
        incidentId: assignedId,
        robotId: resolvedRobotId,
        sosRoutingStatus: res?.incident?.sosRoutingStatus ?? null,
        incidentState: 'SENT_WAITING',
        callState: 'WAITING_STAFF',
        errorMessage: null,
        unansweredNotice: null,
        isRetrying: false,
        apiLogs: {
          lastCall: 'POST /api/v1/pi/incidents/sos',
          lastResult: JSON.stringify(res),
          status: '200 OK',
          latencyMs: latency,
        },
      });

      beginCallTracking(capturedGen);
    } catch (err: unknown) {
      if (isStale(capturedGen)) return;
      const latency = Date.now() - startMs;
      const msg = err instanceof Error ? err.message : String(err);

      patchState({
        incidentState: 'FAILED',
        callState: 'MEDIA_ERROR',
        errorMessage: msg,
        isRetrying: false,
        apiLogs: {
          lastCall: 'POST /api/v1/pi/incidents/sos',
          lastResult: `Lỗi gửi SOS: ${msg}`,
          status: 'FAILED',
          latencyMs: latency,
        },
      });
    } finally {
      isSending = false;
    }
  };

  return {
    getSnapshot: (): SosCallSnapshot => ({ ...state, apiLogs: { ...state.apiLogs } }),
    start: () => {
      if (disposed || hasStarted) return;
      hasStarted = true;
      void sendSosInternal(generationId);
    },
    retry: () => {
      if (disposed || isSending || state.incidentId) return;
      hasStarted = true;
      void sendSosInternal(generationId);
    },
    exit: () => {
      if (disposed) return;
      generationId += 1;
      disposed = true;
      stopAllAsyncWork();
      onNavigateBackToMap?.();
    },
    dispose: () => {
      if (disposed) return;
      generationId += 1;
      disposed = true;
      stopAllAsyncWork();
    },
  };
}
