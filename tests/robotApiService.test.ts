import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      hostUri: '127.0.0.1:8081',
    },
  },
}));

import { apiClient } from '../src/services/api/client';
import { createPiEnvelope } from '../src/services/api/envelope';
import { robotApiService } from '../src/services/api/robotApiService';

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
});
