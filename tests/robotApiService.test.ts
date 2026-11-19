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
import { parseSseMediaEventsChunk, robotApiService } from '../src/services/api/robotApiService';
import { getServerClockOffsetMs, resetServerClock } from '../src/services/api/serverClock';
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
    resetServerClock();
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
    resetServerClock();
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

  it('parseSseMediaEventsChunk extracts valid media JSON events across partial chunks and skips keepalives', () => {
    const chunk1 =
      ':keepalive\n\nevent: media\ndata: {"enabled":true,"session":{"sessionId":"s-1","state":"RINGING"}}\n\nevent: media\ndata: {"enabled":true';
    const first = parseSseMediaEventsChunk(chunk1);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.session?.sessionId).toBe('s-1');
    expect(first.events[0]?.session?.state).toBe('RINGING');

    const chunk2 = ',"session":{"sessionId":"s-1","state":"EXPIRED","endReason":"STAFF_NOT_ANSWERED"}}\r\n\r\n';
    const second = parseSseMediaEventsChunk(first.remainder + chunk2);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.session?.state).toBe('EXPIRED');
    expect(second.events[0]?.session?.endReason).toBe('STAFF_NOT_ANSWERED');
    expect(second.remainder).toBe('');
  });

  it('subscribeDeviceMediaEvents streams GET /api/v1/pi/media-session/events with Bearer token and aborts on cleanup', async () => {
    const encoder = new TextEncoder();
    let capturedSignal: AbortSignal | undefined;
    const received: string[] = [];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: media\ndata: {"enabled":true,"session":{"sessionId":"s-sse","incidentId":"inc-1","state":"RINGING"}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'event: media\ndata: {"enabled":true,"session":{"sessionId":"s-sse","incidentId":"inc-1","state":"ACTIVE"}}\n\n',
          ),
        );
      },
    });

    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    global.fetch = fetchMock;

    const unsubscribe = robotApiService.subscribeDeviceMediaEvents((evt) => {
      if (evt.session?.state) received.push(evt.session.state);
    });

    await vi.waitFor(() => {
      expect(received).toEqual(['RINGING', 'ACTIVE']);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/v1/pi/media-session/events');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token-mar');
    expect(headers.Accept).toBe('text/event-stream');

    unsubscribe();
    expect(capturedSignal?.aborted).toBe(true);
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
    resetServerClock();
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

  it('parses selectedJobStepId, selectedStepType and selectedStepCode from snapshot', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === `${REMOTE_API_BASE}/robots`) {
        return jsonResponse({ content: [{ robotId: 'robot-qr-1', robotCode: 'mar-v1' }] });
      }
      if (url.endsWith('/snapshot')) {
        return jsonResponse({
          robot: { status: 'BUSY', batteryRaw: 8800 },
          activeJobId: 'job-qr-123',
          selectedJobStepId: 'step-auth-456',
          selectedStepType: 'AUTHENTICATE',
          selectedStepCode: 'SENDER_AUTH',
        });
      }
      if (url.endsWith('/navigation-guidance')) {
        return jsonResponse({ state: 'IDLE' });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const snap = await robotMapService.loadRobotSnapshot();
    expect(snap.activeJobId).toBe('job-qr-123');
    expect(snap.selectedJobStepId).toBe('step-auth-456');
    expect(snap.selectedStepType).toBe('AUTHENTICATE');
    expect(snap.selectedStepCode).toBe('SENDER_AUTH');
  });

  it('fetches job camera-preview.jpg for 200 JPEG, 204 pending, and 404 unsupported', async () => {
    let mode: 'ok' | 'empty' | 'not_found' = 'ok';
    const sampleJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === `${REMOTE_API_BASE}/jobs/job-cam-1/camera-preview.jpg`) {
        if (mode === 'ok') {
          return new Response(sampleJpeg, {
            status: 200,
            headers: {
              'Content-Type': 'image/jpeg',
              'X-Captured-At': '2026-11-16T05:00:00Z',
              'X-Frame-Revision': '42',
            },
          });
        }
        if (mode === 'empty') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ message: 'Job has no mapping session' }, 404);
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const okRes = await robotMapService.fetchJobCameraPreview('job-cam-1');
    expect(okRes.status).toBe(200);
    expect(okRes.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    expect(okRes.capturedAt).toBe('2026-11-16T05:00:00Z');
    expect(okRes.revision).toBe('42');

    mode = 'empty';
    const emptyRes = await robotMapService.fetchJobCameraPreview('job-cam-1');
    expect(emptyRes.status).toBe(204);
    expect(emptyRes.dataUri).toBeNull();

    mode = 'not_found';
    const nfRes = await robotMapService.fetchJobCameraPreview('job-cam-1');
    expect(nfRes.status).toBe(404);
    expect(nfRes.errorMessage).toContain('404');
  });

  it('checks job QR step completion and preserves purpose from getStaffQrScanWindow', async () => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('device-token', 'robot-qr-1');

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === 'http://localhost:8080/api/v1/pi/jobs/job-qr-1/qr-challenge') {
        return jsonResponse({
          challengeId: 'chal-1',
          authJobStepId: 'step-auth-1',
          purpose: 'DELIVERY_RECEIVER',
          expiresAt: '2026-11-16T05:10:00Z',
        });
      }
      if (url === `${REMOTE_API_BASE}/jobs/job-qr-1`) {
        return jsonResponse({
          job: { status: 'RUNNING' },
          steps: [
            {
              jobStepId: 'step-auth-1',
              stepTypeSnapshot: 'AUTHENTICATE',
              status: 'SUCCEEDED',
              resultJson: { verified: true },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock;

    const win = await robotApiService.getStaffQrScanWindow('job-qr-1');
    expect(win?.purpose).toBe('DELIVERY_RECEIVER');
    expect(win?.authJobStepId).toBe('step-auth-1');

    const status = await robotMapService.checkJobQrStepStatus('job-qr-1', 'step-auth-1');
    expect(status?.verified).toBe(true);
    expect(status?.stepStatus).toBe('SUCCEEDED');
  });

  it('handles GET /api/v1/pi/jobs/{jobId}/face-auth (200, 204, expired, mismatched jobId)', async () => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('device-token', 'robot-face-1');

    const faceJobId = '11111111-1111-4111-8111-111111111111';
    const otherJobId = '22222222-2222-4222-8222-222222222222';
    const faceStepId = '33333333-3333-4333-8333-333333333333';
    const faceSessionId = '44444444-4444-4444-8444-444444444444';

    let mode: 'ok' | 'no_content' | 'wrong_job' | 'expired' = 'ok';
    global.fetch = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `http://localhost:8080/api/v1/pi/jobs/${faceJobId}/face-auth`) {
        if (mode === 'no_content') return new Response(null, { status: 204 });
        if (mode === 'wrong_job') {
          return jsonResponse({
            jobId: otherJobId,
            authJobStepId: faceStepId,
            sessionId: faceSessionId,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          });
        }
        if (mode === 'expired') {
          return jsonResponse({
            jobId: faceJobId,
            authJobStepId: faceStepId,
            sessionId: faceSessionId,
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
          });
        }
        return jsonResponse({
          jobId: faceJobId,
          authJobStepId: faceStepId,
          sessionId: faceSessionId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      return jsonResponse({}, 404);
    });

    const active = await robotApiService.getStaffFaceScanWindow(faceJobId);
    expect(active).toEqual({
      jobId: faceJobId,
      authJobStepId: faceStepId,
      sessionId: faceSessionId,
      expiresAt: active?.expiresAt,
    });

    mode = 'no_content';
    expect(await robotApiService.getStaffFaceScanWindow(faceJobId)).toBeNull();

    mode = 'wrong_job';
    expect(await robotApiService.getStaffFaceScanWindow(faceJobId)).toBeNull();

    mode = 'expired';
    expect(await robotApiService.getStaffFaceScanWindow(faceJobId)).toBeNull();
  });

  it('validates POST /api/v1/pi/jobs/{jobId}/face-auth/verify payload, rejects spoofed transportSessionId and prevents duplicate in-flight verify', async () => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('device-token', 'robot-face-1');

    const faceJobId = '11111111-1111-4111-8111-111111111111';
    const faceStepId = '33333333-3333-4333-8333-333333333333';
    const faceSessionId = '44444444-4444-4444-8444-444444444444';
    const transportSessionId = '55555555-5555-4555-8555-555555555555';

    // Reject using Face window sessionId as transportSessionId
    await expect(
      robotApiService.verifyStaffFace(faceJobId, {
        sessionId: faceSessionId,
        authJobStepId: faceStepId,
        transportSessionId: faceSessionId,
        image: '/9j/4AAQSkZJRg==',
      }),
    ).rejects.toThrow(/FACE_INVALID_TRANSPORT_SESSION/);

    // Reject non-JPEG payload
    await expect(
      robotApiService.verifyStaffFace(faceJobId, {
        sessionId: faceSessionId,
        authJobStepId: faceStepId,
        transportSessionId,
        image: 'iVBORw0KGgoAAAANSUhEUg==',
      }),
    ).rejects.toThrow(/FACE_INVALID_JPEG/);

    let releaseFetch: ((res: Response) => void) | null = null;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        }),
    );
    global.fetch = fetchMock;

    const firstReq = robotApiService.verifyStaffFace(faceJobId, {
      sessionId: faceSessionId,
      authJobStepId: faceStepId,
      transportSessionId,
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await expect(
      robotApiService.verifyStaffFace(faceJobId, {
        sessionId: faceSessionId,
        authJobStepId: faceStepId,
        transportSessionId,
        image: '/9j/4AAQSkZJRg==',
      }),
    ).rejects.toThrow(/FACE_VERIFY_IN_FLIGHT/);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: faceSessionId,
      authJobStepId: faceStepId,
      transportSessionId,
      image: '/9j/4AAQSkZJRg==',
    });

    releaseFetch!(jsonResponse({ verified: false, reason: 'NO_MATCH' }));
    await expect(firstReq).resolves.toEqual({ verified: false, reason: 'NO_MATCH' });
  });

  it('checkJobQrStepStatus isolates sender vs receiver AUTHENTICATE steps and extracts FACE_VERIFICATION metadata', async () => {
    const faceJobId = 'aaaaaaaa-1111-4111-8111-111111111111';
    const senderStepId = 'bbbbbbbb-1111-4111-8111-111111111111';
    const receiverStepId = 'cccccccc-1111-4111-8111-111111111111';
    const senderAcc = 'dddddddd-1111-4111-8111-111111111111';
    const receiverAcc = 'eeeeeeee-1111-4111-8111-111111111111';

    global.fetch = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === `${REMOTE_API_BASE}/jobs/${faceJobId}`) {
        return jsonResponse({
          job: {
            jobId: faceJobId,
            robotId: 'robot-1',
            status: 'RUNNING',
            selectedJobStepId: receiverStepId,
            inputJson: {
              authentication_method: 'FACE_VERIFICATION',
              expected_sender_account_id: senderAcc,
              expected_receiver_account_id: receiverAcc,
            },
          },
          steps: [
            {
              jobStepId: senderStepId,
              stepTypeSnapshot: 'AUTHENTICATE',
              stepCodeSnapshot: 'AUTH_SENDER',
              status: 'SUCCEEDED',
              resolvedInputsJson: { method: 'FACE_VERIFICATION', purpose: 'DELIVERY_SENDER' },
              resultJson: { verified: true, purpose: 'DELIVERY_SENDER', actor_account_id: senderAcc },
            },
            {
              jobStepId: receiverStepId,
              stepTypeSnapshot: 'AUTHENTICATE',
              stepCodeSnapshot: 'AUTH_RECEIVER',
              status: 'RUNNING',
              resolvedInputsJson: { method: 'FACE_VERIFICATION', purpose: 'DELIVERY_RECEIVER' },
              resultJson: { action: 'AWAIT_FACE_VERIFICATION', expires_at: '2026-11-19T12:00:00Z' },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    // Must return RECEIVER RUNNING (not verified), never fallback to SUCCEEDED SENDER step
    const receiverStatus = await robotMapService.checkJobQrStepStatus(faceJobId, receiverStepId);
    expect(receiverStatus?.verified).toBe(false);
    expect(receiverStatus?.stepStatus).toBe('RUNNING');
    expect(receiverStatus?.authMethod).toBe('FACE_VERIFICATION');
    expect(receiverStatus?.purpose).toBe('DELIVERY_RECEIVER');
    expect(receiverStatus?.expectedAccountId).toBe(receiverAcc);

    // Asking for an unknown stepId must NOT fall back to sender's SUCCEEDED step
    const missingStep = await robotMapService.checkJobQrStepStatus(faceJobId, 'ffffffff-1111-4111-8111-111111111111');
    expect(missingStep?.verified).toBe(false);
    expect(missingStep?.stepStatus).toBeNull();
  });

  it('compensates tablet clock skew using server Date header in getStaffFaceScanWindow and keeps AUTH_SENDER as QR_CODE', async () => {
    apiClient.setBaseUrl('http://localhost:8080');
    apiClient.setToken('device-token', 'robot-face-1');

    const jobId = 'aaaaaaaa-2222-4222-8222-222222222222';
    const stepId = 'bbbbbbbb-2222-4222-8222-222222222222';
    const senderStepId = 'cccccccc-2222-4222-8222-222222222222';
    const sessionId = 'dddddddd-2222-4222-8222-222222222222';

    // Tablet clock is 5 minutes ahead of server Date header; window expires in 60s on server time
    const localNow = Date.now();
    const serverNowMs = localNow - 300_000;
    const serverDateHeader = new Date(serverNowMs).toUTCString();
    const windowExpiresAt = new Date(serverNowMs + 60_000).toISOString();

    let mode: 'window' | 'no_content' | 'net_error' | 'bad_jpeg' = 'window';
    global.fetch = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === `http://localhost:8080/api/v1/pi/jobs/${jobId}/face-auth`) {
        if (mode === 'no_content') {
          return new Response(null, { status: 204, headers: { Date: serverDateHeader } });
        }
        if (mode === 'net_error') {
          throw new Error('ECONNRESET');
        }
        return new Response(
          JSON.stringify({
            jobId,
            authJobStepId: stepId,
            sessionId,
            expiresAt: windowExpiresAt,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              Date: serverDateHeader,
            },
          },
        );
      }
      if (url === `${REMOTE_API_BASE}/jobs/${jobId}/camera-preview.jpg`) {
        return new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', Date: serverDateHeader },
        });
      }
      if (url === `${REMOTE_API_BASE}/jobs/${jobId}`) {
        return jsonResponse({
          job: {
            jobId,
            robotId: 'robot-1',
            status: 'RUNNING',
            selectedJobStepId: senderStepId,
            inputJson: { authentication_method: 'FACE_VERIFICATION' },
          },
          steps: [
            {
              jobStepId: senderStepId,
              stepTypeSnapshot: 'AUTHENTICATE',
              stepCodeSnapshot: 'AUTH_SENDER',
              status: 'RUNNING',
              resolvedInputsJson: { purpose: 'DELIVERY_SENDER' },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    // Without server clock compensation Date.parse(windowExpiresAt) <= Date.now() would wrongly return null
    const win = await robotApiService.getStaffFaceScanWindow(jobId, { throwOnError: true });
    expect(win).toEqual({
      jobId,
      authJobStepId: stepId,
      sessionId,
      expiresAt: windowExpiresAt,
    });
    expect(getServerClockOffsetMs()).toBeLessThan(-250_000);

    // HTTP 204 returns null even with throwOnError: true
    mode = 'no_content';
    await expect(
      robotApiService.getStaffFaceScanWindow(jobId, { throwOnError: true }),
    ).resolves.toBeNull();

    // Network failure throws when throwOnError: true
    mode = 'net_error';
    await expect(
      robotApiService.getStaffFaceScanWindow(jobId, { throwOnError: true }),
    ).rejects.toThrow();

    // Invalid JPEG magic bytes rejected on HTTP 200
    const badFrame = await robotMapService.fetchJobCameraPreview(jobId);
    expect(badFrame.status).toBe(200);
    expect(badFrame.dataUri).toBeNull();
    expect(badFrame.errorMessage).toContain('JPEG');

    // AUTH_SENDER must NOT inherit FACE_VERIFICATION from job inputJson.authentication_method
    const senderStatus = await robotMapService.checkJobQrStepStatus(jobId, senderStepId);
    expect(senderStatus?.purpose).toBe('DELIVERY_SENDER');
    expect(senderStatus?.authMethod).toBe('QR_CODE');
  });

  it('loads ACTIVE voice interaction with cached command text, extracts navigation speech cue, and keeps active poll cadence when chatting', async () => {
    const robotId = 'aaaaaaaa-3333-4333-8333-333333333333';
    const interactionId = 'bbbbbbbb-3333-4333-8333-333333333333';
    const commandId = 'cccccccc-3333-4333-8333-333333333333';
    let detailFetches = 0;
    let hasActiveInteraction = true;

    global.fetch = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${REMOTE_API_BASE}/auth/login`) {
        return jsonResponse({ accessToken: 'viewer-tok' });
      }
      if (url === `${REMOTE_API_BASE}/voice/interactions?robotId=${robotId}&status=ACTIVE&page=0&size=1`) {
        return jsonResponse({
          content: hasActiveInteraction
            ? [
                {
                  voiceInteractionId: interactionId,
                  robotId,
                  status: 'ACTIVE',
                  startedAt: '2026-11-19T09:59:50Z',
                  detectedIntent: 'ASK_INFO',
                },
              ]
            : [],
        });
      }
      if (url === `${REMOTE_API_BASE}/voice/commands?interactionId=${interactionId}&page=0&size=1`) {
        return jsonResponse({
          content: [
            {
              voiceCommandId: commandId,
              voiceInteractionId: interactionId,
              intentCode: 'ASK_INFO',
              rawDataAvailable: true,
              receivedAt: '2026-11-19T10:00:00Z',
              processedAt: '2026-11-19T10:00:02Z',
            },
          ],
        });
      }
      if (url === `${REMOTE_API_BASE}/voice/commands/${commandId}`) {
        detailFetches += 1;
        return jsonResponse({
          voiceCommandId: commandId,
          rawText: 'Quầy thuốc ở đâu?',
          intentCode: 'ASK_INFO',
          parameters: { answer_text: 'Quầy thuốc nằm ở tầng 1, khu A.' },
          processedAt: '2026-11-19T10:00:02Z',
        });
      }
      if (url === `${REMOTE_API_BASE}/robots`) {
        return jsonResponse({ content: [{ robotId, robotCode: 'ROBOT_MAR_01' }] });
      }
      if (url.endsWith(`/robots/${robotId}/snapshot`)) {
        return jsonResponse({
          robot: { robotId, status: 'BUSY', batteryRaw: 8500 },
          activeJobId: 'job-nav-1',
          navigationPlan: {
            endpointId: 'ep-1',
            endpointName: 'Quầy Thuốc',
            points: [
              { xM: 0.5, yM: 1.0 },
              { xM: 1.5, yM: 1.0 },
            ],
          },
        });
      }
      if (url.endsWith(`/robots/${robotId}/navigation-guidance`)) {
        return jsonResponse({
          state: 'TRACKING',
          direction: 'LEFT',
          distanceCm: 65,
          remainingCm: 140,
          text: 'Còn 65 cm, rẽ trái',
          interaction: {
            stepType: 'INTERACT',
            direction: 'LEFT',
            params: {
              action: 'SPEAK',
              prompt_key: 'NAVIGATION_LEFT',
              data: { text: 'Chuẩn bị rẽ trái.' },
            },
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const first = await robotMapService.loadActiveVoiceInteraction(robotId);
    const second = await robotMapService.loadActiveVoiceInteraction(robotId);
    expect(first).toEqual({
      voiceInteractionId: interactionId,
      robotId,
      status: 'ACTIVE',
      startedAt: '2026-11-19T09:59:50Z',
      detectedIntent: 'ASK_INFO',
      latestCommandId: commandId,
      lastUserText: 'Quầy thuốc ở đâu?',
      lastAnswerText: 'Quầy thuốc nằm ở tầng 1, khu A.',
      lastIntentCode: 'ASK_INFO',
      lastCommandAt: '2026-11-19T10:00:02Z',
    });
    expect(second).toEqual(first);
    expect(detailFetches).toBe(1);

    // Idle snapshot still uses active poll cadence when basic voice interaction is ACTIVE
    expect(
      getAdaptivePollDelayMs(
        {
          pose: null,
          isPoseLive: false,
          status: 'IDLE',
          batteryRaw: 8500,
          mqttConnected: true,
          navigationPlan: null,
          activeJobId: null,
          snapshotReachable: true,
        },
        true,
      ),
    ).toBe(POLL_INTERVAL_ACTIVE_MS);

    hasActiveInteraction = false;
    expect(await robotMapService.loadActiveVoiceInteraction(robotId)).toBeNull();

    // Navigation guidance preserves spoken LEFT cue for map overlay banner
    robotMapService.resetViewerCache();
    process.env.EXPO_PUBLIC_ROBOT_ID = robotId;
    try {
      const snap = await robotMapService.loadRobotSnapshot();
      expect(snap.backendGuidance?.direction).toBe('LEFT');
      expect(snap.backendGuidance?.speechText).toBe('Chuẩn bị rẽ trái.');
      expect(snap.backendGuidance?.promptKey).toBe('NAVIGATION_LEFT');
    } finally {
      delete process.env.EXPO_PUBLIC_ROBOT_ID;
    }
  });
});
