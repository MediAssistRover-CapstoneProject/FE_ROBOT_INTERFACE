import { describe, expect, it } from 'vitest';
import {
  VOICE_SPEAKING_WINDOW_MS,
  isNavigationGuidanceActive,
  resolveRobotDisplayMode,
  resolveRobotFaceExpression,
} from '../src/features/patient/robotDisplayMode';
import type { NavigationGuidanceResult } from '../src/features/navigation/navigationGuidance';
import type { ActiveVoiceInteractionSummary } from '../src/services/api/robotMapService';

const SAMPLE_VOICE: ActiveVoiceInteractionSummary = {
  voiceInteractionId: '11111111-1111-4111-8111-111111111111',
  robotId: '22222222-2222-4222-8222-222222222222',
  status: 'ACTIVE',
  startedAt: '2026-11-19T09:59:50.000Z',
  detectedIntent: null,
  latestCommandId: '33333333-3333-4333-8333-333333333333',
  lastUserText: 'Phòng xét nghiệm ở đâu?',
  lastAnswerText: 'Tôi có thể dẫn bạn đến phòng xét nghiệm.',
  lastIntentCode: 'ASK_LOCATION',
  lastCommandAt: '2026-11-19T10:00:00.000Z',
};

describe('robotDisplayMode', () => {
  it('shows robot_face when idle or during basic voice conversation without navigation', () => {
    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: null,
        selectedStepType: null,
        activeVoice: null,
        manualMapPreference: false,
      }),
    ).toBe('robot_face');

    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: { state: 'IDLE', primaryText: 'Chưa có lộ trình', secondaryText: '' },
        selectedStepType: null,
        activeVoice: SAMPLE_VOICE,
        manualMapPreference: false,
      }),
    ).toBe('robot_face');

    // Manual map toggle works only while idle/chatting
    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: null,
        selectedStepType: null,
        activeVoice: SAMPLE_VOICE,
        manualMapPreference: true,
      }),
    ).toBe('idle_map');
  });

  it('strictly prioritizes navigation_map over robot_face when guidance / turn-by-turn left-right cues or MOVE step start', () => {
    const leftTurnGuidance: NavigationGuidanceResult = {
      state: 'TRACKING',
      direction: 'LEFT',
      distanceCm: 65,
      remainingCm: 180,
      primaryText: 'Còn 65 cm, rẽ trái',
      secondaryText: 'Phòng xét nghiệm · Còn 180 cm',
      speechText: 'Chuẩn bị rẽ trái.',
      promptKey: 'NAVIGATION_LEFT',
    };
    const rightTurnGuidance: NavigationGuidanceResult = {
      state: 'TRACKING',
      direction: 'RIGHT',
      distanceCm: 50,
      remainingCm: 120,
      primaryText: 'Còn 50 cm, rẽ phải',
      secondaryText: 'Nhà thuốc · Còn 120 cm',
      speechText: 'Chuẩn bị rẽ phải.',
      promptKey: 'NAVIGATION_RIGHT',
    };

    // Even if activeVoice is still truthy, LEFT/RIGHT spoken guidance forces map immediately
    expect(isNavigationGuidanceActive({ hasPlannedPath: true, guidance: leftTurnGuidance })).toBe(true);
    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: true,
        guidance: leftTurnGuidance,
        selectedStepType: 'MOVE',
        activeVoice: SAMPLE_VOICE,
        manualMapPreference: false,
      }),
    ).toBe('navigation_map');

    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: rightTurnGuidance,
        selectedStepType: null,
        activeVoice: SAMPLE_VOICE,
      }),
    ).toBe('navigation_map');

    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: { state: 'WAITING_FOR_POSE', primaryText: 'Đang chờ vị trí', secondaryText: '' },
        selectedStepType: 'MOVE',
        activeVoice: null,
      }),
    ).toBe('navigation_map');

    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: { state: 'ARRIVED', primaryText: 'Đã đến', secondaryText: '' },
        selectedStepType: null,
        activeVoice: null,
      }),
    ).toBe('navigation_map');

    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: false,
        hasPlannedPath: false,
        guidance: null,
        selectedStepType: 'MOVE',
        activeVoice: SAMPLE_VOICE,
      }),
    ).toBe('navigation_map');
  });

  it('gives auth_overlay highest precedence over both navigation_map and robot_face', () => {
    expect(
      resolveRobotDisplayMode({
        hasAuthOverlay: true,
        hasPlannedPath: true,
        guidance: {
          state: 'TRACKING',
          direction: 'LEFT',
          primaryText: 'Rẽ trái',
          secondaryText: '',
        },
        selectedStepType: 'AUTHENTICATE',
        activeVoice: SAMPLE_VOICE,
      }),
    ).toBe('auth_overlay');
  });
});

describe('resolveRobotFaceExpression', () => {
  const baseTime = Date.parse('2026-11-19T10:00:05.000Z');

  it('resolves idle, speaking, listening, and happy expressions accurately', () => {
    expect(resolveRobotFaceExpression(null, baseTime)).toBe('idle');

    // Within speaking window of lastAnswerText -> speaking
    expect(resolveRobotFaceExpression(SAMPLE_VOICE, baseTime)).toBe('speaking');

    // Past speaking window -> listening
    expect(
      resolveRobotFaceExpression(SAMPLE_VOICE, baseTime + VOICE_SPEAKING_WINDOW_MS + 1_000),
    ).toBe('listening');

    // Active voice without answer yet -> listening
    expect(
      resolveRobotFaceExpression(
        {
          ...SAMPLE_VOICE,
          latestCommandId: null,
          lastUserText: null,
          lastAnswerText: null,
          lastIntentCode: null,
          lastCommandAt: null,
        },
        baseTime,
      ),
    ).toBe('listening');

    // GREETING or FAREWELL -> happy
    expect(
      resolveRobotFaceExpression({ ...SAMPLE_VOICE, lastIntentCode: 'GREETING' }, baseTime),
    ).toBe('happy');
    expect(
      resolveRobotFaceExpression({ ...SAMPLE_VOICE, lastIntentCode: 'FAREWELL' }, baseTime),
    ).toBe('happy');
  });
});
