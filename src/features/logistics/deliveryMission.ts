export type DeliveryPurpose = 'DELIVERY_SENDER' | 'DELIVERY_RECEIVER';

export type DeliveryJobStatus =
  | 'QUEUED' | 'ACCEPTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'RECOVERY_REQUIRED';

export type DeliveryRequestStatus =
  | 'DRAFT' | 'SUBMITTED' | 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'RECOVERY_REQUIRED';

export type DeliveryStepStatus =
  | 'PENDING' | 'RUNNING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED' | 'RECOVERY_REQUIRED';

export interface DeliveryStep {
  jobStepId: string;
  stepTypeSnapshot: string;
  stepCodeSnapshot?: string | null;
  status: DeliveryStepStatus;
  resolvedInputsJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  interruptionRequestedAt?: string | null;
}

export interface DeliveryParty {
  name?: string | null;
  location?: string | null;
}

export interface DeliveryItem {
  itemName?: string | null;
  quantity: number;
  unit?: string | null;
}

export interface DeliveryMission {
  requestId?: string;
  requestCode?: string | null;
  requestStatus?: DeliveryRequestStatus;
  jobId: string;
  jobStatus: DeliveryJobStatus;
  cancelRequestedAt?: string | null;
  step?: DeliveryStep | null;
  sender?: DeliveryParty;
  receiver?: DeliveryParty;
  items?: DeliveryItem[];
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
}

export interface DeliveryQrChallenge {
  challengeId: string;
  jobId: string;
  authJobStepId: string;
  purpose: DeliveryPurpose;
  qrPayload: string;
  expiresAt: string;
}

export interface DeliveryReadResult {
  robotId: string;
  mission: DeliveryMission | null;
  challenge: DeliveryQrChallenge | null;
}

export interface DeliveryReader {
  read(signal: AbortSignal): Promise<DeliveryReadResult>;
}

export type DeliveryStage =
  | 'queued' | 'toSender' | 'waitingSender' | 'authSender' | 'authReceiver'
  | 'unlockingSender' | 'unlockingReceiver' | 'loading' | 'transporting' | 'pickup'
  | 'securingSender' | 'securingReceiver' | 'updating' | 'completed' | 'ended'
  | 'failed' | 'cancelled' | 'cancelling' | 'recovery';

export function getDeliveryPurpose(step: DeliveryStep): DeliveryPurpose | null {
  const purpose = step.resolvedInputsJson?.purpose ?? step.resultJson?.purpose;
  return purpose === 'DELIVERY_SENDER' || purpose === 'DELIVERY_RECEIVER' ? purpose : null;
}

export function resolveDeliveryStage(mission: DeliveryMission): DeliveryStage {
  const { requestStatus, jobStatus, step } = mission;
  if ([requestStatus, jobStatus, step?.status].includes('RECOVERY_REQUIRED')) return 'recovery';
  if ([requestStatus, jobStatus].includes('CANCELLED')) return 'cancelled';
  if ([requestStatus, jobStatus].includes('FAILED')) return 'failed';
  if (mission.cancelRequestedAt || step?.interruptionRequestedAt) return 'cancelling';
  if (jobStatus === 'SUCCEEDED') {
    return mission.deliveredAt && requestStatus === 'COMPLETED' ? 'completed' : 'ended';
  }
  if (jobStatus === 'QUEUED' || jobStatus === 'ACCEPTED') return 'queued';
  if (jobStatus !== 'RUNNING' || !step) return 'updating';

  const action = step.resolvedInputsJson?.action;
  if (step.stepTypeSnapshot === 'AUTHENTICATE' && step.status === 'RUNNING') {
    const purpose = getDeliveryPurpose(step);
    if (purpose) return purpose === 'DELIVERY_SENDER' ? 'authSender' : 'authReceiver';
  }
  if (step.stepTypeSnapshot === 'CONTROL_HARDWARE' && action === 'UNLOCK_COMPARTMENT'
      && ['PENDING', 'RUNNING', 'RETRYING'].includes(step.status)) {
    const authorization = step.resolvedInputsJson?.authorization;
    const purpose = authorization && typeof authorization === 'object' && 'purpose' in authorization
      ? authorization.purpose : null;
    return purpose === 'DELIVERY_RECEIVER' || (purpose == null && mission.pickedUpAt)
      ? 'unlockingReceiver' : 'unlockingSender';
  }
  if (step.status === 'RUNNING' && step.stepTypeSnapshot === 'HANDLE_PAYLOAD') {
    if (action === 'LOAD') return 'loading';
    if (action === 'UNLOAD') return 'pickup';
  }
  if (step.stepTypeSnapshot === 'MOVE' && step.status === 'RUNNING') {
    return mission.pickedUpAt ? 'transporting' : 'toSender';
  }
  if (step.status === 'SUCCEEDED' && step.stepTypeSnapshot === 'MOVE'
      && step.resultJson?.reached === true && !mission.pickedUpAt) {
    return 'waitingSender';
  }
  const prompt = step.resolvedInputsJson?.prompt_key;
  const securing = action === 'LOCK_COMPARTMENT'
    || (typeof prompt === 'string' && [
      'CLOSE_SENDER', 'CLOSE_RECEIVER', 'CONFIRM_COMPARTMENT_CLOSED',
      'STAFF_CLOSE_DOOR_AND_CLEAR_MECHANISM', 'VERIFY_SENDER', 'VERIFY_RECEIVER',
      'VERIFY_COMPARTMENT_LOCKED', 'STAFF_PHYSICALLY_VERIFY_LOCK',
    ].includes(prompt));
  if (securing && ['PENDING', 'RUNNING', 'SUCCEEDED'].includes(step.status)) {
    const handover = typeof prompt === 'string' && /_(SENDER|RECEIVER)$/.test(prompt) ? prompt : step.stepCodeSnapshot;
    if (handover?.endsWith('_SENDER')) return 'securingSender';
    if (handover?.endsWith('_RECEIVER')) return 'securingReceiver';
    return mission.pickedUpAt ? 'securingReceiver' : 'securingSender';
  }
  return 'updating';
}

export function selectDeliveryChallenge(
  mission: DeliveryMission | null,
  challenge: DeliveryQrChallenge | null,
  now: number,
): DeliveryQrChallenge | null {
  if (!mission || !challenge || challenge.jobId !== mission.jobId
      || challenge.authJobStepId !== mission.step?.jobStepId
      || mission.step.resolvedInputsJson?.method !== 'QR_CODE'
      || !challenge.qrPayload.trim() || !(Date.parse(challenge.expiresAt) > now)) {
    return null;
  }
  const stage = resolveDeliveryStage(mission);
  const matches = (stage === 'authSender' && challenge.purpose === 'DELIVERY_SENDER')
    || (stage === 'authReceiver' && challenge.purpose === 'DELIVERY_RECEIVER');
  return matches ? challenge : null;
}
