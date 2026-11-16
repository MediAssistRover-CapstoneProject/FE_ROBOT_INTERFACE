import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      hostUri: '127.0.0.1:8081',
    },
  },
}));

import { apiClient, parseDeviceJwtClaims } from '../src/services/api/client';
import { createPiEnvelope } from '../src/services/api/envelope';
import { robotApiService } from '../src/services/api/robotApiService';
import {
  getAdaptivePollDelayMs,
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_IDLE_MS,
  POLL_INTERVAL_OFFLINE_MS,
  REMOTE_API_BASE,
  robotMapService,
} from '../src/services/api/robotMapService';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createPiEnvelope', () => {
  it('creates an envelope with default protocolVersion 1.0 and unique messageId', () => {
    const envelope = createPiEnvelope('HEARTBEAT', { status: 'IDLE' });

    expect(envelope.protocolVersion).toBe('1.0');
    expect(envelope.messageType).toBe('HEARTBEAT');
    expect(envelope.payload).toEqual({ status: 'IDLE' });
    expect(envelope.messageId).toBeTruthy();
    expect(envelope.occurredAt).toBeTruthy();
    expect(typeof envelope.sequenceNo).toBe('number');
  });

  it('increments sequence numbers across consecutive envelopes', () => {
    const first = createPiEnvelope('TEST', { count: 1 });
    const second = createPiEnvelope('TEST', { count: 2 });

    expect(second.sequenceNo).toBeGreaterThan(first.sequenceNo);
  });

  it('correctly attaches optional correlation, job, and step IDs', () => {
    const envelope = createPiEnvelope(
      'STEP_RESULT',
      { success: true },
      {
        jobId: 'job-123',
        jobStepId: 'step-456',
        robotId: 'robot-789',
        correlationId: 'corr-001',
      },
    );

    expect(envelope.jobId).toBe('job-123');
    expect(envelope.jobStepId).toBe('step-456');
    expect(envelope.robotId).toBe('robot-789');
    expect(envelope.correlationId).toBe('corr-001');
  });
});

describe('apiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('mock-test-token', 'ROBOT_01');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('normalizes base URL and removes trailing slashes', () => {
    apiClient.setBaseUrl('http://192.168.1.100:8080///');
    expect(apiClient.getBaseUrl()).toBe('http://192.168.1.100:8080');
    apiClient.setBaseUrl('http://localhost:8080');
  });

  it('injects Bearer token and headers for authenticated Pi requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ receivedAt: '2026-10-31T07:00:00Z', status: 'OK' }),
    );
    global.fetch = fetchMock;

    await apiClient.request('/api/v1/pi/heartbeat', {
      method: 'POST',
      body: { test: true },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/heartbeat');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer mock-test-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Request-ID']).toBeTruthy();
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('does not inject Bearer token for public requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ content: [], totalElements: 0 }),
    );
    global.fetch = fetchMock;

    await apiClient.request('/api/v1/public/rooms', {
      method: 'GET',
      requiresAuth: false,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('handles 204 No Content responses gracefully', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    global.fetch = fetchMock;

    const res = await apiClient.request('/api/v1/pi/test', {
      requiresAuth: false,
    });
    expect(res).toEqual({});
  });

  it('parses and applies valid pre-issued Device JWT claims without fetching auth endpoint', async () => {
    apiClient.clearToken();
    const expSec = Math.floor(Date.now() / 1000) + 1800;
    const payload = Buffer.from(
      JSON.stringify({
        robotId: '0e3f1083-2546-4f45-8004-5eda5cb75a6f',
        robotCode: 'mar-v1',
        exp: expSec,
      }),
    ).toString('base64url');
    const fakeJwt = `hdr.${payload}.sig`;

    expect(parseDeviceJwtClaims(fakeJwt)?.robotCode).toBe('mar-v1');
    expect(apiClient.applyPreissuedToken(fakeJwt)).toBe(true);
    expect(apiClient.getRobotId()).toBe('0e3f1083-2546-4f45-8004-5eda5cb75a6f');

    const fetchMock = vi.fn<typeof fetch>();
    global.fetch = fetchMock;
    const tok = await apiClient.ensureDeviceToken();
    expect(tok).toBe(fakeJwt);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects expired pre-issued Device JWT', () => {
    apiClient.clearToken();
    const expiredSec = Math.floor(Date.now() / 1000) - 60;
    const payload = Buffer.from(
      JSON.stringify({ robotId: 'robot-expired', exp: expiredSec }),
    ).toString('base64url');
    expect(apiClient.applyPreissuedToken(`hdr.${payload}.sig`)).toBe(false);
  });
});

describe('robotApiService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('test-token-mar', 'ROBOT_MAR_01');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('pingServer returns latency and ok when reachable', async () => {
    global.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ content: [] }),
    );

    const result = await robotApiService.pingServer();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('loginDevice requests token and updates client token', async () => {
    const tokenResponse = {
      accessToken: 'new-jwt-token-123',
      tokenType: 'Bearer',
      expiresIn: 3600,
      robotId: 'ROBOT_MAR_01',
      expiresAt: '2026-10-31T08:00:00Z',
    };
    global.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(tokenResponse),
    );

    const res = await robotApiService.loginDevice('ROBOT_MAR_01', 'secret-key');
    expect(res.accessToken).toBe('new-jwt-token-123');
    expect(apiClient.getRobotId()).toBe('ROBOT_MAR_01');
  });

  it('sendHeartbeat posts envelope to /api/v1/pi/heartbeat', async () => {
    const ack = { receivedAt: '2026-10-31T07:00:00Z', status: 'OK' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ack));
    global.fetch = fetchMock;

    const result = await robotApiService.sendHeartbeat('IDLE', 85, 'MAP_ZONE_01');
    expect(result.receivedAt).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/heartbeat');
    const body = JSON.parse(init?.body as string);
    expect(body.messageType).toBe('HEARTBEAT');
    expect(body.payload.batteryRaw).toBe(85);
    expect(body.payload.currentMapId).toBe('MAP_ZONE_01');
  });

  it('sendLocation posts envelope to /api/v1/pi/telemetry/location', async () => {
    const ack = { receivedAt: '2026-10-31T07:00:00Z', status: 'OK' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ack));
    global.fetch = fetchMock;

    await robotApiService.sendLocation(12.5, 34.8, 1.57, 'MAP_01');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/telemetry/location');
    const body = JSON.parse(init?.body as string);
    expect(body.messageType).toBe('LOCATION');
    expect(body.payload.xM).toBe(12.5);
    expect(body.payload.yM).toBe(34.8);
    expect(body.payload.yawRad).toBe(1.57);
  });

  it('triggerSos posts to /api/v1/pi/incidents/sos and returns incident info', async () => {
    const sosRes = {
      incident: {
        incidentId: 'INC_999',
        status: 'REPORTED' as const,
        description: 'Bệnh nhân ngất xỉu',
      },
      receivedAt: '2026-10-31T07:00:00Z',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sosRes));
    global.fetch = fetchMock;

    const res = await robotApiService.triggerSos('Bệnh nhân ngất xỉu', 'CRITICAL', 10, 20);
    expect(res.incident?.incidentId).toBe('INC_999');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/incidents/sos');
    const body = JSON.parse(init?.body as string);
    expect(body.payload.description).toBe('Bệnh nhân ngất xỉu');
    expect(body.payload.xM).toBe(10);
    expect(body.payload.yM).toBe(20);
  });

  it('triggerSos rounds xM and yM to at most 4 decimal places for BE @Digits(8,4)', async () => {
    const sosRes = {
      incident: { incidentId: 'INC_ROUND_1', status: 'OPEN' as const },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sosRes));
    global.fetch = fetchMock;

    await robotApiService.triggerSos(
      'SOS tọa độ lẻ dài',
      'CRITICAL',
      0.328491029481,
      -0.081928374123,
      'map-123',
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init?.body as string);
    expect(body.payload.xM).toBe(0.3285);
    expect(body.payload.yM).toBe(-0.0819);
  });

  it('triggerSos preserves stable operationKey and sets Idempotency-Key header', async () => {
    const sosRes = {
      incident: { incidentId: 'INC_REAL_123', status: 'REPORTED' as const },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sosRes));
    global.fetch = fetchMock;

    const opKey = 'custom-op-key-abc';
    await robotApiService.triggerSos('Cần hỗ trợ', 'CRITICAL', undefined, undefined, undefined, opKey);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(opKey);

    const body = JSON.parse(init?.body as string);
    expect(body.operationKey).toBe(opKey);
    expect(body.payload.xM).toBeUndefined();
    expect(body.payload.yM).toBeUndefined();
    expect(body.payload.mapId).toBeUndefined();
  });

  it('triggerSos surfaces baseUrl and auth error details when device token fails', async () => {
    apiClient.clearToken();
    apiClient.setBaseUrl('https://mediassistrover.duckdns.org');
    global.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Invalid device secret', { status: 401, statusText: 'Unauthorized' }),
    );

    await expect(robotApiService.triggerSos('SOS test')).rejects.toThrow(
      /mediassistrover\.duckdns\.org.*HTTP 401.*Invalid device secret/,
    );
    expect(apiClient.getLastAuthError()).toContain('HTTP 401');
  });

  it('triggerSos preserves sosRoutingStatus returned from backend', async () => {
    const sosRes = {
      incident: {
        incidentId: 'INC_NO_SHIFT_1',
        status: 'OPEN' as const,
        sosRoutingStatus: 'NO_ACTIVE_SHIFT' as const,
        sosResponderAccountId: null,
      },
    };
    global.fetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sosRes));

    const res = await robotApiService.triggerSos('SOS test');
    expect(res.incident?.sosRoutingStatus).toBe('NO_ACTIVE_SHIFT');
  });

  it('getIncidentStatus queries GET /api/v1/pi/incidents/{id}', async () => {
    const statusRes = {
      incidentId: 'INC_REAL_123',
      status: 'ACKNOWLEDGED' as const,
      description: 'Cần hỗ trợ',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusRes));
    global.fetch = fetchMock;

    const res = await robotApiService.getIncidentStatus('INC_REAL_123');
    expect(res.status).toBe('ACKNOWLEDGED');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/incidents/INC_REAL_123');
    expect(init?.method).toBe('GET');
  });

  it('getDeviceMediaSession queries GET /api/v1/pi/media-session and returns active session', async () => {
    const mediaRes = {
      enabled: true,
      session: {
        sessionId: 'session-xyz',
        robotId: 'ROBOT_01',
        mode: 'ASSIST',
        state: 'ACTIVE',
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mediaRes));
    global.fetch = fetchMock;

    const res = await robotApiService.getDeviceMediaSession();
    expect(res?.enabled).toBe(true);
    expect(res?.session?.state).toBe('ACTIVE');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/media-session');
    expect(init?.method).toBe('GET');
  });

  it('reportJobStarted posts envelope to /api/v1/pi/jobs/:jobId/started', async () => {
    const ack = { receivedAt: '2026-10-31T07:00:00Z', status: 'OK' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ack));
    global.fetch = fetchMock;

    await robotApiService.reportJobStarted('job-555');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/jobs/job-555/started');
    const body = JSON.parse(init?.body as string);
    expect(body.messageType).toBe('JOB_STARTED');
    expect(body.jobId).toBe('job-555');
  });

  it('reportStepResult posts envelope to /api/v1/pi/job-steps/:stepId/result', async () => {
    const ack = { receivedAt: '2026-10-31T07:00:00Z', status: 'OK' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ack));
    global.fetch = fetchMock;

    await robotApiService.reportStepResult('step-777', { arrived: true }, 'job-555');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/job-steps/step-777/result');
    const body = JSON.parse(init?.body as string);
    expect(body.messageType).toBe('STEP_RESULT');
    expect(body.jobStepId).toBe('step-777');
    expect(body.payload.result).toEqual({ arrived: true });
  });

  it('sendVoiceCommand posts envelope to /api/v1/pi/voice/commands', async () => {
    const ack = { receivedAt: '2026-10-31T07:00:00Z', status: 'OK' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ack));
    global.fetch = fetchMock;

    await robotApiService.sendVoiceCommand('Dẫn tôi đến quầy tiếp đón');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/voice/commands');
    const body = JSON.parse(init?.body as string);
    expect(body.messageType).toBe('VOICE_COMMAND');
    expect(body.payload.command).toBe('Dẫn tôi đến quầy tiếp đón');
  });

  it('getPublicRooms requests public endpoint without requiring auth token', async () => {
    const mockRooms = {
      content: [{ roomId: 'P_CAP_CUU', roomName: 'Phòng cấp cứu' }],
      totalElements: 1,
      totalPages: 1,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mockRooms));
    global.fetch = fetchMock;

    const res = await robotApiService.getPublicRooms(0, 10);
    expect(res.content.length).toBe(1);
    expect(res.content[0]?.roomName).toBe('Phòng cấp cứu');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/public/rooms?page=0&size=10');
  });

  it('getPublicHospitalInfo fetches published articles', async () => {
    const mockArticles = {
      content: [{ id: 'art-01', title: 'Quy trình khám bệnh' }],
      totalElements: 1,
      totalPages: 1,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mockArticles));
    global.fetch = fetchMock;

    const res = await robotApiService.getPublicHospitalInfo(0, 5);
    expect(res.content[0]?.title).toBe('Quy trình khám bệnh');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/public/hospital-information?page=0&size=5');
  });

  it('requestEscort posts to /api/v1/pi/requests/escort with Idempotency-Key and returns EscortResponse', async () => {
    const escortRes = {
      request: {
        serviceRequestId: 'req-escort-123',
        status: 'SUBMITTED',
      },
      mapId: 'map-01',
      destinationEndpointId: 'ep-01',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(escortRes));
    global.fetch = fetchMock;

    const opKey = 'key-escort-123';
    const res = await robotApiService.requestEscort(
      {
        mapId: 'map-01',
        destinationEndpointId: 'ep-01',
      },
      opKey,
    );

    expect(res.request.serviceRequestId).toBe('req-escort-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/requests/escort');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(opKey);
  });

  it('getRequestDetail gets /api/v1/pi/requests/{requestId}', async () => {
    const detailRes = {
      serviceRequestId: 'req-escort-123',
      status: 'IN_PROGRESS' as const,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(detailRes));
    global.fetch = fetchMock;

    const res = await robotApiService.getRequestDetail('req-escort-123');
    expect(res.status).toBe('IN_PROGRESS');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/requests/req-escort-123');
  });

  it('cancelRequest posts to /api/v1/pi/requests/{requestId}/cancel with reason', async () => {
    const cancelRes = {
      serviceRequestId: 'req-escort-123',
      status: 'CANCELLED' as const,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(cancelRes));
    global.fetch = fetchMock;

    const res = await robotApiService.cancelRequest('req-escort-123', 'Bệnh nhân dừng yêu cầu', 'cancel-op-key');
    expect(res.status).toBe('CANCELLED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/requests/req-escort-123/cancel');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('cancel-op-key');
  });
});

describe('robotMapService.loadMapPackage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('prefers GET /maps/{mapId}/presentation/published and attaches source metadata', async () => {
    const mapId = 'bdf6503a-d38e-4bde-9a67-763e91668593';
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-token' });
      }
      if (url.startsWith(`${REMOTE_API_BASE}/maps?`)) {
        return jsonResponse({ content: [{ mapId, mapName: 'map mới nhất' }] });
      }
      if (url.startsWith(`${REMOTE_API_BASE}/endpoints?`)) {
        return jsonResponse({
          content: [{ endpointId: 'ep-1', mapId, endpointCode: 'letan', xM: 0.6, yM: 3.1, active: true }],
        });
      }
      if (url.startsWith(`${REMOTE_API_BASE}/zones?`)) {
        return jsonResponse({ content: [] });
      }
      if (url.endsWith('/snapshot')) {
        return jsonResponse({});
      }
      if (url === `${REMOTE_API_BASE}/maps/${mapId}/image-metadata`) {
        return jsonResponse({ width_px: 154, height_px: 169 });
      }
      if (url === `${REMOTE_API_BASE}/maps/${mapId}/presentation/published`) {
        return jsonResponse({
          source: { mapId, widthPx: 154, heightPx: 169, resolutionMPerPixel: 0.025 },
          revision: 3,
          document: {
            backgroundColor: '#f8fafc',
            rotationDegrees: -95.2,
            features: [{ id: 'w-1', type: 'WALL', points: [{ x: 0.1, y: 0.2 }, { x: 1.1, y: 0.2 }] }],
          },
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const pkg = await robotMapService.loadMapPackage(mapId);
    const urls = fetchMock.mock.calls.map(([u]) => (typeof u === 'string' ? u : u.toString()));

    expect(urls).toContain(`${REMOTE_API_BASE}/maps/${mapId}/presentation/published`);
    expect(urls).not.toContain(`${REMOTE_API_BASE}/maps/${mapId}/presentation`);
    expect(pkg.presentation?.backgroundColor).toBe('#f8fafc');
    expect(pkg.presentation?.rotationDegrees).toBe(-95.2);
    expect(pkg.presentation?.features).toHaveLength(1);
    expect(pkg.presentation?.source?.widthPx).toBe(154);
  });

  it('returns null presentation when a map has neither /presentation/published nor /presentation', async () => {
    const mapId = 'custom-map-without-pres';
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(`${REMOTE_API_BASE}/maps?`)) {
        return jsonResponse({ content: [{ mapId, mapName: 'SLAM raw map' }] });
      }
      if (url.startsWith(`${REMOTE_API_BASE}/endpoints?`)) {
        return jsonResponse({
          content: [{ endpointId: 'ep-2', mapId, endpointCode: 'phong01', xM: 1.0, yM: 1.0, active: true }],
        });
      }
      if (url.startsWith(`${REMOTE_API_BASE}/zones?`)) {
        return jsonResponse({ content: [] });
      }
      if (url.endsWith('/snapshot')) {
        return jsonResponse({});
      }
      if (url === `${REMOTE_API_BASE}/maps/${mapId}/image-metadata`) {
        return jsonResponse({ width_px: 120, height_px: 120 });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const pkg = await robotMapService.loadMapPackage(mapId);
    expect(pkg.activeMap.mapId).toBe(mapId);
    expect(pkg.presentation).toBeNull();
  });

  it('resolves existing published NAVIGATION workflow and dispatches navigation only when IDLE without active job', async () => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('device-token', 'robot-1');

    const mapId = 'bdf6503a-d38e-4bde-9a67-763e91668593';
    const existingWfId = 'wf-nav-published-v3';
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-token' });
      }
      if (url === `${REMOTE_API_BASE}/robots`) {
        return jsonResponse({ content: [{ robotId: 'robot-1', robotCode: 'ROBOT_MAR_01' }] });
      }
      if (url.endsWith('/snapshot')) {
        return jsonResponse({
          robot: { status: 'IDLE', batteryRaw: 8500 },
          mqttConnected: true,
          heartbeatFresh: true,
          activeJobId: null,
          navigationSession: { sessionId: 'sess-1', mapId, state: 'READY' },
        });
      }
      if (url.endsWith('/navigation-guidance')) {
        return jsonResponse({ state: 'IDLE' });
      }
      if (url === 'http://localhost:8080/api/v1/pi/workflows') {
        return jsonResponse([
          {
            workflow: {
              workflowId: 'wf-nav-v2',
              serviceType: 'NAVIGATION',
              status: 'PUBLISHED',
              acceptsNewJobs: true,
              schemaVersion: 2,
              versionNo: 1,
            },
          },
          {
            workflow: {
              workflowId: existingWfId,
              serviceType: 'NAVIGATION',
              status: 'PUBLISHED',
              acceptsNewJobs: true,
              schemaVersion: 3,
              versionNo: 2,
            },
          },
        ]);
      }
      if (url === 'http://localhost:8080/api/v1/pi/requests/navigation') {
        const body = JSON.parse(String(init?.body || '{}'));
        const headers = init?.headers as Record<string, string>;
        expect(headers['Idempotency-Key']).toBeTruthy();
        expect(body.workflowId).toBe(existingWfId);
        expect(body.destinationEndpointId).toBe('ep-sos');
        expect(body.navigationSessionId).toBe('sess-1');
        return jsonResponse({
          request: { serviceRequestId: 'req-nav-1', status: 'QUEUED' },
          workflowId: existingWfId,
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const result = await robotMapService.dispatchMoveWorkflow('ep-sos', mapId, 'sess-1');
    const urls = fetchMock.mock.calls.map(([u]) => (typeof u === 'string' ? u : u.toString()));

    expect(result.ok).toBe(true);
    expect(result.workflowId).toBe(existingWfId);
    expect(result.serviceRequestId).toBe('req-nav-1');
    expect(urls.some((u) => u.includes('test-workflows/run'))).toBe(false);
  });

  it('blocks navigation dispatch when robot is not IDLE or already has an active job', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-token' });
      }
      if (url === `${REMOTE_API_BASE}/robots`) {
        return jsonResponse({ content: [{ robotId: 'robot-1', robotCode: 'ROBOT_MAR_01' }] });
      }
      if (url.endsWith('/snapshot')) {
        return jsonResponse({
          robot: { status: 'BUSY', batteryRaw: 8500 },
          activeJobId: 'job-running-1',
        });
      }
      if (url.endsWith('/navigation-guidance')) {
        return jsonResponse({ state: 'IDLE' });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const result = await robotMapService.dispatchMoveWorkflow('ep-sos', 'map-1');
    const urls = fetchMock.mock.calls.map(([u]) => (typeof u === 'string' ? u : u.toString()));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('BUSY');
    expect(urls.some((u) => u.includes('/requests/navigation'))).toBe(false);
    expect(urls.some((u) => u.includes('test-workflows/run'))).toBe(false);
  });
});

describe('robotMapService polling & viewer auth optimization', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    robotMapService.resetViewerCache();
  });

  afterEach(() => {
    robotMapService.resetViewerCache();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent getViewerToken calls into a single /auth/login request', async () => {
    let loginCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        loginCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return jsonResponse({ accessToken: 'shared-viewer-jwt' });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const [t1, t2, t3] = await Promise.all([
      robotMapService.getViewerToken(),
      robotMapService.getViewerToken(),
      robotMapService.getViewerToken(),
    ]);

    expect(loginCalls).toBe(1);
    expect(t1).toBe('shared-viewer-jwt');
    expect(t2).toBe('shared-viewer-jwt');
    expect(t3).toBe('shared-viewer-jwt');
  });

  it('applies cooldown backoff when /auth/login fails instead of retrying immediately', async () => {
    let loginCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        loginCalls += 1;
        return jsonResponse({ message: 'Invalid credentials' }, 401);
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const first = await robotMapService.getViewerToken();
    const second = await robotMapService.getViewerToken();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(loginCalls).toBe(1);
  });

  it('skips /navigation-guidance when IDLE without job/plan and fetches it when active', async () => {
    let activeMode = false;
    const requestedUrls: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === `${REMOTE_API_BASE}/robots`) {
        return jsonResponse({ content: [{ robotId: 'robot-opt-1', robotCode: 'ROBOT_MAR_01' }] });
      }
      if (url.endsWith('/snapshot')) {
        if (!activeMode) {
          return jsonResponse({
            robot: { status: 'IDLE', batteryRaw: 8500 },
            activeJobId: null,
            navigationPlan: null,
          });
        }
        return jsonResponse({
          robot: { status: 'BUSY', batteryRaw: 8400 },
          activeJobId: 'job-active-1',
          navigationPlan: {
            endpointId: 'ep-1',
            endpointName: 'Lễ tân',
            points: [
              { xM: 0.5, yM: 2.0 },
              { xM: 0.6, yM: 3.0 },
            ],
          },
        });
      }
      if (url.endsWith('/navigation-guidance')) {
        return jsonResponse({
          state: 'TRACKING',
          direction: 'STRAIGHT',
          remainingCm: 100,
          text: 'Đi thẳng 1 m',
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const idleSnap = await robotMapService.loadRobotSnapshot();
    expect(idleSnap.status).toBe('IDLE');
    expect(requestedUrls.some((u) => u.endsWith('/navigation-guidance'))).toBe(false);

    requestedUrls.length = 0;
    activeMode = true;

    const busySnap = await robotMapService.loadRobotSnapshot();
    expect(busySnap.status).toBe('BUSY');
    expect(requestedUrls.some((u) => u.endsWith('/navigation-guidance'))).toBe(true);
    expect(busySnap.backendGuidance?.state).toBe('TRACKING');
  });

  it('computes adaptive poll intervals for IDLE, active, and offline snapshots', () => {
    expect(
      getAdaptivePollDelayMs({
        pose: null,
        isPoseLive: false,
        status: 'IDLE',
        batteryRaw: 8000,
        mqttConnected: true,
        navigationPlan: null,
        activeJobId: null,
        snapshotReachable: true,
      })
    ).toBe(POLL_INTERVAL_IDLE_MS);

    expect(
      getAdaptivePollDelayMs({
        pose: null,
        isPoseLive: true,
        status: 'BUSY',
        batteryRaw: 8000,
        mqttConnected: true,
        navigationPlan: null,
        activeJobId: 'job-1',
        snapshotReachable: true,
      })
    ).toBe(POLL_INTERVAL_ACTIVE_MS);

    expect(
      getAdaptivePollDelayMs({
        pose: null,
        isPoseLive: false,
        status: 'IDLE',
        batteryRaw: 8000,
        mqttConnected: false,
        navigationPlan: null,
        activeJobId: null,
        snapshotReachable: false,
      })
    ).toBe(POLL_INTERVAL_OFFLINE_MS);
  });
});
