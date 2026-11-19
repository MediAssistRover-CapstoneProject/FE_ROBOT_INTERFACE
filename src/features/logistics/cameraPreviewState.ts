import type { JobCameraPreviewFrame } from '../../services/api/robotMapService';

export const CAMERA_FRAME_MAX_AGE_MS = 5_000;
export const CAMERA_FRAME_FROZEN_MS = 4_000;
export const CAMERA_MAX_FUTURE_SKEW_MS = 5_000;

export type CameraFeedStatus =
  | 'connecting'
  | 'live'
  | 'stale'
  | 'unavailable_endpoint'
  | 'network_error';

export interface CameraPreviewState {
  sessionKey: string;
  feedStatus: CameraFeedStatus;
  dataUri: string | null;
  capturedAt: string | null;
  revision: string | null;
  lastStatus: number | null;
  lastFreshFrameAtMs: number | null;
  sameFrameSinceMs: number | null;
  lastSignature: string | null;
  errorMessage: string | null;
}

export function createInitialCameraPreviewState(sessionKey: string): CameraPreviewState {
  return {
    sessionKey,
    feedStatus: 'connecting',
    dataUri: null,
    capturedAt: null,
    revision: null,
    lastStatus: null,
    lastFreshFrameAtMs: null,
    sameFrameSinceMs: null,
    lastSignature: null,
    errorMessage: null,
  };
}

function buildFrameSignature(response: JobCameraPreviewFrame): string {
  const dataUri = response.dataUri ?? '';
  return `${response.revision ?? ''}|${response.capturedAt ?? ''}|${dataUri.length}|${dataUri.slice(-24)}`;
}

function parseNumericRevision(rev: string | null | undefined): number | null {
  if (typeof rev !== 'string') return null;
  const trimmed = rev.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

export function applyCameraPreviewResponse(
  prev: CameraPreviewState,
  response: JobCameraPreviewFrame,
  nowMs: number,
  expectedSessionKey: string,
): CameraPreviewState {
  // Bỏ qua response đến muộn sau khi đã đổi sang phiên khác
  if (prev.sessionKey !== expectedSessionKey) {
    return prev;
  }

  // HTTP 204: không có khung hình mới — tuyệt đối xóa ảnh cũ để không giữ nhãn "Camera trực tiếp"
  if (response.status === 204) {
    return {
      ...prev,
      feedStatus: 'connecting',
      dataUri: null,
      capturedAt: null,
      revision: null,
      lastStatus: 204,
      lastFreshFrameAtMs: null,
      sameFrameSinceMs: null,
      lastSignature: null,
      errorMessage:
        response.errorMessage ?? 'Chưa có khung hình mới từ camera robot (HTTP 204).',
    };
  }

  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return {
      ...prev,
      feedStatus: 'unavailable_endpoint',
      dataUri: null,
      capturedAt: null,
      revision: null,
      lastStatus: response.status,
      lastFreshFrameAtMs: null,
      sameFrameSinceMs: null,
      lastSignature: null,
      errorMessage:
        response.errorMessage ??
        `Máy chủ chưa hỗ trợ luồng preview camera cho tác vụ này (HTTP ${response.status}).`,
    };
  }

  if (response.status === 0 || response.status >= 500) {
    return {
      ...prev,
      feedStatus: 'network_error',
      dataUri: null,
      capturedAt: null,
      revision: null,
      lastStatus: response.status,
      lastFreshFrameAtMs: null,
      sameFrameSinceMs: null,
      lastSignature: null,
      errorMessage:
        response.errorMessage ?? 'Mất kết nối mạng tới máy chủ camera.',
    };
  }

  if (response.status === 200 && response.dataUri) {
    const capturedAt = response.capturedAt ?? null;
    if (capturedAt !== null && capturedAt.trim().length > 0) {
      const capturedMs = Date.parse(capturedAt);
      if (
        !Number.isFinite(capturedMs) ||
        nowMs - capturedMs > CAMERA_FRAME_MAX_AGE_MS ||
        capturedMs - nowMs > CAMERA_MAX_FUTURE_SKEW_MS
      ) {
        return {
          ...prev,
          feedStatus: 'stale',
          dataUri: null,
          capturedAt,
          revision: response.revision ?? null,
          lastStatus: 200,
          lastFreshFrameAtMs: null,
          sameFrameSinceMs: null,
          errorMessage: 'Khung hình camera đã quá cũ.',
        };
      }

      const prevCapturedMs = prev.capturedAt ? Date.parse(prev.capturedAt) : NaN;
      if (Number.isFinite(prevCapturedMs) && capturedMs < prevCapturedMs) {
        return {
          ...prev,
          feedStatus: 'stale',
          dataUri: null,
          lastStatus: 200,
          lastFreshFrameAtMs: null,
          sameFrameSinceMs: null,
          errorMessage: 'Nhận khung hình camera cũ hơn khung hình trước đó.',
        };
      }
    }

    const prevRev = parseNumericRevision(prev.revision);
    const nextRev = parseNumericRevision(response.revision);
    if (prevRev !== null && nextRev !== null && nextRev < prevRev) {
      return {
        ...prev,
        feedStatus: 'stale',
        dataUri: null,
        lastStatus: 200,
        lastFreshFrameAtMs: null,
        sameFrameSinceMs: null,
        errorMessage: 'Thứ tự revision khung hình camera không hợp lệ (khung cũ).',
      };
    }

    const signature = buildFrameSignature(response);
    if (signature === prev.lastSignature && prev.sameFrameSinceMs !== null) {
      if (prev.feedStatus === 'stale' || nowMs - prev.sameFrameSinceMs >= CAMERA_FRAME_FROZEN_MS) {
        return {
          ...prev,
          feedStatus: 'stale',
          dataUri: null,
          lastStatus: 200,
          lastFreshFrameAtMs: null,
          errorMessage: 'Hình ảnh camera bị đứng (không cập nhật khung hình mới).',
        };
      }
      return {
        ...prev,
        feedStatus: 'live',
        dataUri: prev.dataUri ?? response.dataUri,
        lastStatus: 200,
        errorMessage: null,
      };
    }

    return {
      ...prev,
      feedStatus: 'live',
      dataUri: response.dataUri,
      capturedAt,
      revision: response.revision ?? null,
      lastStatus: 200,
      lastFreshFrameAtMs: nowMs,
      sameFrameSinceMs: nowMs,
      lastSignature: signature,
      errorMessage: null,
    };
  }

  return {
    ...prev,
    feedStatus: 'connecting',
    dataUri: null,
    capturedAt: null,
    revision: null,
    lastStatus: response.status,
    lastFreshFrameAtMs: null,
    sameFrameSinceMs: null,
    errorMessage: response.errorMessage ?? 'Đang kết nối camera robot...',
  };
}

export function evaluateCameraPreviewFreshness(
  state: CameraPreviewState,
  nowMs: number,
): CameraPreviewState {
  if (state.feedStatus !== 'live') {
    return state;
  }

  const capturedMs = state.capturedAt ? Date.parse(state.capturedAt) : NaN;
  const isCapturedExpired =
    Number.isFinite(capturedMs) && nowMs - capturedMs > CAMERA_FRAME_MAX_AGE_MS;
  const isReceiveExpired =
    state.lastFreshFrameAtMs !== null && nowMs - state.lastFreshFrameAtMs > CAMERA_FRAME_MAX_AGE_MS;

  if (!isCapturedExpired && !isReceiveExpired) {
    return state;
  }

  return {
    ...state,
    feedStatus: 'stale',
    dataUri: null,
    lastFreshFrameAtMs: null,
    errorMessage: 'Hình ảnh camera đã ngừng cập nhật. Đang kết nối lại...',
  };
}

export function getCameraFeedLabel(feedStatus: CameraFeedStatus, isOffline: boolean): string {
  if (isOffline || feedStatus === 'network_error') {
    return 'Mất kết nối mạng';
  }
  if (feedStatus === 'live') {
    return 'Camera trực tiếp';
  }
  if (feedStatus === 'stale') {
    return 'Khung hình bị đứng · Đang kết nối lại';
  }
  return 'Đang kết nối camera robot';
}
