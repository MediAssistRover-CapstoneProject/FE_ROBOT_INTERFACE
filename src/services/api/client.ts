import {
  API_BASE_URL,
  DEFAULT_ROBOT_CODE,
  DEFAULT_ROBOT_ID,
  DEFAULT_DEVICE_SECRET,
  DEFAULT_DEVICE_TOKEN,
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

interface DeviceJwtClaims {
  robotId?: string;
  robotCode?: string;
  exp?: number;
}

function decodeBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded);
  }
  const B = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (B) {
    return B.from(padded, 'base64').toString('utf8');
  }
  throw new Error('Base64 decoder unavailable');
}

export function parseDeviceJwtClaims(token: string): DeviceJwtClaims | null {
  try {
    const parts = token.split('.');
    const payload = parts[1];
    if (!payload) return null;
    const json = decodeBase64Url(payload);
    return JSON.parse(json) as DeviceJwtClaims;
  } catch {
    return null;
  }
}

class ApiClient {
  private baseUrl: string = API_BASE_URL;
  private token: string | null = null;
  private robotId: string | null = null;
  private tokenExpiresAt: number = 0;
  private lastAuthError: string | null = null;

  constructor() {
    if (DEFAULT_DEVICE_TOKEN) {
      this.applyPreissuedToken(DEFAULT_DEVICE_TOKEN);
    }
  }

  public applyPreissuedToken(jwtToken: string): boolean {
    const trimmed = jwtToken.trim();
    if (!trimmed) return false;
    const claims = parseDeviceJwtClaims(trimmed);
    const now = Date.now();
    const expMs = typeof claims?.exp === 'number' ? claims.exp * 1000 : now + 3600 * 1000;
    if (expMs <= now + 5_000) {
      this.lastAuthError = `Device JWT đã hết hạn (${new Date(expMs).toISOString()})`;
      console.warn('[API AUTH] Token cấu hình đã hết hạn:', new Date(expMs).toISOString());
      return false;
    }
    this.token = trimmed;
    this.robotId = claims?.robotId || DEFAULT_ROBOT_ID || null;
    this.tokenExpiresAt = expMs;
    this.lastAuthError = null;
    console.log('[API AUTH] Đã nạp Device JWT', {
      robotId: this.robotId,
      robotCode: claims?.robotCode || DEFAULT_ROBOT_CODE,
      expiresAt: new Date(expMs).toISOString(),
    });
    return true;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getRobotId(): string | null {
    return this.robotId || DEFAULT_ROBOT_ID || (process.env.EXPO_PUBLIC_ROBOT_ID as string) || null;
  }

  public getLastAuthError(): string | null {
    return this.lastAuthError;
  }

  public setToken(token: string, robotId?: string, expiresInMs = 3600 * 1000) {
    this.token = token;
    if (robotId) this.robotId = robotId;
    this.tokenExpiresAt = Date.now() + expiresInMs;
    this.lastAuthError = null;
  }

  public clearToken() {
    this.token = null;
    this.tokenExpiresAt = 0;
    this.lastAuthError = null;
  }

  /**
   * Acquire or refresh deviceBearerAuth token using robotCode and deviceSecret
   */
  public async ensureDeviceToken(
    robotCode = DEFAULT_ROBOT_CODE,
    deviceSecret = DEFAULT_DEVICE_SECRET,
    signal?: AbortSignal,
    timeoutMs = 10_000,
  ): Promise<string | null> {
    const now = Date.now();
    if (this.token && this.tokenExpiresAt > now + 60_000) {
      this.lastAuthError = null;
      return this.token;
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authUrl = `${this.baseUrl}/api/v1/pi/auth/token`;
      console.log(`[API AUTH] POST ${authUrl} (robotCode=${robotCode})`);
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Request-ID': generateUuid(),
        },
        body: JSON.stringify({ robotCode, deviceSecret }),
        signal: controller.signal,
      });

      if (response.ok) {
        const data: DeviceTokenResponse = await response.json();
        this.token = data.accessToken;
        this.robotId = data.robotId;
        this.tokenExpiresAt = data.expiresAt
          ? new Date(data.expiresAt).getTime()
          : now + 3600 * 1000;
        this.lastAuthError = null;
        console.log(`[API AUTH] OK robotId=${data.robotId}`);
        return this.token;
      }

      const errorText = await response.text().catch(() => '');
      this.lastAuthError = `HTTP ${response.status}${errorText ? `: ${errorText}` : response.statusText ? `: ${response.statusText}` : ''}`;
      console.warn(`[API AUTH] Lỗi (${this.baseUrl}):`, this.lastAuthError);
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      this.lastAuthError = isAbort
        ? `Quá thời gian chờ (${Math.round(timeoutMs / 1000)}s)`
        : err instanceof Error
          ? err.message
          : String(err);
      console.warn(`[API AUTH] Lỗi kết nối (${this.baseUrl}):`, this.lastAuthError);
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
    if (this.tokenExpiresAt > 0 && this.tokenExpiresAt <= Date.now()) {
      this.token = null;
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

    const requestId = (headers['X-Request-ID'] as string) || generateUuid();
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-ID': requestId,
      ...headers,
    };

    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      if (!reqHeaders['Idempotency-Key']) {
        reqHeaders['Idempotency-Key'] = requestId;
      }
    }

    if (requiresAuth) {
      const token = await this.ensureDeviceToken();
      if (token) {
        reqHeaders.Authorization = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fullUrl = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    try {
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
      console.warn(`[API ERR] ${method} ${fullUrl}:`, message);
      throw new Error(`Kết nối API thất bại (${path}): ${message}`);
    }
  }
}

export const apiClient = new ApiClient();
