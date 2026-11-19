import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_FRAME_FROZEN_MS,
  CAMERA_FRAME_MAX_AGE_MS,
  applyCameraPreviewResponse,
  createInitialCameraPreviewState,
  evaluateCameraPreviewFreshness,
  getCameraFeedLabel,
} from '../src/features/logistics/cameraPreviewState';
import {
  FACE_POLL_INTERVAL_MS,
  FaceAuthController,
  buildFaceAuthSessionKey,
  resolveAuthenticateOverlayForSnapshot,
  shouldOpenAuthOverlay,
} from '../src/features/logistics/faceAuthController';
import type {
  JobQrStepStatusResult,
  RobotSnapshotSummary,
} from '../src/services/api/robotMapService';
import { recordServerTime, resetServerClock } from '../src/services/api/serverClock';
import type {
  FaceVerifyResponse,
  StaffFaceScanWindow,
  StaffQrScanWindow,
} from '../src/services/api/types';

const ROBOT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROBOT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_JOB_ID = '44444444-4444-4444-8444-444444444444';
const SENDER_STEP_ID = '55555555-5555-4555-8555-555555555555';
const RECEIVER_STEP_ID = '66666666-6666-4666-8666-666666666666';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const RECEIVER_SESSION_ID = '88888888-8888-4888-8888-888888888888';
const TRANSPORT_SESSION_ID = '99999999-9999-4999-8999-999999999999';
const SERVICE_REQ_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SENDER_ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECEIVER_ACCOUNT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SAMPLE_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeSnapshot(overrides: Partial<RobotSnapshotSummary> = {}): RobotSnapshotSummary {
  return {
    robotId: ROBOT_ID,
    robotName: 'MediRover #01',
    pose: null,
    isPoseLive: true,
    status: 'BUSY',
    batteryRaw: 8500,
    mqttConnected: true,
    navigationPlan: null,
    activeJobId: JOB_ID,
    selectedJobStepId: RECEIVER_STEP_ID,
    selectedStepType: 'AUTHENTICATE',
    selectedStepCode: 'AUTH_RECEIVER',
    ...overrides,
  };
}

describe('resolveAuthenticateOverlayForSnapshot & shouldOpenAuthOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));
  });

  afterEach(() => {
    resetServerClock();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens receiver FACE_VERIFICATION camera once when BE step is RUNNING, receiver purpose matches, and /face-auth window is unexpired', async () => {
    const getQrWindow = vi.fn<() => Promise<StaffQrScanWindow | null>>(async () => null);
    const expiresAt = new Date(Date.now() + 90_000).toISOString();
    const getFaceWindow = vi.fn<() => Promise<StaffFaceScanWindow | null>>(async () => ({
      jobId: JOB_ID,
      authJobStepId: RECEIVER_STEP_ID,
      sessionId: RECEIVER_SESSION_ID,
      expiresAt,
    }));
    const checkJobStepStatus = vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
      jobId: JOB_ID,
      robotId: ROBOT_ID,
      jobStatus: 'RUNNING',
      stepStatus: 'RUNNING',
      verified: false,
      authJobStepId: RECEIVER_STEP_ID,
      selectedJobStepId: RECEIVER_STEP_ID,
      stepCode: 'AUTH_RECEIVER',
      authMethod: 'FACE_VERIFICATION',
      purpose: 'DELIVERY_RECEIVER',
      serviceRequestId: SERVICE_REQ_ID,
      expectedAccountId: RECEIVER_ACCOUNT_ID,
      expiresAt,
    }));
    const loadPartyInfo = vi.fn(async () => ({
      requestCode: 'DEL-901',
      expectedPersonName: 'ĐD. Trần Thu Hà',
      expectedAccountId: RECEIVER_ACCOUNT_ID,
      pickupLocationLabel: 'Quầy Thuốc',
      deliveryLocationLabel: 'Phòng 01',
    }));

    const overlay = await resolveAuthenticateOverlayForSnapshot(makeSnapshot(), {
      handledStepIds: new Set(),
      handledSessionKeys: new Set(),
      expectedRobotId: ROBOT_ID,
      checkJobStepStatus,
      getQrWindow,
      getFaceWindow,
      loadPartyInfo,
    });

    expect(getQrWindow).not.toHaveBeenCalled();
    expect(getFaceWindow).toHaveBeenCalledWith(JOB_ID);
    expect(overlay).toEqual(
      expect.objectContaining({
        method: 'FACE_VERIFICATION',
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        sessionId: RECEIVER_SESSION_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
        expectedPersonName: 'ĐD. Trần Thu Hà',
        requestCode: 'DEL-901',
        expiresAt,
      }),
    );

    const handledSteps = new Set<string>();
    const handledKeys = new Set<string>();
    expect(shouldOpenAuthOverlay(null, overlay, handledSteps, handledKeys)).toBe(true);
    // Duplicate poll/event for the exact same (jobId, authJobStepId, sessionId) must NOT reopen
    expect(shouldOpenAuthOverlay(overlay, overlay, handledSteps, handledKeys)).toBe(false);

    // After dismissal/completion, handled session key cannot be reopened
    handledKeys.add(buildFaceAuthSessionKey(JOB_ID, RECEIVER_STEP_ID, RECEIVER_SESSION_ID));
    expect(shouldOpenAuthOverlay(null, overlay, handledSteps, handledKeys)).toBe(false);
  });

  it('does NOT open Face camera on HTTP 204, expired window, MOVE step, wrong robotId, or DELIVERY_SENDER', async () => {
    const baseDeps = {
      handledStepIds: new Set<string>(),
      handledSessionKeys: new Set<string>(),
      expectedRobotId: ROBOT_ID,
      getQrWindow: vi.fn<() => Promise<StaffQrScanWindow | null>>(async () => null),
    };

    // 1. HTTP 204 before window opens (must NOT trigger just because step is FACE_VERIFICATION)
    const noWindow = await resolveAuthenticateOverlayForSnapshot(makeSnapshot(), {
      ...baseDeps,
      getFaceWindow: vi.fn(async () => null),
      checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
        jobId: JOB_ID,
        robotId: ROBOT_ID,
        jobStatus: 'RUNNING',
        stepStatus: 'RUNNING',
        verified: false,
        authJobStepId: RECEIVER_STEP_ID,
        selectedJobStepId: RECEIVER_STEP_ID,
        authMethod: 'FACE_VERIFICATION',
        purpose: 'DELIVERY_RECEIVER',
      })),
    });
    expect(noWindow).toBeNull();

    // 2. DELIVERY_SENDER must NOT trigger receiver face camera (even if window exists)
    const senderAttempt = await resolveAuthenticateOverlayForSnapshot(
      makeSnapshot({ selectedJobStepId: SENDER_STEP_ID, selectedStepCode: 'AUTH_SENDER' }),
      {
        ...baseDeps,
        getFaceWindow: vi.fn(async () => ({
          jobId: JOB_ID,
          authJobStepId: SENDER_STEP_ID,
          sessionId: SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          authJobStepId: SENDER_STEP_ID,
          selectedJobStepId: SENDER_STEP_ID,
          stepCode: 'AUTH_SENDER',
          authMethod: 'FACE_VERIFICATION',
          purpose: 'DELIVERY_SENDER',
        })),
      },
    );
    expect(senderAttempt).toBeNull();

    // 3. Moving step (not AUTHENTICATE)
    const movingOverlay = await resolveAuthenticateOverlayForSnapshot(
      makeSnapshot({ selectedStepType: 'MOVE', selectedStepCode: 'MOVE_RECEIVER' }),
      {
        ...baseDeps,
        getFaceWindow: vi.fn(async () => null),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => null),
      },
    );
    expect(movingOverlay).toBeNull();

    // 4. Expired face window
    const expiredOverlay = await resolveAuthenticateOverlayForSnapshot(makeSnapshot(), {
      ...baseDeps,
      getFaceWindow: vi.fn(async () => ({
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        sessionId: RECEIVER_SESSION_ID,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      })),
      checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
        jobId: JOB_ID,
        robotId: ROBOT_ID,
        jobStatus: 'RUNNING',
        stepStatus: 'RUNNING',
        verified: false,
        authJobStepId: RECEIVER_STEP_ID,
        selectedJobStepId: RECEIVER_STEP_ID,
        authMethod: 'FACE_VERIFICATION',
        purpose: 'DELIVERY_RECEIVER',
      })),
    });
    expect(expiredOverlay).toBeNull();

    // 5. Wrong robot scope
    const wrongRobotOverlay = await resolveAuthenticateOverlayForSnapshot(
      makeSnapshot({ robotId: OTHER_ROBOT_ID }),
      {
        ...baseDeps,
        getFaceWindow: vi.fn(async () => ({
          jobId: JOB_ID,
          authJobStepId: RECEIVER_STEP_ID,
          sessionId: RECEIVER_SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn(async () => null),
      },
    );
    expect(wrongRobotOverlay).toBeNull();
  });

  it('branches strictly to QR_CODE when BE reports QR_CODE without calling /face-auth', async () => {
    const getQrWindow = vi.fn<() => Promise<StaffQrScanWindow | null>>(async () => ({
      jobId: JOB_ID,
      authJobStepId: SENDER_STEP_ID,
      purpose: 'DELIVERY_SENDER',
      expiresAt: '2026-11-19T12:00:00Z',
    }));
    const getFaceWindow = vi.fn<() => Promise<StaffFaceScanWindow | null>>(async () => null);
    const checkJobStepStatus = vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
      jobStatus: 'RUNNING',
      stepStatus: 'RUNNING',
      verified: false,
      authMethod: 'QR_CODE',
      purpose: 'DELIVERY_SENDER',
    }));

    const overlay = await resolveAuthenticateOverlayForSnapshot(
      makeSnapshot({ selectedJobStepId: SENDER_STEP_ID, selectedStepCode: 'AUTH_SENDER' }),
      {
        handledStepIds: new Set(),
        checkJobStepStatus,
        getQrWindow,
        getFaceWindow,
      },
    );

    expect(getQrWindow).toHaveBeenCalledWith(JOB_ID);
    expect(getFaceWindow).not.toHaveBeenCalled();
    expect(overlay).toEqual(
      expect.objectContaining({
        method: 'QR_CODE',
        jobId: JOB_ID,
        authJobStepId: SENDER_STEP_ID,
        purpose: 'DELIVERY_SENDER',
      }),
    );
  });

  it('returns null for STAFF_CONFIRMATION and handled steps', async () => {
    const checkJobStepStatus = vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
      jobStatus: 'RUNNING',
      stepStatus: 'RUNNING',
      verified: false,
      authMethod: 'STAFF_CONFIRMATION',
      purpose: 'DELIVERY_RECEIVER',
    }));

    const staffOverlay = await resolveAuthenticateOverlayForSnapshot(makeSnapshot(), {
      handledStepIds: new Set(),
      checkJobStepStatus,
      getQrWindow: vi.fn(async () => null),
      getFaceWindow: vi.fn(async () => null),
    });
    expect(staffOverlay).toBeNull();

    const handledOverlay = await resolveAuthenticateOverlayForSnapshot(makeSnapshot(), {
      handledStepIds: new Set([RECEIVER_STEP_ID]),
      checkJobStepStatus,
      getQrWindow: vi.fn(async () => null),
      getFaceWindow: vi.fn(async () => null),
    });
    expect(handledOverlay).toBeNull();
  });

  it('falls back to receiver FACE_VERIFICATION when job status omits authMethod and /face-auth returns an active receiver window', async () => {
    const overlay = await resolveAuthenticateOverlayForSnapshot(makeSnapshot(), {
      handledStepIds: new Set(),
      expectedRobotId: ROBOT_ID,
      checkJobStepStatus: vi.fn(async () => null),
      getQrWindow: vi.fn(async () => null),
      getFaceWindow: vi.fn(async () => ({
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        sessionId: RECEIVER_SESSION_ID,
        expiresAt: '2026-11-19T12:00:00Z',
      })),
    });

    expect(overlay?.method).toBe('FACE_VERIFICATION');
    if (overlay?.method === 'FACE_VERIFICATION') {
      expect(overlay.sessionId).toBe(RECEIVER_SESSION_ID);
      expect(overlay.purpose).toBe('DELIVERY_RECEIVER');
    }
  });
});

describe('cameraPreviewState', () => {
  const SESSION_KEY_1 = `${JOB_ID}:${RECEIVER_STEP_ID}:${SESSION_ID}`;
  const SESSION_KEY_2 = `${JOB_ID}:${RECEIVER_STEP_ID}:${RECEIVER_SESSION_ID}`;

  it('shows live only for fresh 200 JPEG, and clears image + live badge immediately on HTTP 204', () => {
    const t0 = Date.parse('2026-11-19T10:00:10.000Z');
    let state = createInitialCameraPreviewState(SESSION_KEY_1);
    expect(getCameraFeedLabel(state.feedStatus, false)).toBe('Đang kết nối camera robot');

    state = applyCameraPreviewResponse(
      state,
      {
        status: 200,
        dataUri: `data:image/jpeg;base64,${SAMPLE_JPEG}AAA`,
        capturedAt: new Date(t0 - 200).toISOString(),
        revision: '10',
      },
      t0,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('live');
    expect(state.dataUri).toContain(SAMPLE_JPEG);
    expect(getCameraFeedLabel(state.feedStatus, false)).toBe('Camera trực tiếp');

    // HTTP 204 must NEVER leave the old frame carrying the live badge
    state = applyCameraPreviewResponse(
      state,
      { status: 204, dataUri: null, capturedAt: null, revision: null },
      t0 + 650,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('connecting');
    expect(state.dataUri).toBeNull();
    expect(getCameraFeedLabel(state.feedStatus, false)).toBe('Đang kết nối camera robot');
  });

  it('distinguishes HTTP 404 from network loss and detects stale / frozen / regressive frames', () => {
    const t0 = Date.parse('2026-11-19T10:00:10.000Z');
    let state = createInitialCameraPreviewState(SESSION_KEY_1);

    // 404 unsupported preview -> connecting state with errorMessage, NOT network_error
    state = applyCameraPreviewResponse(
      state,
      { status: 404, dataUri: null, capturedAt: null, revision: null, errorMessage: 'HTTP 404' },
      t0,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('unavailable_endpoint');
    expect(getCameraFeedLabel(state.feedStatus, false)).toBe('Đang kết nối camera robot');

    // status 0 network loss
    state = applyCameraPreviewResponse(
      state,
      { status: 0, dataUri: null, capturedAt: null, revision: null, errorMessage: 'Timeout' },
      t0 + 500,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('network_error');
    expect(getCameraFeedLabel(state.feedStatus, false)).toBe('Mất kết nối mạng');

    // Too old capturedAt -> stale
    state = applyCameraPreviewResponse(
      state,
      {
        status: 200,
        dataUri: `data:image/jpeg;base64,${SAMPLE_JPEG}BBB`,
        capturedAt: new Date(t0 - CAMERA_FRAME_MAX_AGE_MS - 1_500).toISOString(),
        revision: '11',
      },
      t0 + 1_000,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('stale');
    expect(state.dataUri).toBeNull();

    // Fresh frame, then identical signature repeating past CAMERA_FRAME_FROZEN_MS -> frozen/stale
    state = createInitialCameraPreviewState(SESSION_KEY_1);
    const frame20 = {
      status: 200,
      dataUri: `data:image/jpeg;base64,${SAMPLE_JPEG}CCC`,
      capturedAt: new Date(t0 + 1_800).toISOString(),
      revision: '20',
    };
    state = applyCameraPreviewResponse(state, frame20, t0 + 2_000, SESSION_KEY_1);
    expect(state.feedStatus).toBe('live');

    state = applyCameraPreviewResponse(
      state,
      frame20,
      t0 + 2_000 + CAMERA_FRAME_FROZEN_MS + 100,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('stale');
    expect(state.dataUri).toBeNull();
    expect(getCameraFeedLabel(state.feedStatus, false)).toContain('bị đứng');

    // Fresh frame then silence > CAMERA_FRAME_MAX_AGE_MS -> evaluateCameraPreviewFreshness degrades live
    state = applyCameraPreviewResponse(
      state,
      {
        status: 200,
        dataUri: `data:image/jpeg;base64,${SAMPLE_JPEG}DDD`,
        capturedAt: new Date(t0 + 7_000).toISOString(),
        revision: '21',
      },
      t0 + 7_000,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('live');
    state = evaluateCameraPreviewFreshness(state, t0 + 7_000 + CAMERA_FRAME_MAX_AGE_MS + 1);
    expect(state.feedStatus).toBe('stale');
    expect(state.dataUri).toBeNull();
  });

  it('drops late HTTP 200 frames from a prior session after session change', () => {
    const t0 = Date.parse('2026-11-19T10:00:10.000Z');
    let state = applyCameraPreviewResponse(
      createInitialCameraPreviewState(SESSION_KEY_1),
      {
        status: 200,
        dataUri: `data:image/jpeg;base64,${SAMPLE_JPEG}S1`,
        capturedAt: new Date(t0).toISOString(),
        revision: '1',
      },
      t0,
      SESSION_KEY_1,
    );
    expect(state.feedStatus).toBe('live');

    // Session switches to SESSION_KEY_2 -> clears prior image immediately
    state = createInitialCameraPreviewState(SESSION_KEY_2);
    expect(state.dataUri).toBeNull();
    expect(state.feedStatus).toBe('connecting');

    // Late response belonging to SESSION_KEY_1 arrives -> must be discarded
    state = applyCameraPreviewResponse(
      state,
      {
        status: 200,
        dataUri: `data:image/jpeg;base64,${SAMPLE_JPEG}OLD`,
        capturedAt: new Date(t0 + 500).toISOString(),
        revision: '2',
      },
      t0 + 500,
      SESSION_KEY_1,
    );
    expect(state.sessionKey).toBe(SESSION_KEY_2);
    expect(state.dataUri).toBeNull();
    expect(state.feedStatus).toBe('connecting');
  });
});

describe('FaceAuthController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));
  });

  afterEach(() => {
    resetServerClock();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits honestly on HTTP 204 and never transitions to verified by timer alone', async () => {
    const onVerified = vi.fn();
    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
      },
      deps: {
        getFaceWindow: vi.fn(async () => null),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: RECEIVER_STEP_ID,
          authJobStepId: RECEIVER_STEP_ID,
          authMethod: 'FACE_VERIFICATION',
          purpose: 'DELIVERY_RECEIVER',
        })),
      },
      onVerified,
    });

    controller.start();
    await flushMicrotasks();

    expect(controller.getState().phase).toBe('waiting_window');
    expect(controller.getState().sessionId).toBeNull();
    expect(controller.getState().elapsedSec).toBeNull();
    expect(controller.getState().compartmentLocked).toBe(true);

    // Advance 2 minutes across multiple poll cycles with 204 + RUNNING: never auto-succeeds
    await vi.advanceTimersByTimeAsync(120_000);
    await flushMicrotasks();

    expect(controller.getState().phase).toBe('waiting_window');
    expect(controller.getState().compartmentLocked).toBe(true);
    expect(onVerified).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('persists expiresAt countdown across background/reconnect, uses server clock offset, and never extends deadline', async () => {
    // Local tablet clock is 120s ahead of BE clock
    const localNow = Date.now();
    const serverNow = localNow - 120_000;
    recordServerTime(new Date(serverNow).toISOString(), localNow);

    const originalExpiresAt = new Date(serverNow + 30_000).toISOString();
    const extendedExpiresAt = new Date(serverNow + 120_000).toISOString();
    let returnedExpiresAt = originalExpiresAt;
    const onDismiss = vi.fn();

    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        sessionId: RECEIVER_SESSION_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
        expiresAt: originalExpiresAt,
      },
      deps: {
        getFaceWindow: vi.fn(async () => ({
          jobId: JOB_ID,
          authJobStepId: RECEIVER_STEP_ID,
          sessionId: RECEIVER_SESSION_ID,
          expiresAt: returnedExpiresAt,
        })),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: RECEIVER_STEP_ID,
          authJobStepId: RECEIVER_STEP_ID,
          authMethod: 'FACE_VERIFICATION',
          purpose: 'DELIVERY_RECEIVER',
        })),
      },
      onDismiss,
    });

    controller.start();
    await flushMicrotasks();

    expect(controller.getState().phase).toBe('scanning');
    expect(controller.getState().remainingSec).toBe(30);
    expect(controller.getState().elapsedSec).toBeNull();

    // Even if server later echoes a longer expiresAt on the same sessionId, keep original deadline
    returnedExpiresAt = extendedExpiresAt;
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(controller.getState().expiresAt).toBe(originalExpiresAt);
    expect(controller.getState().remainingSec).toBe(29);

    // Simulate app going background (setActive false) for 10s, then returning (setActive true)
    controller.setActive(false);
    await vi.advanceTimersByTimeAsync(10_000);
    controller.setActive(true);
    await flushMicrotasks();
    expect(controller.getState().remainingSec).toBe(19);
    expect(controller.getState().phase).toBe('scanning');

    // Background past deadline -> returning expires immediately without creating a new session
    controller.setActive(false);
    await vi.advanceTimersByTimeAsync(25_000);
    controller.setActive(true);
    await flushMicrotasks();

    expect(controller.getState().phase).toBe('expired');
    expect(controller.getState().sessionId).toBeNull();
    expect(onDismiss).toHaveBeenCalledWith(
      RECEIVER_STEP_ID,
      'expired',
      buildFaceAuthSessionKey(JOB_ID, RECEIVER_STEP_ID, RECEIVER_SESSION_ID),
    );

    controller.dispose();
  });

  it('transitions from 204 waiting_window -> scanning when 200 Window arrives, then expired when deadline passes', async () => {
    let currentWindow: StaffFaceScanWindow | null = null;
    const onDismiss = vi.fn();

    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
      },
      deps: {
        getFaceWindow: vi.fn(async () => currentWindow),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: RECEIVER_STEP_ID,
          authJobStepId: RECEIVER_STEP_ID,
          authMethod: 'FACE_VERIFICATION',
          purpose: 'DELIVERY_RECEIVER',
        })),
      },
      onDismiss,
    });

    controller.start();
    await flushMicrotasks();
    expect(controller.getState().phase).toBe('waiting_window');

    currentWindow = {
      jobId: JOB_ID,
      authJobStepId: RECEIVER_STEP_ID,
      sessionId: RECEIVER_SESSION_ID,
      expiresAt: new Date(Date.now() + 3_000).toISOString(),
    };

    await vi.advanceTimersByTimeAsync(FACE_POLL_INTERVAL_MS);
    await flushMicrotasks();

    expect(controller.getState().phase).toBe('scanning');
    expect(controller.getState().sessionId).toBe(RECEIVER_SESSION_ID);

    // Move past expiresAt
    await vi.advanceTimersByTimeAsync(3_500);
    await flushMicrotasks();

    expect(controller.getState().phase).toBe('expired');
    expect(controller.getState().sessionId).toBeNull();
    expect(controller.getState().compartmentLocked).toBe(true);
    expect(onDismiss).toHaveBeenCalledWith(
      RECEIVER_STEP_ID,
      'expired',
      buildFaceAuthSessionKey(JOB_ID, RECEIVER_STEP_ID, RECEIVER_SESSION_ID),
    );

    controller.dispose();
  });

  it('dismisses cleanly on job cancellation, robot mismatch, or step change, stops polling on dispose, and flags offline errors', async () => {
    // 1. Job cancelled
    const onCancelDismiss = vi.fn();
    const cancelledCtrl = new FaceAuthController({
      context: { jobId: JOB_ID, authJobStepId: RECEIVER_STEP_ID, robotId: ROBOT_ID, purpose: 'DELIVERY_RECEIVER' },
      deps: {
        getFaceWindow: vi.fn(async () => null),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'CANCELLED',
          stepStatus: 'CANCELLED',
          verified: false,
          authMethod: 'FACE_VERIFICATION',
        })),
      },
      onDismiss: onCancelDismiss,
    });
    cancelledCtrl.start();
    await flushMicrotasks();
    expect(cancelledCtrl.getState().phase).toBe('cancelled');
    expect(onCancelDismiss).toHaveBeenCalledWith(
      RECEIVER_STEP_ID,
      'cancelled',
      buildFaceAuthSessionKey(JOB_ID, RECEIVER_STEP_ID, null),
    );
    cancelledCtrl.dispose();

    // 2. Step changed (BE moved to next step)
    const onStepDismiss = vi.fn();
    const stepChangedCtrl = new FaceAuthController({
      context: { jobId: JOB_ID, authJobStepId: SENDER_STEP_ID, robotId: ROBOT_ID, purpose: 'DELIVERY_RECEIVER' },
      deps: {
        getFaceWindow: vi.fn(async () => ({
          jobId: JOB_ID,
          authJobStepId: RECEIVER_STEP_ID,
          sessionId: RECEIVER_SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: RECEIVER_STEP_ID,
          authMethod: 'FACE_VERIFICATION',
        })),
      },
      onDismiss: onStepDismiss,
    });
    stepChangedCtrl.start();
    await flushMicrotasks();
    expect(stepChangedCtrl.getState().phase).toBe('step_changed');
    expect(onStepDismiss).toHaveBeenCalledWith(
      SENDER_STEP_ID,
      'step_changed',
      buildFaceAuthSessionKey(JOB_ID, SENDER_STEP_ID, null),
    );
    stepChangedCtrl.dispose();

    // 3. Wrong robot scope
    const wrongRobotCtrl = new FaceAuthController({
      context: { jobId: JOB_ID, authJobStepId: RECEIVER_STEP_ID, robotId: ROBOT_ID, purpose: 'DELIVERY_RECEIVER' },
      deps: {
        getFaceWindow: vi.fn(async () => null),
        checkJobStepStatus: vi.fn(async () => ({
          jobId: JOB_ID,
          robotId: OTHER_ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: true,
        })),
      },
    });
    wrongRobotCtrl.start();
    await flushMicrotasks();
    expect(wrongRobotCtrl.getState().phase).toBe('cancelled');
    wrongRobotCtrl.dispose();

    // 4. Network error sets isOffline without marking verified; dispose stops subsequent polls
    const getFaceWindowNetErr = vi.fn(async () => {
      throw new Error('Network unavailable');
    });
    const offlineCtrl = new FaceAuthController({
      context: { jobId: JOB_ID, authJobStepId: RECEIVER_STEP_ID, robotId: ROBOT_ID, purpose: 'DELIVERY_RECEIVER' },
      deps: {
        getFaceWindow: getFaceWindowNetErr,
        checkJobStepStatus: vi.fn(async () => null),
      },
    });
    offlineCtrl.start();
    await flushMicrotasks();
    expect(offlineCtrl.getState().isOffline).toBe(true);
    expect(offlineCtrl.getState().phase).toBe('waiting_window');
    const callsBeforeDispose = getFaceWindowNetErr.mock.calls.length;
    offlineCtrl.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getFaceWindowNetErr.mock.calls.length).toBe(callsBeforeDispose);
  });

  it('rejects missing, invalid, or spoofed transportSessionId and validates fresh frames', async () => {
    let transport: string | null = null;
    const verifyFace = vi.fn<() => Promise<FaceVerifyResponse>>(async () => ({
      verified: false,
      reason: 'NO_FACE',
    }));

    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        sessionId: RECEIVER_SESSION_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      deps: {
        getFaceWindow: vi.fn(async () => ({
          jobId: JOB_ID,
          authJobStepId: RECEIVER_STEP_ID,
          sessionId: RECEIVER_SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: RECEIVER_STEP_ID,
          authMethod: 'FACE_VERIFICATION',
          purpose: 'DELIVERY_RECEIVER',
        })),
        verifyFace,
        getTransportSessionId: () => transport,
      },
    });

    controller.start();
    await flushMicrotasks();

    // Missing transportSessionId
    const missingRes = await controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now(),
      width: 640,
      height: 480,
    });
    expect(missingRes.submitted).toBe(false);
    if (!missingRes.submitted) expect(missingRes.reason).toBe('MISSING_TRANSPORT_SESSION');

    // Spoofed transportSessionId equal to Face window sessionId
    transport = RECEIVER_SESSION_ID;
    const spoofRes = await controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now(),
      width: 640,
      height: 480,
    });
    expect(spoofRes.submitted).toBe(false);
    if (!spoofRes.submitted) expect(spoofRes.reason).toBe('MISSING_TRANSPORT_SESSION');

    // Stale frame older than MAX_FRAME_AGE_MS
    transport = TRANSPORT_SESSION_ID;
    const staleRes = await controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now() - 5_000,
      width: 640,
      height: 480,
    });
    expect(staleRes.submitted).toBe(false);
    if (!staleRes.submitted) expect(staleRes.reason).toBe('STALE_FRAME');

    // Non-JPEG payload
    const badImgRes = await controller.submitFrame({
      imageBase64: 'not-a-jpeg',
      capturedAtMs: Date.now(),
      width: 640,
      height: 480,
    });
    expect(badImgRes.submitted).toBe(false);
    if (!badImgRes.submitted) expect(badImgRes.reason).toBe('INVALID_FRAME');

    expect(verifyFace).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('blocks duplicate in-flight submissions, retries inside valid session on verified=false, and drops stale responses across two consecutive sessions', async () => {
    let resolveVerify: ((value: FaceVerifyResponse) => void) | null = null;
    const verifyFace = vi.fn(
      () =>
        new Promise<FaceVerifyResponse>((resolve) => {
          resolveVerify = resolve;
        }),
    );
    const onVerified = vi.fn();

    let activeStepId = SENDER_STEP_ID;
    let activeSessionId: string | null = SESSION_ID;
    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: SENDER_STEP_ID,
        sessionId: SESSION_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      deps: {
        getFaceWindow: vi.fn<() => Promise<StaffFaceScanWindow | null>>(async () => ({
          jobId: JOB_ID,
          authJobStepId: activeStepId,
          sessionId: activeSessionId ?? RECEIVER_SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: activeStepId,
          authJobStepId: activeStepId,
          authMethod: 'FACE_VERIFICATION',
          purpose: 'DELIVERY_RECEIVER',
        })),
        verifyFace,
        getTransportSessionId: () => TRANSPORT_SESSION_ID,
      },
      onVerified,
    });

    controller.start();
    await flushMicrotasks();

    const firstPromise = controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now(),
      width: 640,
      height: 480,
    });
    await flushMicrotasks();

    // Concurrent second submission is rejected with IN_FLIGHT
    const dupRes = await controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now() + 100,
      width: 640,
      height: 480,
    });
    expect(dupRes.submitted).toBe(false);
    if (!dupRes.submitted) expect(dupRes.reason).toBe('IN_FLIGHT');
    expect(verifyFace).toHaveBeenCalledTimes(1);

    // Resolve first call with verified=false (NO_MATCH) -> remains in scanning to retry
    resolveVerify!({ verified: false, reason: 'NO_MATCH' });
    const firstRes = await firstPromise;
    expect(firstRes.submitted).toBe(true);
    expect(controller.getState().phase).toBe('scanning');
    expect(controller.getState().lastVerifyReason).toBe('NO_MATCH');
    expect(controller.getState().compartmentLocked).toBe(true);
    expect(onVerified).not.toHaveBeenCalled();

    // Start another verify in session 1, then rebind to session 2 -> stale response dropped & lastVerifyReason cleared
    const stalePromise = controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now() + 500,
      width: 640,
      height: 480,
    });
    await flushMicrotasks();

    activeStepId = RECEIVER_STEP_ID;
    activeSessionId = RECEIVER_SESSION_ID;
    controller.rebindContext({
      jobId: OTHER_JOB_ID,
      authJobStepId: RECEIVER_STEP_ID,
      sessionId: RECEIVER_SESSION_ID,
      robotId: ROBOT_ID,
      purpose: 'DELIVERY_RECEIVER',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Previous session returned verified=true late
    resolveVerify!({ verified: true, reason: 'MATCH' });
    const staleOutcome = await stalePromise;
    expect(staleOutcome.submitted).toBe(false);
    if (!staleOutcome.submitted) expect(staleOutcome.reason).toBe('STALE_CONTEXT');

    expect(controller.getState().jobId).toBe(OTHER_JOB_ID);
    expect(controller.getState().sessionId).toBe(RECEIVER_SESSION_ID);
    expect(controller.getState().phase).toBe('scanning');
    expect(controller.getState().lastVerifyReason).toBeNull();
    expect(onVerified).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('refuses sender verification result for receiver stage and confirms verified only when matching BE step succeeds', async () => {
    let stepResult: JobQrStepStatusResult = {
      jobId: JOB_ID,
      robotId: ROBOT_ID,
      jobStatus: 'RUNNING',
      stepStatus: 'SUCCEEDED',
      verified: true,
      selectedJobStepId: RECEIVER_STEP_ID,
      authJobStepId: RECEIVER_STEP_ID,
      authMethod: 'FACE_VERIFICATION',
      purpose: 'DELIVERY_SENDER', // Wrong leg leaked from sender!
      verifiedPurpose: 'DELIVERY_SENDER',
      expectedAccountId: RECEIVER_ACCOUNT_ID,
      verifiedActorAccountId: SENDER_ACCOUNT_ID,
    };
    const onVerified = vi.fn();

    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        sessionId: RECEIVER_SESSION_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
        expectedAccountId: RECEIVER_ACCOUNT_ID,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      deps: {
        getFaceWindow: vi.fn(async () => ({
          jobId: JOB_ID,
          authJobStepId: RECEIVER_STEP_ID,
          sessionId: RECEIVER_SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn(async () => stepResult),
        verifyFace: vi.fn(async () => ({ verified: true, reason: 'MATCH' })),
        getTransportSessionId: () => TRANSPORT_SESSION_ID,
      },
      onVerified,
    });

    controller.start();
    await flushMicrotasks();

    // Must reject sender grant during receiver stage
    expect(controller.getState().phase).toBe('scanning');
    expect(onVerified).not.toHaveBeenCalled();

    // Now BE returns genuine receiver verification
    stepResult = {
      ...stepResult,
      purpose: 'DELIVERY_RECEIVER',
      verifiedPurpose: 'DELIVERY_RECEIVER',
      verifiedActorAccountId: RECEIVER_ACCOUNT_ID,
    };

    const submitRes = await controller.submitFrame({
      imageBase64: SAMPLE_JPEG,
      capturedAtMs: Date.now(),
      width: 640,
      height: 480,
    });
    expect(submitRes.submitted).toBe(true);
    expect(controller.getState().phase).toBe('verified');
    expect(onVerified).toHaveBeenCalledWith(
      RECEIVER_STEP_ID,
      buildFaceAuthSessionKey(JOB_ID, RECEIVER_STEP_ID, RECEIVER_SESSION_ID),
    );

    controller.dispose();
  });

  it('rejects windows belonging to a different jobId', async () => {
    const controller = new FaceAuthController({
      context: {
        jobId: JOB_ID,
        authJobStepId: RECEIVER_STEP_ID,
        robotId: ROBOT_ID,
        purpose: 'DELIVERY_RECEIVER',
      },
      deps: {
        getFaceWindow: vi.fn(async () => ({
          jobId: OTHER_JOB_ID,
          authJobStepId: RECEIVER_STEP_ID,
          sessionId: RECEIVER_SESSION_ID,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })),
        checkJobStepStatus: vi.fn<() => Promise<JobQrStepStatusResult | null>>(async () => ({
          jobId: JOB_ID,
          robotId: ROBOT_ID,
          jobStatus: 'RUNNING',
          stepStatus: 'RUNNING',
          verified: false,
          selectedJobStepId: RECEIVER_STEP_ID,
          authJobStepId: RECEIVER_STEP_ID,
          authMethod: 'FACE_VERIFICATION',
        })),
      },
    });

    controller.start();
    await flushMicrotasks();

    expect(controller.getState().sessionId).toBeNull();
    expect(controller.getState().phase).toBe('waiting_window');
    controller.dispose();
  });
});
