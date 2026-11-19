import type { ActiveVoiceInteractionSummary } from '../../services/api/robotMapService';
import { getServerNowMs } from '../../services/api/serverClock';
import type { NavigationGuidanceResult } from '../navigation/navigationGuidance';

export type RobotDisplayMode =
  | 'auth_overlay'
  | 'navigation_map'
  | 'idle_map'
  | 'robot_face';

export type RobotFaceExpression = 'idle' | 'listening' | 'speaking' | 'happy';

export interface RobotDisplayModeInput {
  hasAuthOverlay: boolean;
  hasPlannedPath: boolean;
  guidance: NavigationGuidanceResult | null;
  selectedStepType?: string | null;
  activeVoice: ActiveVoiceInteractionSummary | null;
  manualMapPreference?: boolean;
}

export const VOICE_SPEAKING_WINDOW_MS = 12_000;
const VOICE_FUTURE_SKEW_MS = 5_000;

/**
 * Xác định robot đang ở luồng chỉ đường / dẫn đường hay không.
 * Khi đang dẫn đường (có lộ trình, đang ở bước MOVE, hoặc guidance TRACKING/WAITING_FOR_POSE/ARRIVED)
 * màn hình ưu tiên hiển thị bản đồ + hướng dẫn rẽ trái/phải và ẩn khuôn mặt robot.
 */
export function isNavigationGuidanceActive(
  input: Pick<
    RobotDisplayModeInput,
    'hasPlannedPath' | 'guidance' | 'selectedStepType'
  >,
): boolean {
  if (input.hasPlannedPath || input.selectedStepType === 'MOVE') {
    return true;
  }
  return Boolean(
    input.guidance &&
      input.guidance.state !== 'IDLE' &&
      input.guidance.state !== 'STOPPED',
  );
}

/**
 * Phân giải chế độ hiển thị chính trên tablet:
 * 1. Xác thực QR/Khuôn mặt (cao nhất)
 * 2. Bản đồ dẫn đường + chỉ đường rẽ trái/phải (luôn ưu tiên hơn khuôn mặt khi vào luồng chỉ đường)
 * 3. Bản đồ xem tự do nếu người dùng chủ động bấm "Xem bản đồ" lúc nhàn rỗi
 * 4. Khuôn mặt robot giao tiếp cơ bản / chờ lệnh
 */
export function resolveRobotDisplayMode(
  input: RobotDisplayModeInput,
): RobotDisplayMode {
  if (input.hasAuthOverlay) {
    return 'auth_overlay';
  }
  if (isNavigationGuidanceActive(input)) {
    return 'navigation_map';
  }
  if (input.manualMapPreference) {
    return 'idle_map';
  }
  return 'robot_face';
}

/**
 * Biểu cảm khuôn mặt robot theo phiên giao tiếp giọng nói cơ bản.
 */
export function resolveRobotFaceExpression(
  activeVoice: ActiveVoiceInteractionSummary | null,
  nowMs: number = getServerNowMs(),
): RobotFaceExpression {
  if (!activeVoice) {
    return 'idle';
  }
  const intent = activeVoice.lastIntentCode?.toUpperCase() ?? null;
  if (intent === 'GREETING' || intent === 'FAREWELL') {
    return 'happy';
  }
  if (activeVoice.lastAnswerText && activeVoice.lastCommandAt) {
    const cmdMs = Date.parse(activeVoice.lastCommandAt);
    if (
      Number.isFinite(cmdMs) &&
      cmdMs <= nowMs + VOICE_FUTURE_SKEW_MS &&
      nowMs - cmdMs <= VOICE_SPEAKING_WINDOW_MS
    ) {
      return 'speaking';
    }
  }
  return 'listening';
}
