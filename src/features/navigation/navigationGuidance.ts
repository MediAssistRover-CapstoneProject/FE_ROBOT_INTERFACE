/**
 * Navigation Guidance Calculation Engine
 *
 * Tái sử dụng thuật toán từ Backend:
 * - NavigationGuidanceService.java
 * - map-navigation.js
 *
 * Tính toán hình học:
 * 1. Chiếu vị trí robot (x, y, yaw) lên các đoạn thẳng của lộ trình Nav2.
 * 2. Đơn giản hóa đường gấp khúc (Douglas-Peucker) để tìm các điểm góc rẽ (corners).
 * 3. Tính góc rẽ giữa 2 vector (a -> b) và (b -> c):
 *    - |angle| < 15°: đi thẳng
 *    - |angle| > 150°: quay lại (UTURN)
 *    - angle > 0: rẽ trái (LEFT)
 *    - angle < 0: rẽ phải (RIGHT)
 * 4. Tính khoảng cách tới ngã rẽ kế tiếp và tổng quãng đường còn lại.
 */

export type GuidanceDirection = 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'UTURN';
export type GuidanceState =
  | 'IDLE'
  | 'TRACKING'
  | 'WAITING_FOR_POSE'
  | 'ARRIVED'
  | 'STOPPED';

export interface PathPoint {
  xM: number;
  yM: number;
}

export interface InternalPoint extends PathPoint {
  distance: number;
}

export interface ProjectionResult {
  segmentIndex: number;
  fraction: number;
  xM: number;
  yM: number;
  distance: number;
  offset: number;
}

export interface NavigationGuidanceResult {
  state: GuidanceState;
  direction?: GuidanceDirection;
  distanceCm?: number;
  remainingCm?: number;
  turn?: { xM: number; yM: number };
  projection?: { xM: number; yM: number };
  segmentIndex?: number;
  primaryText: string;
  secondaryText: string;
  etaSeconds?: number | null;
  observedAt?: string;
}

/**
 * Định dạng khoảng cách theo quy chuẩn:
 * - Dưới 1 m: hiển thị cm (vd: "43 cm", "80 cm")
 * - Từ 1 m trở lên: hiển thị mét có dấu phẩy (vd: "1,58 m", "2,4 m")
 */
export function formatDistance(cm: number, preferMetersAbove1m = true): string {
  if (cm < 100 || !preferMetersAbove1m) {
    return `${Math.round(cm)} cm`;
  }
  const meters = cm / 100;
  // Làm tròn 2 chữ số thập phân, thay dấu chấm bằng phẩy theo chuẩn tiếng Việt
  const formatted = meters
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace('.', ',');
  return `${formatted} m`;
}

/**
 * Biểu tượng chỉ dẫn rẽ
 */
export function guidanceSymbol(direction?: GuidanceDirection): string {
  switch (direction) {
    case 'LEFT':
      return '↰';
    case 'RIGHT':
      return '↱';
    case 'UTURN':
      return '↶';
    case 'STRAIGHT':
      return '↑';
    default:
      return '…';
  }
}

/**
 * Thuật toán Douglas-Peucker đơn giản hóa đường đi để tìm góc rẽ (corners)
 */
export function simplifyPath(
  points: InternalPoint[],
  start: number,
  end: number,
  tolerance: number,
  result: number[],
): void {
  if (end - start < 2) return;
  const a = points[start];
  const b = points[end];
  if (!a || !b) return;
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const len2 = dx * dx + dy * dy;

  let farthest = tolerance;
  let split = -1;

  for (let i = start + 1; i < end; i++) {
    const p = points[i];
    if (!p) continue;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.xM - a.xM) * dx + (p.yM - a.yM) * dy) / len2));
    const distance = Math.hypot(p.xM - a.xM - t * dx, p.yM - a.yM - t * dy);
    if (distance > farthest) {
      farthest = distance;
      split = i;
    }
  }

  if (split !== -1) {
    simplifyPath(points, start, split, tolerance, result);
    result.push(split);
    simplifyPath(points, split, end, tolerance, result);
  }
}

/**
 * Chiếu điểm (x, y) của robot lên tập các đoạn thẳng của lộ trình
 */
export function projectPoseOnPath(
  points: InternalPoint[],
  x: number,
  y: number,
  yaw = 0,
): ProjectionResult {
  const firstPoint = points[0];
  if (!firstPoint) {
    return {
      segmentIndex: 0,
      fraction: 0,
      xM: x,
      yM: y,
      distance: 0,
      offset: 0,
    };
  }

  let best: ProjectionResult = {
    segmentIndex: 0,
    fraction: 0,
    xM: firstPoint.xM,
    yM: firstPoint.yM,
    distance: 0,
    offset: Math.hypot(x - firstPoint.xM, y - firstPoint.yM),
  };
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dx = b.xM - a.xM;
    const dy = b.yM - a.yM;
    const len2 = dx * dx + dy * dy;

    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.xM) * dx + (y - a.yM) * dy) / len2));
    const px = a.xM + t * dx;
    const py = a.yM + t * dy;
    const offset = Math.hypot(x - px, y - py);

    // Điểm số kết hợp độ lệch khoảng cách và độ lệch hướng góc quay (yaw)
    const segmentAngle = Math.atan2(dy, dx);
    const score = offset + 0.02 * (1 - Math.cos(segmentAngle - yaw));

    if (score < bestScore) {
      bestScore = score;
      best = {
        segmentIndex: i,
        fraction: t,
        xM: px,
        yM: py,
        distance: a.distance + t * Math.sqrt(len2),
        offset,
      };
    }
  }

  return best;
}

export interface GuidanceInput {
  planPoints: PathPoint[];
  robotPose?: { xM?: number; yM?: number; yawRad?: number } | null;
  destinationName?: string;
  speedMps?: number | null;
  minTurnAngleDeg?: number;
  simplifyToleranceM?: number;
  arrivalDistanceCm?: number;
}

/**
 * Tính toán kết quả chỉ dẫn điều hướng từ lộ trình Nav2 và vị trí robot
 */
export function computeGuidance(input: GuidanceInput): NavigationGuidanceResult {
  const {
    planPoints,
    robotPose,
    destinationName = 'Điểm đến',
    speedMps,
    minTurnAngleDeg = 15,
    simplifyToleranceM = 0.15,
    arrivalDistanceCm = 15,
  } = input;

  if (!planPoints || planPoints.length < 2) {
    return {
      state: 'IDLE',
      primaryText: 'Chưa có lộ trình dẫn đường',
      secondaryText: destinationName,
    };
  }

  // Lọc các điểm hợp lệ và tính khoảng cách tích lũy dọc tuyến
  const points: InternalPoint[] = [];
  let totalLength = 0;

  for (const pt of planPoints) {
    const x = Number(pt.xM);
    const y = Number(pt.yM);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    if (points.length > 0) {
      const prev = points[points.length - 1];
      if (prev) {
        const delta = Math.hypot(x - prev.xM, y - prev.yM);
        if (delta < 0.00001) continue;
        totalLength += delta;
      }
    }
    points.push({ xM: x, yM: y, distance: totalLength });
  }

  if (points.length < 2) {
    return {
      state: 'IDLE',
      primaryText: 'Chưa đủ điểm tọa độ lộ trình',
      secondaryText: destinationName,
    };
  }

  // Kiểm tra vị trí robot
  const rx = robotPose?.xM;
  const ry = robotPose?.yM;
  const hasPose =
    typeof rx === 'number' && Number.isFinite(rx) && typeof ry === 'number' && Number.isFinite(ry);

  if (!hasPose) {
    return {
      state: 'WAITING_FOR_POSE',
      primaryText: 'Đang chờ vị trí robot',
      secondaryText: `${destinationName} · Quãng đường: ${formatDistance(totalLength * 100)}`,
    };
  }

  const yaw = Number(robotPose?.yawRad) || 0;
  const projection = projectPoseOnPath(points, rx, ry, yaw);

  // Tính quãng đường còn lại dọc theo tuyến
  const remainingDistanceM = Math.max(0, totalLength - projection.distance);
  const remainingCm = Math.round(remainingDistanceM * 100);

  // Đã đến nơi
  if (remainingCm <= arrivalDistanceCm) {
    return {
      state: 'ARRIVED',
      direction: 'STRAIGHT',
      distanceCm: remainingCm,
      remainingCm,
      projection: { xM: projection.xM, yM: projection.yM },
      primaryText: `Đã đến ${destinationName}`,
      secondaryText: 'Hoàn thành lộ trình an toàn',
      etaSeconds: 0,
    };
  }

  // Tìm các góc rẽ bằng Douglas-Peucker
  const cornerIndices: number[] = [0];
  simplifyPath(points, 0, points.length - 1, Math.max(0.005, simplifyToleranceM), cornerIndices);
  cornerIndices.push(points.length - 1);
  cornerIndices.sort((a, b) => a - b);

  const turnAngleThresholdRad = (Math.max(10, minTurnAngleDeg) * Math.PI) / 180;
  const uturnThresholdRad = (150 * Math.PI) / 180;

  for (let i = 1; i < cornerIndices.length - 1; i++) {
    const idxA = cornerIndices[i - 1];
    const idxB = cornerIndices[i];
    const idxC = cornerIndices[i + 1];
    if (idxA === undefined || idxB === undefined || idxC === undefined) continue;

    const a = points[idxA];
    const b = points[idxB];
    const c = points[idxC];
    if (!a || !b || !c) continue;

    // Góc quay giữa 2 đoạn thẳng: atan2(c - b) - atan2(b - a)
    const inAngle = Math.atan2(b.yM - a.yM, b.xM - a.xM);
    const outAngle = Math.atan2(c.yM - b.yM, c.xM - b.xM);
    let deltaAngle = outAngle - inAngle;
    // Chuẩn hóa góc về [-pi, pi]
    deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));

    if (Math.abs(deltaAngle) < turnAngleThresholdRad) continue;

    // Nếu điểm rẽ nằm phía sau vị trí robot hiện tại dọc theo tuyến, bỏ qua
    if (b.distance <= projection.distance + 0.02) continue;

    const direction: GuidanceDirection =
      Math.abs(deltaAngle) > uturnThresholdRad ? 'UTURN' : deltaAngle > 0 ? 'LEFT' : 'RIGHT';

    const instruction =
      direction === 'LEFT' ? 'rẽ trái' : direction === 'RIGHT' ? 'rẽ phải' : 'quay lại';

    const distanceToTurnM = Math.max(0, b.distance - projection.distance);
    const distanceCm = Math.round(distanceToTurnM * 100);

    // Ước lượng ETA khi robot di chuyển với tốc độ ổn định
    let etaSeconds: number | null = null;
    if (typeof speedMps === 'number' && speedMps >= 0.05) {
      etaSeconds = Math.max(1, Math.round(distanceToTurnM / speedMps));
    }

    const distTurnStr = formatDistance(distanceCm);
    const distRemStr = formatDistance(remainingCm);

    return {
      state: 'TRACKING',
      direction,
      distanceCm,
      remainingCm,
      turn: { xM: b.xM, yM: b.yM },
      projection: { xM: projection.xM, yM: projection.yM },
      segmentIndex: projection.segmentIndex,
      primaryText: `Còn ${distTurnStr}, ${instruction}`,
      secondaryText: `${destinationName} · Còn ${distRemStr}`,
      etaSeconds,
    };
  }

  // Không còn ngã rẽ nào phía trước -> Đi thẳng tới đích
  const distRemStr = formatDistance(remainingCm);
  let etaSeconds: number | null = null;
  if (typeof speedMps === 'number' && speedMps >= 0.05) {
    etaSeconds = Math.max(1, Math.round(remainingDistanceM / speedMps));
  }

  return {
    state: 'TRACKING',
    direction: 'STRAIGHT',
    distanceCm: remainingCm,
    remainingCm,
    projection: { xM: projection.xM, yM: projection.yM },
    segmentIndex: projection.segmentIndex,
    primaryText: `Đi thẳng ${distRemStr} tới điểm đến`,
    secondaryText: `${destinationName} · Còn ${distRemStr}`,
    etaSeconds,
  };
}
