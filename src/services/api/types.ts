// API Type Definitions for MediAssistRover Backend (OpenAPI 3.1.0)

export interface DeviceAuthRequest {
  robotCode: string;
  deviceSecret: string;
}

export interface DeviceTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  robotId: string;
}

export interface PiEnvelope<T> {
  protocolVersion: string;
  messageId: string;
  operationKey?: string;
  correlationId?: string;
  robotId?: string;
  jobId?: string;
  jobStepId?: string;
  messageType?: string;
  occurredAt: string;
  producerSessionId?: string;
  sequenceNo: number;
  payload: T;
}

export interface AckResponse {
  receivedAt: string;
  sequenceNo?: number;
  status?: string;
}

export type RobotStatusCode =
  | 'OFFLINE'
  | 'STARTING'
  | 'IDLE'
  | 'BUSY'
  | 'EMERGENCY_STOP'
  | 'ERROR'
  | 'MAINTENANCE';

export interface HeartbeatPayload {
  status: RobotStatusCode;
  runtimeVersion?: string;
  firmwareVersion?: string;
  protocolMajor?: number;
  batteryRaw?: number; // 0 - 100 percentage or raw
  batteryUnit?: 'UNKNOWN' | 'MILLIVOLT' | 'RAW_ADC';
  batteryCapturedAt?: string;
  errorCode?: string;
  currentMapId?: string;
}

export interface LocationPayload {
  mapId?: string;
  xM: number;
  yM: number;
  yawRad: number;
  localizationConfidence?: number;
  fresh?: boolean;
  capturedAt?: string;
}

export interface SosPayload {
  mapId?: string;
  endpointId?: string;
  severity: 'WARNING' | 'CRITICAL';
  description?: string;
  xM?: number;
  yM?: number;
}

export type SosRoutingStatus =
  | 'ASSIGNED'
  | 'NO_MONITORING_ROOM'
  | 'ROOM_UNAVAILABLE'
  | 'NO_ACTIVE_SHIFT'
  | 'AMBIGUOUS_SHIFT'
  | string;

export interface IncidentResponse {
  incidentId: string;
  robotId?: string;
  mapId?: string;
  endpointId?: string;
  acknowledgedByAccountId?: string;
  resolvedByAccountId?: string;
  incidentType?: string;
  severity?: 'WARNING' | 'CRITICAL';
  status: 'REPORTED' | 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'FALSE_ALARM';
  description?: string;
  xM?: number;
  yM?: number;
  occurredAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  rowVersion?: number;
  sosResponderAccountId?: string | null;
  sosRoutingStatus?: SosRoutingStatus | null;
}

export interface SosResponse {
  incident?: IncidentResponse;
  serviceRequestId?: string;
  alertId?: string;
  jobId?: string;
  receivedAt?: string;
}

export interface DeviceIncidentStatusResponse {
  incidentId: string;
  robotId?: string;
  mapId?: string;
  endpointId?: string;
  severity?: string;
  status: 'REPORTED' | 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'FALSE_ALARM';
  description?: string;
  xM?: number;
  yM?: number;
  occurredAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  serviceRequestId?: string;
  requestStatus?: string;
  alertId?: string;
  alertStatus?: string;
  jobId?: string;
  jobStatus?: string;
}

export interface JobErrorPayload {
  errorCode: string;
  failureReason?: string;
  details?: Record<string, unknown>;
}

export interface StepErrorPayload {
  errorCode: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export interface JobResultPayload {
  result?: Record<string, unknown>;
}

export interface StepResultPayload {
  result?: Record<string, unknown>;
}

export interface NavigationCreateRequest {
  mapId?: string;
  workflowId?: string;
  roomId?: string;
  originEndpointId?: string;
  destinationEndpointId?: string;
  destinationGroupId?: string;
  targetMode?: 'ENDPOINT' | 'ENDPOINT_GROUP';
  navigationMode?: 'STANDARD' | 'ACCESSIBLE';
  accessibilityNeed?: string;
  passengerCount?: number;
  arrivalInstruction?: string;
  priority?: number;
  note?: string;
  robotId?: string;
  navigationSessionId?: string;
}

export interface NavigationResponse {
  request: {
    serviceRequestId: string;
    requestCode?: string;
    requestType?: string;
    status?: string;
    priority?: number;
    requestNote?: string;
    requestedAt?: string;
  };
  mapId?: string;
  workflowId?: string;
  roomId?: string;
  originEndpointId?: string;
  destinationEndpointId?: string;
  destinationGroupId?: string;
  resolvedEndpointId?: string;
  targetMode?: string;
  navigationMode?: string;
  accessibilityNeed?: string;
  passengerCount?: number;
  arrivalInstruction?: string;
}

export interface PublishedWorkflowItem {
  workflow: {
    workflowId: string;
    workflowCode?: string;
    workflowName?: string;
    serviceType?: string;
    versionNo?: number;
    status?: string;
    acceptsNewJobs?: boolean;
    schemaVersion?: number;
  };
}

export interface EscortCreateRequest {
  mapId?: string;
  originRoomId?: string;
  destinationRoomId?: string;
  originEndpointId?: string;
  destinationEndpointId?: string;
  destinationGroupId?: string;
  targetMode?: 'ENDPOINT' | 'ENDPOINT_GROUP';
  patientReference?: string;
  escortMode?: 'GUIDED' | 'ASSISTED';
  walkingSpeedMps?: number;
  confirmationTimeoutSec?: number;
  escortNote?: string;
  priority?: number;
  note?: string;
}

export interface EscortResponse {
  request: {
    serviceRequestId: string;
    requestCode?: string;
    requestType?: string;
    status?: string;
    priority?: number;
    requestNote?: string;
    requestedAt?: string;
  };
  mapId?: string;
  originRoomId?: string;
  destinationRoomId?: string;
  originEndpointId?: string;
  destinationEndpointId?: string;
  destinationGroupId?: string;
  resolvedEndpointId?: string;
  targetMode?: string;
  patientReference?: string;
  escortMode?: string;
  walkingSpeedMps?: number;
  confirmationTimeoutSec?: number;
  escortNote?: string;
}

export interface DeviceJobSummary {
  jobId: string;
  jobCode?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  robotId?: string;
  errorCode?: string;
  failureReason?: string;
  queuedAt?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface DeviceRequestDetailResponse {
  serviceRequestId: string;
  requestCode?: string;
  requestType?: string;
  status:
    | 'SUBMITTED'
    | 'ASSIGNED'
    | 'DISPATCHED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'FAILED';
  priority?: number;
  requestNote?: string;
  requestedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  jobs?: DeviceJobSummary[];
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

export interface RoomResponse {
  id?: string;
  roomId?: string;
  code?: string;
  roomCode?: string;
  name?: string;
  roomName?: string;
  roomType?: string;
  zoneId?: string;
  floorId?: string;
  departmentCode?: string;
  description?: string;
  active?: boolean;
}

export interface ZoneResponse {
  id?: string;
  zoneId?: string;
  code?: string;
  zoneCode?: string;
  name?: string;
  zoneName?: string;
  floorId?: string;
  mapId?: string;
  zoneType?: string;
  description?: string;
  active?: boolean;
}

export interface FloorResponse {
  id: string;
  code: string;
  name: string;
  floorNumber?: number;
  active?: boolean;
}

export interface EndpointResponse {
  id: string;
  code: string;
  name: string;
  endpointType?: string;
  roomId?: string;
  xM?: number;
  yM?: number;
}

export interface HospitalInformationResponse {
  id?: string;
  hospitalInformationId?: string;
  infoCategory?: string;
  title?: string;
  content?: string;
  languageCode?: string;
  hospitalName?: string;
  address?: string;
  hotline?: string;
}

/**
 * Request body for POST /api/v1/pi/jobs/{jobId}/staff-phone-qr/verify
 * Robot quét mã QR trên điện thoại Staff rồi gửi proof lên server.
 */
export interface CameraVerifyRequest {
  authJobStepId: string;
  transportSessionId: string;
  /** Chuỗi `MARSTAFF1.{64-char-token}` đọc từ camera */
  proof: string;
}

/**
 * Cửa sổ quét QR Staff do server gửi qua SERVER_HEARTBEAT (MQTT)
 * hoặc do client poll. Khi có trường này, robot biết cần mở camera quét.
 */
export interface StaffQrScanWindow {
  jobId: string;
  authJobStepId: string;
  purpose?: 'DELIVERY_SENDER' | 'DELIVERY_RECEIVER';
  expiresAt: string;
}

export type MediaSessionMode = 'MONITOR' | 'ASSIST';

export type MediaSessionState =
  | 'RINGING'
  | 'CONNECTING'
  | 'ACTIVE'
  | 'RECONNECTING'
  | 'ENDED'
  | 'FAILED'
  | 'EXPIRED';

export interface DeviceMediaSessionView {
  sessionId: string;
  robotId?: string;
  incidentId?: string | null;
  staffAccountId?: string | null;
  mode?: MediaSessionMode | string;
  state: MediaSessionState | string;
  createdAt?: string;
  expiresAt?: string;
  deviceSeenAt?: string;
  endedAt?: string | null;
  endReason?: string | null;
}

export interface DeviceMediaSessionEvent {
  enabled: boolean;
  session?: DeviceMediaSessionView | null;
}

export type DeliveryAuthMethod =
  | 'QR_CODE'
  | 'FACE_VERIFICATION'
  | 'STAFF_CONFIRMATION';

export type DeliveryAuthPurpose = 'DELIVERY_SENDER' | 'DELIVERY_RECEIVER';

/**
 * Cửa sổ quét khuôn mặt Staff do GET /api/v1/pi/jobs/{jobId}/face-auth
 * hoặc MQTT SERVER_HEARTBEAT.staffFaceScan công bố.
 */
export interface StaffFaceScanWindow {
  jobId: string;
  authJobStepId: string;
  sessionId: string;
  expiresAt: string;
  startedAt?: string | null;
}

export type FaceVerifyReason =
  | 'MATCH'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'LOW_QUALITY'
  | 'NO_MATCH'
  | 'FACE_AI_UNAVAILABLE'
  | string;

/**
 * Request body cho POST /api/v1/pi/jobs/{jobId}/face-auth/verify
 */
export interface FaceVerifyRequest {
  sessionId: string;
  authJobStepId: string;
  transportSessionId: string;
  /** Ảnh JPEG base64 theo hợp đồng BE (bắt đầu bằng /9j/, tối đa 2MB raw / 2,800,000 ký tự) */
  image: string;
}

/**
 * Response cho POST /api/v1/pi/jobs/{jobId}/face-auth/verify
 */
export interface FaceVerifyResponse {
  verified: boolean;
  reason: FaceVerifyReason;
}
