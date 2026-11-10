import { describe, expect, it } from 'vitest';
import {
  DeliveryMission, DeliveryQrChallenge, DeliveryStep, resolveDeliveryStage, selectDeliveryChallenge,
} from '../src/features/logistics/deliveryMission';

const date = '2026-11-10T01:00:00Z';
const now = Date.parse(date);
const jobId = '4e6b0343-679c-4cbc-a6da-3c541ecafff1';
const jobStepId = '40cdbb7f-8333-42f5-b015-7b9e5f124864';

const mission: DeliveryMission = {
  requestId: '4a5bfe75-7997-401f-b8c2-61f1ed84c5a8',
  requestStatus: 'IN_PROGRESS',
  jobId,
  jobStatus: 'RUNNING',
};

function step(stepTypeSnapshot: string, inputs: Record<string, unknown>, status: DeliveryStep['status'] = 'RUNNING'): DeliveryStep {
  return { jobStepId, stepTypeSnapshot, resolvedInputsJson: inputs, status };
}

describe('delivery stage resolution', () => {
  it('shows queued assignment and distinguishes travel to the sender from waiting to load', () => {
    expect(resolveDeliveryStage({ ...mission, jobStatus: 'QUEUED' })).toBe('queued');
    expect(resolveDeliveryStage({ ...mission, step: step('MOVE', {}) })).toBe('toSender');
    expect(resolveDeliveryStage({ ...mission, step: step('MOVE', {}, 'SUCCEEDED') })).toBe('updating');
    expect(resolveDeliveryStage({ ...mission, step: { ...step('MOVE', {}, 'SUCCEEDED'), resultJson: { reached: true } } })).toBe('waitingSender');
  });

  it('uses the authorization purpose at either end', () => {
    expect(resolveDeliveryStage({ ...mission, step: step('AUTHENTICATE', { method: 'QR_CODE', purpose: 'DELIVERY_SENDER' }) })).toBe('authSender');
    expect(resolveDeliveryStage({ ...mission, pickedUpAt: date, step: step('AUTHENTICATE', { method: 'QR_CODE', purpose: 'DELIVERY_RECEIVER' }) })).toBe('authReceiver');
    expect(resolveDeliveryStage({ ...mission, step: step('AUTHENTICATE', { purpose: 'UNKNOWN' }) })).toBe('updating');
  });

  it('keeps unlock pending until the backend opens the payload step', () => {
    const unlock = step('CONTROL_HARDWARE', { action: 'UNLOCK_COMPARTMENT', authorization: { method: 'QR_CODE', purpose: 'DELIVERY_SENDER' } });
    expect(resolveDeliveryStage({ ...mission, step: unlock })).toBe('unlockingSender');
    expect(resolveDeliveryStage({ ...mission, step: step('HANDLE_PAYLOAD', { action: 'LOAD' }, 'PENDING') })).toBe('updating');
    expect(resolveDeliveryStage({ ...mission, step: step('HANDLE_PAYLOAD', { action: 'LOAD' }) })).toBe('loading');
  });

  it('distinguishes verified pickup, transport, receiver unlock and waiting to unload', () => {
    const pickedUp = { ...mission, pickedUpAt: date };
    expect(resolveDeliveryStage({ ...pickedUp, step: step('MOVE', {}, 'PENDING') })).toBe('updating');
    expect(resolveDeliveryStage({ ...pickedUp, step: step('MOVE', {}) })).toBe('transporting');
    expect(resolveDeliveryStage({ ...pickedUp, step: step('CONTROL_HARDWARE', { action: 'UNLOCK_COMPARTMENT' }) })).toBe('unlockingReceiver');
    expect(resolveDeliveryStage({ ...pickedUp, step: step('HANDLE_PAYLOAD', { action: 'UNLOAD' }) })).toBe('pickup');
  });

  it('shows which party is securing the compartment', () => {
    const pickedUp = { ...mission, pickedUpAt: date };
    expect(resolveDeliveryStage({ ...pickedUp, step: step('INTERACT', { prompt_key: 'VERIFY_SENDER' }, 'SUCCEEDED') })).toBe('securingSender');
    expect(resolveDeliveryStage({ ...pickedUp, step: step('INTERACT', { prompt_key: 'CLOSE_RECEIVER' }) })).toBe('securingReceiver');
  });

  it('requires terminal job, completed request and delivery timestamp for success', () => {
    expect(resolveDeliveryStage({ ...mission, jobStatus: 'SUCCEEDED' })).toBe('ended');
    expect(resolveDeliveryStage({ ...mission, jobStatus: 'SUCCEEDED', deliveredAt: date })).toBe('ended');
    expect(resolveDeliveryStage({ ...mission, requestStatus: 'COMPLETED', deliveredAt: date })).toBe('updating');
    expect(resolveDeliveryStage({ ...mission, jobStatus: 'SUCCEEDED', requestStatus: 'COMPLETED', deliveredAt: date })).toBe('completed');
  });

  it('displays cancellation, failure and recovery independently of the last step', () => {
    const active = { ...mission, step: step('AUTHENTICATE', { method: 'QR_CODE', purpose: 'DELIVERY_RECEIVER' }) };
    expect(resolveDeliveryStage({ ...active, cancelRequestedAt: date })).toBe('cancelling');
    expect(resolveDeliveryStage({ ...active, jobStatus: 'CANCELLED' })).toBe('cancelled');
    expect(resolveDeliveryStage({ ...active, jobStatus: 'FAILED' })).toBe('failed');
    expect(resolveDeliveryStage({ ...active, requestStatus: 'RECOVERY_REQUIRED' })).toBe('recovery');
  });
});

describe('delivery QR visibility', () => {
  const active = { ...mission, step: step('AUTHENTICATE', { method: 'QR_CODE', purpose: 'DELIVERY_SENDER' }) };
  const challenge: DeliveryQrChallenge = {
    jobId, authJobStepId: jobStepId, purpose: 'DELIVERY_SENDER',
    challengeId: '0f90d59f-6798-4cc0-88de-80ec62dc746b',
    qrPayload: 'MARQR1.server-provided-proof.signature',
    expiresAt: new Date(now + 1000).toISOString(),
  };

  it('keeps the exact backend proof for the active authentication step', () => {
    expect(selectDeliveryChallenge(active, challenge, now)).toBe(challenge);
  });

  it('clears the QR at expiry and rejects another job, step or purpose', () => {
    expect(selectDeliveryChallenge(active, challenge, now + 1000)).toBeNull();
    expect(selectDeliveryChallenge(active, { ...challenge, jobId: 'other-job' }, now)).toBeNull();
    expect(selectDeliveryChallenge(active, { ...challenge, authJobStepId: 'other-step' }, now)).toBeNull();
    expect(selectDeliveryChallenge(active, { ...challenge, purpose: 'DELIVERY_RECEIVER' }, now)).toBeNull();
  });

  it('clears the QR after no-content, consumption or interruption', () => {
    expect(selectDeliveryChallenge(active, null, now)).toBeNull();
    expect(selectDeliveryChallenge({ ...active, step: step('AUTHENTICATE', { method: 'STAFF_CONFIRMATION', purpose: 'DELIVERY_SENDER' }) }, challenge, now)).toBeNull();
    expect(selectDeliveryChallenge({ ...active, step: step('AUTHENTICATE', { method: 'QR_CODE', purpose: 'DELIVERY_SENDER' }, 'SUCCEEDED') }, challenge, now)).toBeNull();
    expect(selectDeliveryChallenge({ ...active, cancelRequestedAt: date }, challenge, now)).toBeNull();
    expect(selectDeliveryChallenge({ ...active, jobStatus: 'FAILED' }, challenge, now)).toBeNull();
  });
});
