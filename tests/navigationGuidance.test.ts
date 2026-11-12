import { describe, expect, it } from 'vitest';
import {
  computeGuidance,
  formatDistance,
  guidanceSymbol,
} from '../src/features/navigation/navigationGuidance';

describe('Navigation Guidance Algorithm (R2 Requirement)', () => {
  it('formatDistance formats distances according to VN standard', () => {
    expect(formatDistance(43)).toBe('43 cm');
    expect(formatDistance(80)).toBe('80 cm');
    expect(formatDistance(100)).toBe('1 m');
    expect(formatDistance(158)).toBe('1,58 m');
    expect(formatDistance(240)).toBe('2,4 m');
  });

  it('guidanceSymbol returns expected unicode direction arrows', () => {
    expect(guidanceSymbol('LEFT')).toBe('↰');
    expect(guidanceSymbol('RIGHT')).toBe('↱');
    expect(guidanceSymbol('UTURN')).toBe('↶');
    expect(guidanceSymbol('STRAIGHT')).toBe('↑');
  });

  /**
   * TEST FIXTURE CHÍNH XÁC THEO TÀI LIỆU BÀN GIAO:
   * Tuyến: (0,0) -> (1,0) -> (1,-1.15) trong hệ tọa độ map Y hướng lên.
   * Robot pose: (0.57, 0) đang hướng theo trục X dương (yaw = 0 rad).
   * Yêu cầu kết quả:
   * - Banner dòng chính: "Còn 43 cm, rẽ phải"
   * - Quãng đường còn lại: "1,58 m"
   * - Điểm rẽ tại (1, 0)
   */
  it('passes the required handover fixture: turn right at (1,0) with 43 cm to turn and 1,58 m remaining', () => {
    const planPoints = [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
      { xM: 1, yM: -1.15 },
    ];

    const robotPose = {
      xM: 0.57,
      yM: 0,
      yawRad: 0,
    };

    const guidance = computeGuidance({
      planPoints,
      robotPose,
      destinationName: 'Phòng khám 2',
      speedMps: 0.15, // 15 cm/s -> 43 cm / 15 cm/s = ~3s
    });

    expect(guidance.state).toBe('TRACKING');
    expect(guidance.direction).toBe('RIGHT');
    expect(guidance.distanceCm).toBe(43);
    expect(guidance.remainingCm).toBe(158);
    expect(guidance.turn).toEqual({ xM: 1, yM: 0 });
    expect(guidance.primaryText).toBe('Còn 43 cm, rẽ phải');
    expect(guidance.secondaryText).toBe('Phòng khám 2 · Còn 1,58 m');
    expect(guidance.etaSeconds).toBe(3);
  });

  /**
   * TEST FIXTURE RẼ TRÁI:
   * Tuyến với Y dương ở đoạn cuối: (0,0) -> (1,0) -> (1, 1.15)
   * Robot pose: (0.57, 0) hướng trục X dương.
   * Yêu cầu kết quả: "Còn 43 cm, rẽ trái"
   */
  it('correctly detects turn left when the path turns into positive Y', () => {
    const planPoints = [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
      { xM: 1, yM: 1.15 },
    ];

    const robotPose = {
      xM: 0.57,
      yM: 0,
      yawRad: 0,
    };

    const guidance = computeGuidance({
      planPoints,
      robotPose,
      destinationName: 'Phòng 01',
    });

    expect(guidance.state).toBe('TRACKING');
    expect(guidance.direction).toBe('LEFT');
    expect(guidance.distanceCm).toBe(43);
    expect(guidance.remainingCm).toBe(158);
    expect(guidance.primaryText).toBe('Còn 43 cm, rẽ trái');
  });

  /**
   * TEST ĐI THẲNG TỚI ĐÍCH:
   * Lộ trình đi thẳng không có góc rẽ
   */
  it('handles straight path to destination with no corners', () => {
    const planPoints = [
      { xM: 0, yM: 0 },
      { xM: 2, yM: 0 },
    ];

    const robotPose = {
      xM: 0.5,
      yM: 0,
      yawRad: 0,
    };

    const guidance = computeGuidance({
      planPoints,
      robotPose,
      destinationName: 'Quầy tiếp đón',
    });

    expect(guidance.state).toBe('TRACKING');
    expect(guidance.direction).toBe('STRAIGHT');
    expect(guidance.distanceCm).toBe(150);
    expect(guidance.remainingCm).toBe(150);
    expect(guidance.primaryText).toBe('Đi thẳng 1,5 m tới điểm đến');
  });

  /**
   * TEST ĐẾN NƠI (ARRIVED):
   * Khoảng cách còn lại <= 15 cm
   */
  it('transitions to ARRIVED when robot reaches destination within 15 cm', () => {
    const planPoints = [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
    ];

    const robotPose = {
      xM: 0.95,
      yM: 0,
      yawRad: 0,
    };

    const guidance = computeGuidance({
      planPoints,
      robotPose,
      destinationName: 'Phòng cấp cứu',
    });

    expect(guidance.state).toBe('ARRIVED');
    expect(guidance.primaryText).toBe('Đã đến Phòng cấp cứu');
  });

  /**
   * TEST CHỜ TỌA ĐỘ ROBOT (WAITING_FOR_POSE):
   * Không có tọa độ robot hợp lệ
   */
  it('returns WAITING_FOR_POSE when robot pose is null or missing', () => {
    const planPoints = [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
    ];

    const guidance = computeGuidance({
      planPoints,
      robotPose: null,
      destinationName: 'Phòng cấp cứu',
    });

    expect(guidance.state).toBe('WAITING_FOR_POSE');
    expect(guidance.primaryText).toBe('Đang chờ vị trí robot');
  });
});
