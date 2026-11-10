import Constants from 'expo-constants';
import { Platform } from 'react-native';

const getBackendBaseUrl = (): string => {
  if (Platform.OS === 'web') {
    return (process.env.EXPO_PUBLIC_ROBOT_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
  }

  // Trên thiết bị thật (iPhone/Android qua Expo Go):
  // Nếu url cấu hình là localhost, tự động thay bằng IP Wi-Fi máy tính từ hostUri để điện thoại gọi được máy tính
  const hostUri = Constants.expoConfig?.hostUri;
  const lanIp = hostUri ? hostUri.split(':')[0] : '192.168.88.54';

  const raw = process.env.EXPO_PUBLIC_ROBOT_API_URL?.trim() || 'http://localhost:8080';
  if (raw.includes('localhost') || raw.includes('127.0.0.1')) {
    return raw.replace('localhost', lanIp).replace('127.0.0.1', lanIp).replace(/\/+$/, '');
  }

  return raw.replace(/\/+$/, '');
};

export const API_BASE_URL = getBackendBaseUrl();

export const DEFAULT_ROBOT_CODE =
  process.env.EXPO_PUBLIC_ROBOT_CODE || 'ROBOT_MAR_01';

export const DEFAULT_DEVICE_SECRET =
  process.env.EXPO_PUBLIC_ROBOT_SECRET || '6rGL6RPV9VgbVZfmcHXmA2uz-oST8speM1bO1eI1ozg';

let sequenceCounter = 1;

export function getNextSequence(): number {
  return sequenceCounter++;
}

/**
 * Universal UUID v4 generator for Expo Go across iOS, Android, and Web
 */
export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fallback if randomUUID fails in some sandboxes
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
