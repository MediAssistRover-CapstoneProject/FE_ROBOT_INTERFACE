import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      hostUri: '127.0.0.1:8081',
    },
  },
}));

import {
  createSosCallController,
  isMatchingSosMediaSession,
  isServerRingExpiredSession,
  isStaffAnsweredMediaState,
  SOS_POLL_INTERVAL_MS,
  SOS_RING_TIMEOUT_MS,
  SOS_TIMEOUT_RETURN_DELAY_MS,
  SOS_UNANSWERED_NOTICE,
  SosCallControllerDependencies,
  SosCallSnapshot,
} from '../src/features/emergency/sosCallController';
import {
  DeviceIncidentStatusResponse,
  DeviceMediaSessionEvent,
  SosResponse,
} from '../src/services/api/types';

function makeSosResponse(incidentId = 'inc-001', robotId = 'robot-001'): SosResponse {
  return {
    incident: {
      incidentId,
      robotId,
      status: 'OPEN',
      severity: 'CRITICAL',
      sosRoutingStatus: 'ASSIGNED',
    },
    serviceRequestId: 'req-001',
    alertId: 'alert-001',
  };
}

function makeIncidentStatus(
  incidentId: string,
  status: DeviceIncidentStatusResponse['status'],
): DeviceIncidentStatusResponse {
  return {
    incidentId,
    robotId: 'robot-001',
    status,
  };
}

describe('sosCallController helpers', () => {
  it('matches only non-MONITOR media sessions belonging to the current incident and robot', () => {
    expect(
      isMatchingSosMediaSession(
        {
          sessionId: 'sess-1',
          incidentId: 'INC-123',
          robotId: 'ROBOT-1',
          mode: 'ASSIST',
          state: 'RINGING',
        },
        'inc-123',
        'robot-1',
      ),
    ).toBe(true);

    expect(
      isMatchingSosMediaSession(
        {
          sessionId: 'sess-other-inc',
          incidentId: 'inc-other',
          robotId: 'robot-1',
          mode: 'ASSIST',
          state: 'ACTIVE',
        },
        'inc-123',
        'robot-1',
      ),
    ).toBe(false);

    expect(
      isMatchingSosMediaSession(
        {
          sessionId: 'sess-other-robot',
          incidentId: 'inc-123',
          robotId: 'robot-2',
          mode: 'ASSIST',
          state: 'ACTIVE',
        },
        'inc-123',
        'robot-1',
      ),
    ).toBe(false);

    expect(
      isMatchingSosMediaSession(
        {
          sessionId: 'sess-monitor',
          incidentId: 'inc-123',
          robotId: 'robot-1',
          mode: 'MONITOR',
          state: 'ACTIVE',
        },
        'inc-123',
        'robot-1',
      ),
    ).toBe(false);

    expect(
      isMatchingSosMediaSession(
        {
          sessionId: 'sess-null-inc',
          incidentId: null,
          robotId: 'robot-1',
          mode: 'ASSIST',
          state: 'RINGING',
        },
        'inc-123',
        'robot-1',
      ),
    ).toBe(false);
  });

  it('recognizes answered media states and server ring-expired states accurately', () => {
    expect(isStaffAnsweredMediaState('RINGING')).toBe(false);
    expect(isStaffAnsweredMediaState('EXPIRED')).toBe(false);
    expect(isStaffAnsweredMediaState('ENDED')).toBe(false);
    expect(isStaffAnsweredMediaState('CONNECTING')).toBe(true);
    expect(isStaffAnsweredMediaState('ACTIVE')).toBe(true);
    expect(isStaffAnsweredMediaState('RECONNECTING')).toBe(true);

    expect(
      isServerRingExpiredSession(
        { sessionId: 's1', state: 'EXPIRED', endReason: 'STAFF_NOT_ANSWERED' },
        false,
      ),
    ).toBe(true);
    expect(
      isServerRingExpiredSession(
        { sessionId: 's1', state: 'EXPIRED', endReason: 'SESSION_EXPIRED' },
        false,
      ),
    ).toBe(false);
    expect(
      isServerRingExpiredSession(
        { sessionId: 's1', state: 'EXPIRED', endReason: 'STAFF_NOT_ANSWERED' },
        true,
      ),
    ).toBe(false);
  });
});

describe('createSosCallController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T05:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends SOS once on start, preserves operationKey on retry after network failure, and does not auto-exit when FAILED', async () => {
    const triggerSos = vi
      .fn<SosCallControllerDependencies['triggerSos']>()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(makeSosResponse('inc-retry-1', 'robot-001'));
    const getIncidentStatus = vi
      .fn<SosCallControllerDependencies['getIncidentStatus']>()
      .mockResolvedValue(makeIncidentStatus('inc-retry-1', 'OPEN'));
    const getDeviceMediaSession = vi
      .fn<SosCallControllerDependencies['getDeviceMediaSession']>()
      .mockResolvedValue({ enabled: true, session: null });
    const onNavigateBackToMap = vi.fn();

    let latest!: SosCallSnapshot;
    const controller = createSosCallController({
      operationKey: 'stable-op-key-1',
      sosParams: {
        description: 'SOS khẩn cấp',
        severity: 'CRITICAL',
        xM: 1.5,
        yM: 2.5,
        mapId: 'map-01',
      },
      deps: {
        triggerSos,
        getIncidentStatus,
        getDeviceMediaSession,
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latest = snap;
      },
      onNavigateBackToMap,
    });

    controller.start();
    controller.start(); // duplicate start must be ignored
    await vi.advanceTimersByTimeAsync(0);

    expect(triggerSos).toHaveBeenCalledTimes(1);
    expect(latest.incidentState).toBe('FAILED');
    expect(latest.callState).toBe('MEDIA_ERROR');
    expect(latest.errorMessage).toContain('Network request failed');
    expect(latest.unansweredNotice).toBeNull();

    // Waiting beyond ring timeout while initial SOS failed must NOT auto-exit
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS + SOS_TIMEOUT_RETURN_DELAY_MS + 5000);
    expect(onNavigateBackToMap).not.toHaveBeenCalled();

    // Retry must reuse the exact same operationKey and payload
    controller.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(triggerSos).toHaveBeenCalledTimes(2);
    expect(triggerSos.mock.calls[0]?.[0]).toEqual(triggerSos.mock.calls[1]?.[0]);
    expect(triggerSos.mock.calls[1]?.[0].operationKey).toBe('stable-op-key-1');
    expect(latest.incidentId).toBe('inc-retry-1');
    expect(latest.incidentState).toBe('SENT_WAITING');
    expect(latest.callState).toBe('WAITING_STAFF');

    controller.dispose();
  });

  it('keeps waiting callState and ring timer running when incident becomes ACKNOWLEDGED/IN_PROGRESS without media answer', async () => {
    const triggerSos = vi
      .fn<SosCallControllerDependencies['triggerSos']>()
      .mockResolvedValue(makeSosResponse('inc-ack-1', 'robot-001'));
    let incStatus: DeviceIncidentStatusResponse['status'] = 'ACKNOWLEDGED';
    const getIncidentStatus = vi.fn(async () => makeIncidentStatus('inc-ack-1', incStatus));
    const getDeviceMediaSession = vi.fn(async (): Promise<DeviceMediaSessionEvent> => ({
      enabled: true,
      session: {
        sessionId: 'sess-ack-1',
        incidentId: 'inc-ack-1',
        robotId: 'robot-001',
        mode: 'ASSIST',
        state: 'RINGING',
        expiresAt: new Date(Date.now() + 1800_000).toISOString(),
      },
    }));
    const onNavigateBackToMap = vi.fn();

    let latest!: SosCallSnapshot;
    const controller = createSosCallController({
      sosParams: { description: 'SOS ACK test', severity: 'CRITICAL' },
      deps: { triggerSos, getIncidentStatus, getDeviceMediaSession, getRobotId: () => 'robot-001' },
      onStateChange: (snap) => {
        latest = snap;
      },
      onNavigateBackToMap,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(SOS_POLL_INTERVAL_MS);

    expect(latest.incidentState).toBe('ACKNOWLEDGED');
    expect(latest.callState).toBe('WAITING_STAFF');
    expect(latest.isRingingSession).toBe(true);

    incStatus = 'IN_PROGRESS';
    await vi.advanceTimersByTimeAsync(SOS_POLL_INTERVAL_MS);

    expect(latest.incidentState).toBe('IN_PROGRESS');
    expect(latest.callState).toBe('WAITING_STAFF');
    expect(onNavigateBackToMap).not.toHaveBeenCalled();

    // Even with session.expiresAt = +1800s, ring timeout MUST trigger at 60s and return to map
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS - SOS_POLL_INTERVAL_MS * 2);
    expect(latest.callState).toBe('RING_TIMED_OUT');
    expect(latest.unansweredNotice).toBe(SOS_UNANSWERED_NOTICE);
    expect(onNavigateBackToMap).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SOS_TIMEOUT_RETURN_DELAY_MS);
    expect(onNavigateBackToMap).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('auto-returns to map with exact notice at 60s timeout and never calls resolve or close endpoints', async () => {
    const calledOps: string[] = [];
    const unsubscribeMock = vi.fn();

    const controller = createSosCallController({
      sosParams: { description: 'SOS timeout test', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => {
          calledOps.push('POST /api/v1/pi/incidents/sos');
          return makeSosResponse('inc-to-1', 'robot-001');
        },
        getIncidentStatus: async (id) => {
          calledOps.push(`GET /api/v1/pi/incidents/${id}`);
          return makeIncidentStatus(id, 'OPEN');
        },
        getDeviceMediaSession: async () => {
          calledOps.push('GET /api/v1/pi/media-session');
          return {
            enabled: true,
            session: {
              sessionId: 'sess-to-1',
              incidentId: 'inc-to-1',
              robotId: 'robot-001',
              mode: 'ASSIST',
              state: 'RINGING',
              expiresAt: new Date(Date.now() + 1800_000).toISOString(),
            },
          };
        },
        subscribeMediaEvents: () => unsubscribeMock,
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latest = snap;
      },
      onNavigateBackToMap: () => {
        navigatedBack = true;
      },
    });

    let latest!: SosCallSnapshot;
    let navigatedBack = false;

    controller.start();
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS);

    expect(latest.callState).toBe('RING_TIMED_OUT');
    expect(latest.unansweredNotice).toBe('Chưa có nhân viên bắt máy. Yêu cầu SOS đã được gửi');
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(navigatedBack).toBe(false);

    await vi.advanceTimersByTimeAsync(SOS_TIMEOUT_RETURN_DELAY_MS);
    expect(navigatedBack).toBe(true);
    expect(calledOps.some((op) => /resolve|close|false-alarm|\/end/i.test(op))).toBe(false);
  });

  it('immediately handles server ring expiration (EXPIRED + STAFF_NOT_ANSWERED) via SSE without waiting 60s', async () => {
    let emitSse: ((evt: DeviceMediaSessionEvent) => void) | null = null;
    const unsubscribeMock = vi.fn();
    const onNavigateBackToMap = vi.fn();

    let latest!: SosCallSnapshot;
    const controller = createSosCallController({
      sosParams: { description: 'SOS server expiry', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => makeSosResponse('inc-exp-1', 'robot-001'),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'OPEN'),
        getDeviceMediaSession: async () => ({ enabled: true, session: null }),
        subscribeMediaEvents: (onEvent) => {
          emitSse = onEvent;
          return unsubscribeMock;
        },
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latest = snap;
      },
      onNavigateBackToMap,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(emitSse).toBeTruthy();
    emitSse!({
      enabled: true,
      session: {
        sessionId: 'sess-exp-1',
        incidentId: 'inc-exp-1',
        robotId: 'robot-001',
        mode: 'ASSIST',
        state: 'EXPIRED',
        endReason: 'STAFF_NOT_ANSWERED',
      },
    });

    expect(latest.callState).toBe('RING_TIMED_OUT');
    expect(latest.unansweredNotice).toBe(SOS_UNANSWERED_NOTICE);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SOS_TIMEOUT_RETURN_DELAY_MS);
    expect(onNavigateBackToMap).toHaveBeenCalledTimes(1);
  });

  it('cancels timeout and never auto-closes when staff answers before the deadline', async () => {
    let emitSse: ((evt: DeviceMediaSessionEvent) => void) | null = null;
    const onNavigateBackToMap = vi.fn();

    let latest!: SosCallSnapshot;
    const controller = createSosCallController({
      sosParams: { description: 'SOS answered before timeout', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => makeSosResponse('inc-ans-1', 'robot-001'),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'ACKNOWLEDGED'),
        getDeviceMediaSession: async () => ({
          enabled: true,
          session: {
            sessionId: 'sess-ans-1',
            incidentId: 'inc-ans-1',
            robotId: 'robot-001',
            mode: 'ASSIST',
            state: latest.callState === 'CONNECTED' ? 'ACTIVE' : 'RINGING',
          },
        }),
        subscribeMediaEvents: (onEvent) => {
          emitSse = onEvent;
          return () => undefined;
        },
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latest = snap;
      },
      onNavigateBackToMap,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(10_000);

    emitSse!({
      enabled: true,
      session: {
        sessionId: 'sess-ans-1',
        incidentId: 'inc-ans-1',
        robotId: 'robot-001',
        staffAccountId: 'staff-001',
        mode: 'ASSIST',
        state: 'CONNECTING',
      },
    });
    expect(latest.callState).toBe('CONNECTING_MEDIA');

    emitSse!({
      enabled: true,
      session: {
        sessionId: 'sess-ans-1',
        incidentId: 'inc-ans-1',
        robotId: 'robot-001',
        staffAccountId: 'staff-001',
        mode: 'ASSIST',
        state: 'ACTIVE',
      },
    });
    expect(latest.callState).toBe('CONNECTED');

    // Advance well past 60s + return delay — call stays open
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS + SOS_TIMEOUT_RETURN_DELAY_MS + 60_000);
    expect(latest.callState).toBe('CONNECTED');
    expect(onNavigateBackToMap).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('prevents false auto-close when staff answers right at the 60s boundary check (both via poll response and concurrent SSE)', async () => {
    // Subcase A: final verification call at 60s returns CONNECTING
    let boundaryState: 'RINGING' | 'CONNECTING' = 'RINGING';
    const onNavA = vi.fn();
    let latestA!: SosCallSnapshot;

    const controllerA = createSosCallController({
      sosParams: { description: 'Boundary poll', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => makeSosResponse('inc-bound-a', 'robot-001'),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'OPEN'),
        getDeviceMediaSession: async () => ({
          enabled: true,
          session: {
            sessionId: 'sess-bound-a',
            incidentId: 'inc-bound-a',
            robotId: 'robot-001',
            mode: 'ASSIST',
            state: boundaryState,
          },
        }),
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latestA = snap;
      },
      onNavigateBackToMap: onNavA,
    });

    controllerA.start();
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS - 100);
    boundaryState = 'CONNECTING';
    await vi.advanceTimersByTimeAsync(100 + SOS_TIMEOUT_RETURN_DELAY_MS + 1000);

    expect(latestA.callState).toBe('CONNECTING_MEDIA');
    expect(onNavA).not.toHaveBeenCalled();
    controllerA.dispose();

    // Subcase B: SSE delivers ACTIVE while the final 60s getDeviceMediaSession() request is in-flight returning old RINGING
    let resolveFinalCheck!: (val: DeviceMediaSessionEvent) => void;
    let emitSseB: ((evt: DeviceMediaSessionEvent) => void) | null = null;
    let inFinalCheck = false;
    const onNavB = vi.fn();
    let latestB!: SosCallSnapshot;

    const controllerB = createSosCallController({
      sosParams: { description: 'Boundary SSE race', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => makeSosResponse('inc-bound-b', 'robot-001'),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'OPEN'),
        getDeviceMediaSession: () => {
          if (inFinalCheck) {
            return new Promise<DeviceMediaSessionEvent>((resolve) => {
              resolveFinalCheck = resolve;
            });
          }
          return Promise.resolve({
            enabled: true,
            session: {
              sessionId: 'sess-bound-b',
              incidentId: 'inc-bound-b',
              robotId: 'robot-001',
              mode: 'ASSIST',
              state: 'RINGING',
            },
          });
        },
        subscribeMediaEvents: (onEvent) => {
          emitSseB = onEvent;
          return () => undefined;
        },
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latestB = snap;
      },
      onNavigateBackToMap: onNavB,
    });

    controllerB.start();
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS - 100);
    inFinalCheck = true;
    await vi.advanceTimersByTimeAsync(100); // Triggers finalizeRingTimeout & starts pending getDeviceMediaSession()

    // While final poll is still awaiting response, SSE delivers staff ACCEPT / ACTIVE
    emitSseB!({
      enabled: true,
      session: {
        sessionId: 'sess-bound-b',
        incidentId: 'inc-bound-b',
        robotId: 'robot-001',
        mode: 'ASSIST',
        state: 'ACTIVE',
      },
    });

    // Now the stale poll response arrives claiming RINGING
    resolveFinalCheck({
      enabled: true,
      session: {
        sessionId: 'sess-bound-b',
        incidentId: 'inc-bound-b',
        robotId: 'robot-001',
        mode: 'ASSIST',
        state: 'RINGING',
      },
    });
    await vi.advanceTimersByTimeAsync(SOS_TIMEOUT_RETURN_DELAY_MS + 5000);

    expect(latestB.callState).toBe('CONNECTED');
    expect(onNavB).not.toHaveBeenCalled();
    controllerB.dispose();
  });

  it('ignores media sessions belonging to another incident or another robot', async () => {
    let emitSse: ((evt: DeviceMediaSessionEvent) => void) | null = null;
    const onNavigateBackToMap = vi.fn();
    let latest!: SosCallSnapshot;

    const controller = createSosCallController({
      sosParams: { description: 'Isolation test', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => makeSosResponse('inc-mine', 'robot-mine'),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'OPEN'),
        getDeviceMediaSession: async () => ({
          enabled: true,
          session: {
            sessionId: 'sess-other-robot',
            incidentId: 'inc-other',
            robotId: 'robot-other',
            mode: 'ASSIST',
            state: 'ACTIVE',
          },
        }),
        subscribeMediaEvents: (onEvent) => {
          emitSse = onEvent;
          return () => undefined;
        },
        getRobotId: () => 'robot-mine',
      },
      onStateChange: (snap) => {
        latest = snap;
      },
      onNavigateBackToMap,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(SOS_POLL_INTERVAL_MS);

    // Must ignore mismatched robot/incident
    expect(latest.callState).toBe('WAITING_STAFF');
    expect(latest.mediaSessionId).toBeNull();

    // Must also ignore mismatched EXPIRED event from another incident
    emitSse!({
      enabled: true,
      session: {
        sessionId: 'sess-old-exp',
        incidentId: 'inc-older',
        robotId: 'robot-mine',
        mode: 'ASSIST',
        state: 'EXPIRED',
        endReason: 'STAFF_NOT_ANSWERED',
      },
    });
    expect(latest.callState).toBe('WAITING_STAFF');

    // Also ignore same-incident wrong-robot ACTIVE
    emitSse!({
      enabled: true,
      session: {
        sessionId: 'sess-wrong-robot',
        incidentId: 'inc-mine',
        robotId: 'robot-other',
        mode: 'ASSIST',
        state: 'ACTIVE',
      },
    });
    expect(latest.callState).toBe('WAITING_STAFF');
    expect(onNavigateBackToMap).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('cleans timers/SSE on exit/reopen and ignores stale async responses from previous session', async () => {
    let resolveDelayedSos!: (res: SosResponse) => void;
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const onState1 = vi.fn();
    const onNav1 = vi.fn();

    const controller1 = createSosCallController({
      sosParams: { description: 'Session 1', severity: 'CRITICAL' },
      deps: {
        triggerSos: () =>
          new Promise<SosResponse>((resolve) => {
            resolveDelayedSos = resolve;
          }),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'OPEN'),
        getDeviceMediaSession: async () => ({ enabled: true, session: null }),
        subscribeMediaEvents: () => unsub1,
        getRobotId: () => 'robot-001',
      },
      onStateChange: onState1,
      onNavigateBackToMap: onNav1,
    });

    controller1.start();
    const callsBeforeExit = onState1.mock.calls.length;

    // User exits before first triggerSos even finishes
    controller1.exit();
    expect(onNav1).toHaveBeenCalledTimes(1);

    // Late response from disposed session 1 resolves -> MUST be ignored completely
    resolveDelayedSos(makeSosResponse('inc-stale-1', 'robot-001'));
    await vi.advanceTimersByTimeAsync(SOS_RING_TIMEOUT_MS + SOS_TIMEOUT_RETURN_DELAY_MS + 5000);
    expect(onState1.mock.calls.length).toBe(callsBeforeExit);
    expect(onNav1).toHaveBeenCalledTimes(1);

    // Reopen a fresh screen session -> gets a new operationKey and works independently
    let latest2!: SosCallSnapshot;
    const controller2 = createSosCallController({
      sosParams: { description: 'Session 2', severity: 'CRITICAL' },
      deps: {
        triggerSos: async () => makeSosResponse('inc-fresh-2', 'robot-001'),
        getIncidentStatus: async (id) => makeIncidentStatus(id, 'OPEN'),
        getDeviceMediaSession: async () => ({ enabled: true, session: null }),
        subscribeMediaEvents: () => unsub2,
        getRobotId: () => 'robot-001',
      },
      onStateChange: (snap) => {
        latest2 = snap;
      },
    });

    controller2.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(latest2.operationKey).not.toBe(controller1.getSnapshot().operationKey);
    expect(latest2.incidentId).toBe('inc-fresh-2');

    // Disposing controller2 stops SSE cleanly
    controller2.dispose();
    expect(unsub2).toHaveBeenCalledTimes(1);
  });
});
