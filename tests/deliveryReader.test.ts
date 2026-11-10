import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));

import { apiClient } from '../src/services/api/client';
import { bridgeOrigin, createDeliveryReader } from '../src/features/logistics/deliveryReader';
import { resolveDeliveryStage, selectDeliveryChallenge } from '../src/features/logistics/deliveryMission';

const robotId = '093cafbc-7e4f-414b-b81e-99ece96804c9';
const jobId = 'cf1cf937-cfa0-4147-903e-8d454792239f';
const jobStepId = '01331117-84bd-42d5-a79b-39f97c73f4f4';
const proof = {
  challengeId: '97476f76-cced-4230-8c73-ab8f2cdc8ba8',
  jobId,
  authJobStepId: jobStepId,
  purpose: 'DELIVERY_RECEIVER',
  qrPayload: 'MARQR1.signed-payload.signature',
  expiresAt: '2099-11-10T01:00:00Z',
};

const bridgeReader = createDeliveryReader({ mode: 'bridge', url: 'http://127.0.0.1:8790', pairingToken: 'local-pairing-key' });
const deviceReader = createDeliveryReader({ mode: 'device', jobId });

const testFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  testFetch.mockReset();
  vi.stubGlobal('fetch', testFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('delivery display transport', () => {
  it('accepts a bridge origin and disallows credentials, path and query', () => {
    expect(bridgeOrigin(' https://bridge.example:8790/ ')).toBe('https://bridge.example:8790');
    expect(bridgeOrigin('http://login:pass@bridge.example')).toBeNull();
    expect(bridgeOrigin('http://bridge.example/delivery')).toBeNull();
    expect(bridgeOrigin('http://bridge.example?key=x')).toBeNull();
    expect(bridgeOrigin('ftp://bridge.example')).toBeNull();
  });

  it('uses only the display pairing key for an idle bridge read', async () => {
    testFetch.mockResolvedValueOnce(Response.json({ robotId, mission: null, challenge: null, updatedAt: new Date().toISOString() }));
    await expect(bridgeReader.read(new AbortController().signal)).resolves.toEqual({ robotId, mission: null, challenge: null });
    expect(testFetch).toHaveBeenCalledOnce();
    expect(testFetch).toHaveBeenCalledWith('http://127.0.0.1:8790/delivery/snapshot', expect.objectContaining({
      headers: { Accept: 'application/json', 'X-MAR-Display-Key': 'local-pairing-key' },
      redirect: 'error',
    }));
  });

  it('accepts the paired mission and matches an exact receiver QR', async () => {
    testFetch.mockResolvedValueOnce(Response.json({
      robotId,
      updatedAt: new Date().toISOString(),
      mission: {
        requestId: 'ffdc1eae-c3b0-44af-8902-b79822499f99',
        requestCode: 'DEL-TEST',
        requestStatus: 'IN_PROGRESS',
        jobId,
        jobStatus: 'RUNNING',
        step: {
          jobStepId, stepTypeSnapshot: 'AUTHENTICATE', status: 'RUNNING',
          resolvedInputsJson: { method: 'QR_CODE', purpose: 'DELIVERY_RECEIVER' },
        },
        sender: { name: 'Nhân viên A', location: 'Phòng A' },
      },
      challenge: proof,
    }));
    const snapshot = await bridgeReader.read(new AbortController().signal);
    expect(snapshot.mission?.sender?.name).toBe('Nhân viên A');
    expect(selectDeliveryChallenge(snapshot.mission, snapshot.challenge, Date.now())?.qrPayload).toBe(proof.qrPayload);
  });

  it('rejects an outdated bridge snapshot', async () => {
    testFetch.mockResolvedValueOnce(Response.json({
      robotId, mission: null, challenge: null, updatedAt: '2000-01-01T00:00:00Z',
    }));
    await expect(bridgeReader.read(new AbortController().signal)).rejects.toThrow('Stale');
  });

  it('passes connection cancellation through to the bridge request', async () => {
    testFetch.mockImplementationOnce(async (_url, init) => {
      if (!init?.signal) throw new Error('Missing signal');
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const controller = new AbortController();
    const read = bridgeReader.read(controller.signal);
    controller.abort();
    await expect(read).rejects.toThrow('aborted');
  });

  it('represents the current phase only while the Device QR endpoint confirms it', async () => {
    vi.spyOn(apiClient, 'ensureDeviceToken').mockResolvedValue('test-device-token');
    vi.spyOn(apiClient, 'getRobotId').mockReturnValue(robotId);
    testFetch.mockResolvedValueOnce(Response.json(proof)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const active = await deviceReader.read(new AbortController().signal);
    expect(active.mission && resolveDeliveryStage(active.mission)).toBe('authReceiver');
    expect(active.mission?.requestStatus).toBeUndefined();
    expect(testFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/pi/jobs/${jobId}/qr-challenge`), expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer test-device-token' },
    }));
    await expect(deviceReader.read(new AbortController().signal)).resolves.toEqual({ robotId, mission: null, challenge: null });
  });

  it('rejects a Device response for a different job', async () => {
    vi.spyOn(apiClient, 'ensureDeviceToken').mockResolvedValue('test-device-token');
    vi.spyOn(apiClient, 'getRobotId').mockReturnValue(robotId);
    testFetch.mockResolvedValueOnce(Response.json({ ...proof, jobId: robotId }));
    await expect(deviceReader.read(new AbortController().signal)).rejects.toThrow('another job');
  });
});
