import { apiClient } from './client';
import { createPiEnvelope } from './envelope';
import { generateUuid } from './config';
import {
  AckResponse,
  DeviceAuthRequest,
  DeviceTokenResponse,
  EscortCreateRequest,
  HeartbeatPayload,
  JobErrorPayload,
  JobResultPayload,
  LocationPayload,
  NavigationCreateRequest,
  PageResponse,
  RobotStatusCode,
  RoomResponse,
  SosPayload,
  SosResponse,
  DeviceIncidentStatusResponse,
  StepErrorPayload,
  StepResultPayload,
  ZoneResponse,
  FloorResponse,
  EndpointResponse,
  HospitalInformationResponse,
  CameraVerifyRequest,
  StaffQrScanWindow,
} from './types';

class RobotApiService {
  /**
   * 1. Ping test to check server reachability
   */
  public async pingServer(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await apiClient.request('/api/v1/public/zones?page=0&size=1', {
        timeoutMs: 5000,
        requiresAuth: false,
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 2. Device Authentication (deviceBearerAuth token)
   */
  public async loginDevice(
    robotCode: string,
    deviceSecret: string,
  ): Promise<DeviceTokenResponse> {
    const body: DeviceAuthRequest = { robotCode, deviceSecret };
    const res = await apiClient.request<DeviceTokenResponse>('/api/v1/pi/auth/token', {
      method: 'POST',
      body,
      requiresAuth: false,
    });
    if (res.accessToken) {
      apiClient.setToken(res.accessToken, res.robotId);
    }
    return res;
  }

  /**
   * 3. Heartbeat (Báo cáo nhịp tim, pin, trạng thái)
   */
  public async sendHeartbeat(
    status: RobotStatusCode = 'IDLE',
    batteryRaw = 79,
    mapId?: string,
  ): Promise<AckResponse> {
    await apiClient.ensureDeviceToken();
    const payload: HeartbeatPayload = {
      status,
      batteryRaw,
      batteryUnit: 'UNKNOWN',
      batteryCapturedAt: new Date().toISOString(),
      currentMapId: mapId,
      protocolMajor: 1,
      runtimeVersion: '1.0.0-expo57',
    };
    const envelope = createPiEnvelope('HEARTBEAT', payload, {
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>('/api/v1/pi/heartbeat', {
      method: 'POST',
      body: envelope,
    });
  }

  /**
   * 4. Telemetry Location (Báo cáo vị trí realtime x, y, yaw)
   */
  public async sendLocation(
    xM: number,
    yM: number,
    yawRad = 0,
    mapId?: string,
  ): Promise<AckResponse> {
    await apiClient.ensureDeviceToken();
    const payload: LocationPayload = {
      mapId,
      xM,
      yM,
      yawRad,
      localizationConfidence: 0.98,
      fresh: true,
      capturedAt: new Date().toISOString(),
    };
    const envelope = createPiEnvelope('LOCATION', payload, {
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>('/api/v1/pi/telemetry/location', {
      method: 'POST',
      body: envelope,
    });
  }

  /**
   * 5. Emergency SOS (Kích hoạt cấp cứu khẩn cấp từ màn hình robot)
   */
  public async triggerSos(
    description = 'Bệnh nhân yêu cầu trợ giúp y tế khẩn cấp tại trạm Robot',
    severity: 'WARNING' | 'CRITICAL' = 'CRITICAL',
    xM?: number,
    yM?: number,
    mapId?: string,
    operationKey?: string,
  ): Promise<SosResponse> {
    const token = await apiClient.ensureDeviceToken();
    const robotId = apiClient.getRobotId();
    if (!token || !robotId) throw new Error('Robot chưa xác thực được với máy chủ.');
    const hasValidCoords =
      typeof xM === 'number' && !isNaN(xM) && typeof yM === 'number' && !isNaN(yM);
    const validMapId = hasValidCoords && mapId ? mapId : undefined;
    const payload: SosPayload = {
      mapId: validMapId,
      endpointId: undefined,
      severity,
      description,
      xM: hasValidCoords ? xM : undefined,
      yM: hasValidCoords ? yM : undefined,
    };
    const opKey = operationKey || generateUuid();
    const envelope = createPiEnvelope('EMERGENCY_SOS', payload, {
      robotId,
      operationKey: opKey,
    });
    return apiClient.request<SosResponse>('/api/v1/pi/incidents/sos', {
      method: 'POST',
      headers: {
        'Idempotency-Key': opKey,
      },
      body: envelope,
    });
  }

  public async getIncidentStatus(incidentId: string): Promise<DeviceIncidentStatusResponse> {
    return apiClient.request<DeviceIncidentStatusResponse>(`/api/v1/pi/incidents/${incidentId}`);
  }

  /**
   * 6. Job Lifecycle (Bắt đầu, Hoàn tất, Báo lỗi Job vận chuyển)
   */
  public async reportJobStarted(jobId: string): Promise<AckResponse> {
    const envelope = createPiEnvelope('JOB_STARTED', {}, {
      jobId,
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>(`/api/v1/pi/jobs/${jobId}/started`, {
      method: 'POST',
      body: envelope,
    });
  }

  public async reportJobResult(
    jobId: string,
    resultData: Record<string, unknown> = {},
  ): Promise<AckResponse> {
    const payload: JobResultPayload = { result: resultData };
    const envelope = createPiEnvelope('JOB_RESULT', payload, {
      jobId,
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>(`/api/v1/pi/jobs/${jobId}/result`, {
      method: 'POST',
      body: envelope,
    });
  }

  public async reportJobError(
    jobId: string,
    errorCode: string,
    failureReason: string,
    details?: Record<string, unknown>,
  ): Promise<AckResponse> {
    const payload: JobErrorPayload = {
      errorCode,
      failureReason,
      details,
    };
    const envelope = createPiEnvelope('JOB_ERROR', payload, {
      jobId,
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>(`/api/v1/pi/jobs/${jobId}/errors`, {
      method: 'POST',
      body: envelope,
    });
  }

  /**
   * 7. Step Lifecycle & Unhappy Cases (Bị chặn đường / Vật cản)
   */
  public async reportStepStarted(jobStepId: string, jobId?: string): Promise<AckResponse> {
    const envelope = createPiEnvelope('STEP_STARTED', {}, {
      jobId,
      jobStepId,
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>(`/api/v1/pi/job-steps/${jobStepId}/started`, {
      method: 'POST',
      body: envelope,
    });
  }

  public async reportStepResult(
    jobStepId: string,
    resultData: Record<string, unknown> = {},
    jobId?: string,
  ): Promise<AckResponse> {
    const payload: StepResultPayload = { result: resultData };
    const envelope = createPiEnvelope('STEP_RESULT', payload, {
      jobId,
      jobStepId,
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>(`/api/v1/pi/job-steps/${jobStepId}/result`, {
      method: 'POST',
      body: envelope,
    });
  }

  public async reportStepError(
    jobStepId: string,
    errorCode: string,
    details?: Record<string, unknown>,
    retryable = true,
    jobId?: string,
  ): Promise<AckResponse> {
    const payload: StepErrorPayload = {
      errorCode,
      details,
      retryable,
    };
    const envelope = createPiEnvelope('STEP_ERROR', payload, {
      jobId,
      jobStepId,
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>(`/api/v1/pi/job-steps/${jobStepId}/errors`, {
      method: 'POST',
      body: envelope,
    });
  }

  /**
   * 8. Patient Screen Requests (Chỉ đường & Hộ tống)
   */
  public async requestNavigation(params: NavigationCreateRequest): Promise<unknown> {
    return apiClient.request('/api/v1/pi/requests/navigation', {
      method: 'POST',
      body: params,
    });
  }

  public async requestEscort(params: EscortCreateRequest): Promise<unknown> {
    return apiClient.request('/api/v1/pi/requests/escort', {
      method: 'POST',
      body: params,
    });
  }

  public async cancelRequest(requestId: string, reason = 'Bệnh nhân hủy yêu cầu'): Promise<unknown> {
    return apiClient.request(`/api/v1/pi/requests/${requestId}/cancel`, {
      method: 'POST',
      body: { reason },
    });
  }

  /**
   * 9. Voice Interaction (Trợ lý giọng nói)
   */
  public async sendVoiceCommand(commandText: string): Promise<AckResponse> {
    const envelope = createPiEnvelope('VOICE_COMMAND', { command: commandText }, {
      robotId: apiClient.getRobotId() || undefined,
    });
    return apiClient.request<AckResponse>('/api/v1/pi/voice/commands', {
      method: 'POST',
      body: envelope,
    });
  }

  /**
   * 10. Public Catalog (Không cần token, Bệnh nhân & Màn hình Robot tra cứu)
   */
  public async getPublicRooms(page = 0, size = 50): Promise<PageResponse<RoomResponse>> {
    return apiClient.request<PageResponse<RoomResponse>>(
      `/api/v1/public/rooms?page=${page}&size=${size}`,
      { requiresAuth: false },
    );
  }

  public async getPublicZones(page = 0, size = 50): Promise<PageResponse<ZoneResponse>> {
    return apiClient.request<PageResponse<ZoneResponse>>(
      `/api/v1/public/zones?page=${page}&size=${size}`,
      { requiresAuth: false },
    );
  }

  public async getPublicFloors(page = 0, size = 50): Promise<PageResponse<FloorResponse>> {
    return apiClient.request<PageResponse<FloorResponse>>(
      `/api/v1/public/floors?page=${page}&size=${size}`,
      { requiresAuth: false },
    );
  }

  public async getPublicEndpoints(page = 0, size = 50): Promise<PageResponse<EndpointResponse>> {
    return apiClient.request<PageResponse<EndpointResponse>>(
      `/api/v1/public/endpoints?page=${page}&size=${size}`,
      { requiresAuth: false },
    );
  }

  public async getPublicHospitalInfo(page = 0, size = 10): Promise<PageResponse<HospitalInformationResponse>> {
    return apiClient.request<PageResponse<HospitalInformationResponse>>(
      `/api/v1/public/hospital-information?page=${page}&size=${size}`,
      { requiresAuth: false },
    );
  }
  /**
   * 12. Staff Phone QR — Robot quét mã QR trên điện thoại nhân viên
   *
   * Staff mở app → gọi POST /api/v1/jobs/{jobId}/staff-phone-qr → hiện QR
   * Robot mở camera quét → lấy proof → gọi endpoint dưới đây
   * Server xác thực chữ ký → mở chốt tủ.
   */
  public async verifyStaffPhoneQr(
    jobId: string,
    body: CameraVerifyRequest,
  ): Promise<void> {
    await apiClient.request<void>(`/api/v1/pi/jobs/${jobId}/staff-phone-qr/verify`, {
      method: 'POST',
      body,
    });
  }

  /**
   * 13. Kiểm tra cửa sổ quét QR Staff — poll thay cho MQTT SERVER_HEARTBEAT
   * Trả về null khi không có bước AUTHENTICATE đang active.
   */
  public async getStaffQrScanWindow(jobId: string): Promise<StaffQrScanWindow | null> {
    try {
      const challenge = await apiClient.request<{
        challengeId?: string;
        authJobStepId?: string;
        expiresAt?: string;
      }>(`/api/v1/pi/jobs/${jobId}/qr-challenge`);
      if (!challenge || !challenge.authJobStepId) return null;
      return {
        jobId,
        authJobStepId: challenge.authJobStepId,
        expiresAt: challenge.expiresAt ?? new Date(Date.now() + 600_000).toISOString(),
      };
    } catch {
      return null;
    }
  }
}

export const robotApiService = new RobotApiService();
