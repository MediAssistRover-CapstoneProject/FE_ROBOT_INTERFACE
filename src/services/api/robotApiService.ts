import { apiClient } from './client';
import { createPiEnvelope } from './envelope';
import { generateUuid } from './config';
import {
  AckResponse,
  DeviceAuthRequest,
  DeviceTokenResponse,
  EscortCreateRequest,
  EscortResponse,
  NavigationResponse,
  PublishedWorkflowItem,
  DeviceRequestDetailResponse,
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
  DeviceMediaSessionEvent,
} from './types';

export function parseSseMediaEventsChunk(buffer: string): {
  events: DeviceMediaSessionEvent[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainder = blocks.pop() ?? '';
  const events: DeviceMediaSessionEvent[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      if (!rawLine || rawLine.startsWith(':')) continue;
      if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const jsonText = dataLines.join('\n').trim();
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText) as Partial<DeviceMediaSessionEvent>;
      if (typeof parsed === 'object' && parsed !== null) {
        events.push({
          enabled: Boolean(parsed.enabled),
          session: parsed.session ?? null,
        });
      }
    } catch {
      // Ignore malformed/non-JSON SSE frames
    }
  }

  return { events, remainder };
}

function roundCoordMeters(value: number): number {
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

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
    if (!token || !robotId) {
      const authError = apiClient.getLastAuthError();
      const baseUrl = apiClient.getBaseUrl();
      throw new Error(
        authError
          ? `Robot chưa xác thực được với máy chủ (${baseUrl}): ${authError}`
          : `Robot chưa xác thực được với máy chủ (${baseUrl}).`,
      );
    }
    const hasValidCoords =
      typeof xM === 'number' &&
      Number.isFinite(xM) &&
      typeof yM === 'number' &&
      Number.isFinite(yM);
    const validMapId = hasValidCoords && mapId ? mapId : undefined;
    const payload: SosPayload = {
      mapId: validMapId,
      endpointId: undefined,
      severity,
      description,
      xM: hasValidCoords ? roundCoordMeters(xM) : undefined,
      yM: hasValidCoords ? roundCoordMeters(yM) : undefined,
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
   * 5b. Device Media Session (Kiểm tra phiên đàm thoại LiveKit của Robot từ Pi)
   * GET /api/v1/pi/media-session
   */
  public async getDeviceMediaSession(): Promise<DeviceMediaSessionEvent | null> {
    try {
      const token = await apiClient.ensureDeviceToken();
      if (!token) return null;
      return await apiClient.request<DeviceMediaSessionEvent>('/api/v1/pi/media-session');
    } catch {
      return null;
    }
  }

  /**
   * 5c. Đăng ký nhận sự kiện phiên đàm thoại theo thời gian thực qua SSE
   * GET /api/v1/pi/media-session/events
   */
  public subscribeDeviceMediaEvents(
    onEvent: (event: DeviceMediaSessionEvent) => void,
    onError?: (err: unknown) => void,
  ): () => void {
    let closed = false;
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let activeXhr: XMLHttpRequest | null = null;

    const emitParsedChunk = (chunkText: string, prevBuffer: string): string => {
      if (!chunkText) return prevBuffer;
      const { events, remainder } = parseSseMediaEventsChunk(prevBuffer + chunkText);
      for (const evt of events) {
        if (closed) break;
        onEvent(evt);
      }
      return remainder;
    };

    const startXhrStream = (url: string, token: string): boolean => {
      if (typeof XMLHttpRequest === 'undefined') return false;
      const xhr = new XMLHttpRequest();
      activeXhr = xhr;
      let offset = 0;
      let buffer = '';

      const drainIncremental = () => {
        if (closed) return;
        const text = xhr.responseText || '';
        if (text.length <= offset) return;
        const slice = text.slice(offset);
        offset = text.length;
        buffer = emitParsedChunk(slice, buffer);
      };

      const clearHandlers = () => {
        xhr.onreadystatechange = null;
        xhr.onprogress = null;
        xhr.onerror = null;
      };

      xhr.open('GET', url, true);
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.setRequestHeader('X-Request-ID', generateUuid());

      xhr.onprogress = drainIncremental;
      xhr.onreadystatechange = () => {
        if (closed) return;
        if (xhr.readyState === 3 || xhr.readyState === 4) {
          if (xhr.readyState === 4 && xhr.status >= 400) {
            clearHandlers();
            onError?.(new Error(`SSE error HTTP ${xhr.status}`));
            return;
          }
          drainIncremental();
          if (xhr.readyState === 4) {
            if (buffer.trim()) {
              emitParsedChunk('\n\n', buffer);
              buffer = '';
            }
            clearHandlers();
          }
        }
      };
      xhr.onerror = () => {
        clearHandlers();
        if (!closed) {
          onError?.(new Error('SSE stream connection error'));
        }
      };

      try {
        xhr.send();
        return true;
      } catch (err) {
        clearHandlers();
        if (!closed) onError?.(err);
        return true;
      }
    };

    const startFetchStream = async (url: string, token: string) => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache',
            'X-Request-ID': generateUuid(),
          },
          signal: abortController?.signal,
        });

        if (closed) return;
        if (!res.ok) {
          throw new Error(`SSE HTTP ${res.status}`);
        }

        const reader = res.body?.getReader?.();
        if (!reader) {
          const fullText = await res.text();
          if (!closed && fullText) {
            emitParsedChunk('\n\n', emitParsedChunk(fullText, ''));
          }
          return;
        }

        const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
        let buffer = '';
        while (!closed) {
          const { done, value } = await reader.read();
          if (closed) {
            void reader.cancel().catch(() => undefined);
            break;
          }
          if (done) break;
          const chunk = value
            ? decoder
              ? decoder.decode(value, { stream: true })
              : String.fromCharCode(...value)
            : '';
          buffer = emitParsedChunk(chunk, buffer);
        }
        if (!closed && decoder) {
          buffer = emitParsedChunk(decoder.decode(), buffer);
        }
        if (!closed && buffer.trim()) {
          emitParsedChunk('\n\n', buffer);
        }
      } catch (err: unknown) {
        if (closed) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        onError?.(err);
      }
    };

    void (async () => {
      try {
        const token = await apiClient.ensureDeviceToken();
        if (closed) return;
        if (!token) {
          onError?.(new Error('Device token unavailable'));
          return;
        }
        const url = `${apiClient.getBaseUrl()}/api/v1/pi/media-session/events`;
        const isReactNative =
          typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

        if (isReactNative && startXhrStream(url, token)) {
          return;
        }
        if (typeof fetch === 'function') {
          await startFetchStream(url, token);
          return;
        }
        startXhrStream(url, token);
      } catch (err) {
        if (!closed) onError?.(err);
      }
    })();

    return () => {
      closed = true;
      abortController?.abort();
      if (activeXhr) {
        activeXhr.onreadystatechange = null;
        activeXhr.onprogress = null;
        activeXhr.onerror = null;
        try {
          activeXhr.abort();
        } catch {
          // Ignore XHR abort errors during teardown
        }
        activeXhr = null;
      }
    };
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
  public async getPublishedWorkflows(): Promise<PublishedWorkflowItem[]> {
    await apiClient.ensureDeviceToken();
    const list = await apiClient.request<PublishedWorkflowItem[]>('/api/v1/pi/workflows');
    return Array.isArray(list) ? list : [];
  }

  /**
   * Tìm workflow NAVIGATION đã publish sẵn trên BE (không tạo workflow mới)
   */
  public async resolveNavigationWorkflowId(
    serviceType = 'NAVIGATION',
  ): Promise<string | undefined> {
    try {
      const list = await this.getPublishedWorkflows();
      const candidates = list
        .map((item) => item?.workflow)
        .filter(
          (wf): wf is PublishedWorkflowItem['workflow'] =>
            Boolean(
              wf?.workflowId &&
                (wf.serviceType || '').toUpperCase() === serviceType.toUpperCase() &&
                wf.status === 'PUBLISHED' &&
                wf.acceptsNewJobs !== false,
            ),
        )
        .sort((a, b) => {
          const schemaDiff = (b.schemaVersion ?? 0) - (a.schemaVersion ?? 0);
          if (schemaDiff !== 0) return schemaDiff;
          return (b.versionNo ?? 0) - (a.versionNo ?? 0);
        });
      return candidates[0]?.workflowId;
    } catch {
      return undefined;
    }
  }

  public async requestNavigation(
    params: NavigationCreateRequest,
    idempotencyKey?: string,
  ): Promise<NavigationResponse> {
    await apiClient.ensureDeviceToken();
    const key = idempotencyKey || generateUuid();
    return apiClient.request<NavigationResponse>('/api/v1/pi/requests/navigation', {
      method: 'POST',
      headers: {
        'Idempotency-Key': key,
      },
      body: {
        targetMode: 'ENDPOINT',
        navigationMode: 'STANDARD',
        passengerCount: 1,
        priority: 80,
        ...params,
      },
    });
  }

  public async requestEscort(
    params: EscortCreateRequest,
    idempotencyKey?: string,
  ): Promise<EscortResponse> {
    const key = idempotencyKey || generateUuid();
    return apiClient.request<EscortResponse>('/api/v1/pi/requests/escort', {
      method: 'POST',
      headers: {
        'Idempotency-Key': key,
      },
      body: params,
    });
  }

  public async getRequestDetail(requestId: string): Promise<DeviceRequestDetailResponse> {
    return apiClient.request<DeviceRequestDetailResponse>(`/api/v1/pi/requests/${requestId}`);
  }

  public async cancelRequest(
    requestId: string,
    reason = 'Bệnh nhân dừng yêu cầu',
    idempotencyKey?: string,
  ): Promise<DeviceRequestDetailResponse> {
    const key = idempotencyKey || generateUuid();
    return apiClient.request<DeviceRequestDetailResponse>(
      `/api/v1/pi/requests/${requestId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': key,
        },
        body: { reason },
      },
    );
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
        purpose?: 'DELIVERY_SENDER' | 'DELIVERY_RECEIVER';
        expiresAt?: string;
      }>(`/api/v1/pi/jobs/${jobId}/qr-challenge`);
      if (!challenge || !challenge.authJobStepId) return null;
      return {
        jobId,
        authJobStepId: challenge.authJobStepId,
        purpose: challenge.purpose,
        expiresAt: challenge.expiresAt ?? new Date(Date.now() + 600_000).toISOString(),
      };
    } catch {
      return null;
    }
  }
}

export const robotApiService = new RobotApiService();
