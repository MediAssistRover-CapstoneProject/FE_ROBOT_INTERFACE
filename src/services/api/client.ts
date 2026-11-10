import {
  API_BASE_URL,
  DEFAULT_ROBOT_CODE,
  DEFAULT_DEVICE_SECRET,
  generateUuid,
} from './config';
import { DeviceTokenResponse } from './types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  requiresAuth?: boolean;
  timeoutMs?: number;
}

class ApiClient {
  private baseUrl: string = API_BASE_URL;
  private token: string | null = null;
  private robotId: string | null = null;
  private tokenExpiresAt: number = 0;

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getRobotId(): string | null {
    return this.robotId;
  }

  public setToken(token: string, robotId?: string, expiresInMs = 3600 * 1000) {
    this.token = token;
    if (robotId) this.robotId = robotId;
    this.tokenExpiresAt = Date.now() + expiresInMs;
  }

  /**
   * Acquire or refresh deviceBearerAuth token using robotCode and deviceSecret
   */
  public async ensureDeviceToken(
    robotCode = DEFAULT_ROBOT_CODE,
    deviceSecret = DEFAULT_DEVICE_SECRET,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const now = Date.now();
    if (this.token && this.tokenExpiresAt > now + 60_000) {
      return this.token;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/pi/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Request-ID': generateUuid(),
        },
        body: JSON.stringify({ robotCode, deviceSecret }),
        signal,
      });

      if (response.ok) {
        const data: DeviceTokenResponse = await response.json();
        this.token = data.accessToken;
        this.robotId = data.robotId;
        this.tokenExpiresAt = data.expiresAt
          ? new Date(data.expiresAt).getTime()
          : now + 3600 * 1000;
        return this.token;
      }
    } catch {
      // In dev or sandbox where device is not pre-provisioned, keep fallback token
    }
    return this.token;
  }

  /**
   * Universal fetch with error handling and headers
   */
  public async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      headers = {},
      body,
      requiresAuth = path.startsWith('/api/v1/pi/'),
      timeoutMs = 10_000,
    } = options;

    const requestId = generateUuid();
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-ID': requestId,
      ...headers,
    };

    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Idempotency-Key'] = requestId;
    }

    if (requiresAuth) {
      const token = await this.ensureDeviceToken();
      if (token) {
        reqHeaders.Authorization = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fullUrl = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
      const res = await fetch(fullUrl, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(
          `API Error [${res.status}] ${path}: ${errorText || res.statusText}`,
        );
      }

      if (res.status === 204) {
        return {} as T;
      }

      return (await res.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Kết nối API thất bại (${path}): ${message}`);
    }
  }
}

export const apiClient = new ApiClient();
