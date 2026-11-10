import { apiClient } from '../../services/api/client';
import { DeliveryItem, DeliveryMission, DeliveryQrChallenge, DeliveryReadResult, DeliveryReader } from './deliveryMission';

export const DEFAULT_DELIVERY_BRIDGE_URL = process.env.EXPO_PUBLIC_DELIVERY_BRIDGE_URL?.trim() ?? '';

export type DeliveryConnection =
  | { mode: 'bridge'; url: string; pairingToken: string }
  | { mode: 'device'; jobId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requestStatuses = ['DRAFT', 'SUBMITTED', 'QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED'];
const jobStatuses = ['QUEUED', 'ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED'];
const stepStatuses = ['PENDING', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'RECOVERY_REQUIRED'];

export function bridgeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
  } catch {
    return null;
  }
}

export function isDeliveryJobId(value: string): boolean {
  return uuid.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function challengeOf(value: unknown): DeliveryQrChallenge {
  if (!record(value) || !identifier(value.challengeId) || !identifier(value.jobId)
      || !identifier(value.authJobStepId) || !['DELIVERY_SENDER', 'DELIVERY_RECEIVER'].includes(String(value.purpose))
      || typeof value.qrPayload !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(value.qrPayload)
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new Error('Invalid delivery QR response');
  }
  return value as unknown as DeliveryQrChallenge;
}

function partyOf(value: unknown) {
  if (!record(value)) return undefined;
  return {
    name: typeof value.name === 'string' ? value.name : null,
    location: typeof value.location === 'string' ? value.location : null,
  };
}

function missionOf(value: unknown): DeliveryMission {
  if (!record(value) || !identifier(value.requestId) || !identifier(value.jobId)
      || !requestStatuses.includes(String(value.requestStatus)) || !jobStatuses.includes(String(value.jobStatus))) {
    throw new Error('Invalid delivery mission response');
  }
  if (value.step != null && (!record(value.step) || !identifier(value.step.jobStepId)
      || typeof value.step.stepTypeSnapshot !== 'string' || !stepStatuses.includes(String(value.step.status)))) {
    throw new Error('Invalid delivery step response');
  }
  const data = value as unknown as DeliveryMission;
  return {
    ...data,
    requestCode: typeof data.requestCode === 'string' ? data.requestCode : null,
    sender: partyOf(data.sender),
    receiver: partyOf(data.receiver),
    items: Array.isArray(data.items) ? data.items.flatMap(itemOf) : [],
    pickedUpAt: validDate(data.pickedUpAt),
    deliveredAt: validDate(data.deliveredAt),
  };
}

function itemOf(value: unknown): DeliveryItem[] {
  if (!record(value) || typeof value.quantity !== 'number'
      || !Number.isSafeInteger(value.quantity) || value.quantity < 1) return [];
  return [{
    itemName: typeof value.itemName === 'string' ? value.itemName : null,
    quantity: value.quantity,
    unit: typeof value.unit === 'string' ? value.unit : null,
  }];
}

function validDate(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

async function withDeadline<T>(parent: AbortSignal, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (parent.aborted) stop();
  parent.addEventListener('abort', stop, { once: true });
  // The read-only bridge has a 20s aggregate budget including initial logins.
  const timeout = setTimeout(stop, 25000);
  try {
    return await read(controller.signal);
  } finally {
    clearTimeout(timeout);
    parent.removeEventListener('abort', stop);
  }
}

export function createDeliveryReader(connection: DeliveryConnection): DeliveryReader {
  return {
    read: (signal) => withDeadline(signal, async (requestSignal): Promise<DeliveryReadResult> => {
      if (connection.mode === 'bridge') {
        const response = await fetch(`${connection.url}/delivery/snapshot`, {
          headers: { Accept: 'application/json', 'X-MAR-Display-Key': connection.pairingToken },
          signal: requestSignal,
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Delivery bridge unavailable');
        const data: unknown = await response.json();
        if (!record(data) || !identifier(data.robotId) || !('mission' in data) || !('challenge' in data)) {
          throw new Error('Invalid delivery bridge response');
        }
        const updatedAt = validDate(data.updatedAt);
        if (!updatedAt || Math.abs(Date.now() - Date.parse(updatedAt)) > 20_000) {
          throw new Error('Stale delivery bridge response');
        }
        return {
          robotId: data.robotId,
          mission: data.mission === null ? null : missionOf(data.mission),
          challenge: data.challenge === null ? null : challengeOf(data.challenge),
        };
      }

      const token = await apiClient.ensureDeviceToken(undefined, undefined, requestSignal);
      const robotId = apiClient.getRobotId();
      if (!token || !robotId) throw new Error('Device session unavailable');
      const jobId = connection.jobId;
      const response = await fetch(`${apiClient.getBaseUrl()}/api/v1/pi/jobs/${encodeURIComponent(jobId)}/qr-challenge`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: requestSignal,
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Device QR unavailable');
      if (response.status === 204) return { robotId, mission: null, challenge: null };
      const challenge = challengeOf(await response.json());
      if (challenge.jobId !== jobId) throw new Error('Device QR belongs to another job');
      return {
        robotId,
        mission: {
          jobId,
          jobStatus: 'RUNNING',
          step: {
            jobStepId: challenge.authJobStepId,
            stepTypeSnapshot: 'AUTHENTICATE',
            status: 'RUNNING',
            resolvedInputsJson: { method: 'QR_CODE', purpose: challenge.purpose },
          },
        },
        challenge,
      };
    }),
  };
}
