import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Path,
  Pattern,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import { robotApiService } from '../services/api';

/**
 * Bản đồ SLAM kiểu OTTO Fleet Manager — đồng bộ giao diện với
 * `BackendHospitalMap` bên Staff App (status bar, CAD grid, Traffic Zones,
 * quỹ đạo Nav2, footprint AMR, HUD toạ độ và legend).
 *
 * Dữ liệu lấy từ Backend (`/api/v1/public/zones`, `/api/v1/public/endpoints`);
 * khi Backend chưa có dữ liệu toạ độ sẽ dùng hình học bệnh viện dự phòng.
 */

type MapPoint = { x: number; y: number };
type MapZone = { code: string; name: string; zoneType: 'KEEP_OUT' | 'SPEED' | 'ROOM'; points: MapPoint[] };
type MapEndpoint = { code: string; name: string; x: number; y: number };
type FilterMode = 'otto_cad' | 'otto_dark' | 'raw';

export interface RobotPose {
  xM: number;
  yM: number;
  yawRad: number;
}

interface Props {
  /** Mã phòng/điểm đến đang chọn, ví dụ `P_CAP_CUU`. */
  targetRoom?: string;
  targetSubText?: string;
  mapName?: string;
  robotCode?: string;
  robotBusy?: boolean;
  robotPose?: RobotPose;
  onSelectTarget?: (code: string) => void;
}

const rect = (x: number, y: number, w: number, h: number): MapPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

// Hình học dự phòng (mét) — khớp mã phòng của DEFAULT_HOSPITAL_ROOMS.
const FALLBACK_ZONES: MapZone[] = [
  { code: 'P_CAP_CUU', name: 'Cấp cứu', zoneType: 'ROOM', points: rect(1, 9, 6, 5) },
  { code: 'P_KHAM_NOI_01', name: 'Khám Nội', zoneType: 'ROOM', points: rect(8, 9, 6, 5) },
  { code: 'P_KHAM_NGOAI_02', name: 'Khám Ngoại', zoneType: 'ROOM', points: rect(15, 9, 6, 5) },
  { code: 'P_XET_NGHIEM', name: 'Xét nghiệm', zoneType: 'ROOM', points: rect(22, 9, 7, 5) },
  { code: 'P_NHA_THUOC', name: 'Nhà thuốc', zoneType: 'ROOM', points: rect(1, 1, 7, 4.5) },
  { code: 'P_TIEP_DON', name: 'Tiếp đón', zoneType: 'ROOM', points: rect(20, 1, 9, 4.5) },
  { code: 'SPEED_SANH', name: 'Speed', zoneType: 'SPEED', points: rect(9.5, 1.2, 9, 3.6) },
  { code: 'KEEP_OUT_KHO', name: 'Keep out', zoneType: 'KEEP_OUT', points: rect(25.5, 6.2, 3.3, 2) },
];

const FALLBACK_ENDPOINTS: MapEndpoint[] = [
  { code: 'P_CAP_CUU', name: 'Cấp cứu', x: 4, y: 8.6 },
  { code: 'P_KHAM_NOI_01', name: 'Khám Nội', x: 11, y: 8.6 },
  { code: 'P_KHAM_NGOAI_02', name: 'Khám Ngoại', x: 18, y: 8.6 },
  { code: 'P_XET_NGHIEM', name: 'Xét nghiệm', x: 25.5, y: 8.6 },
  { code: 'P_NHA_THUOC', name: 'Nhà thuốc', x: 4.5, y: 5.9 },
  { code: 'P_TIEP_DON', name: 'Tiếp đón', x: 24.5, y: 5.9 },
];

const DEFAULT_POSE: RobotPose = { xM: 14.2, yM: 5.8, yawRad: Math.PI / 2 };

const readPolygon = (polygonJson: unknown): MapPoint[] => {
  if (!polygonJson) return [];
  let value: any = polygonJson;
  try {
    if (typeof value === 'string') value = JSON.parse(value);
  } catch {
    return [];
  }
  const raw: any[] =
    value?.type === 'Polygon' && Array.isArray(value.coordinates)
      ? value.coordinates[0]
      : Array.isArray(value?.points)
        ? value.points
        : Array.isArray(value)
          ? value
          : [];
  return raw
    .map((p: any) =>
      Array.isArray(p)
        ? { x: Number(p[0]), y: Number(p[1]) }
        : { x: Number(p?.xM ?? p?.x_m ?? p?.x), y: Number(p?.yM ?? p?.y_m ?? p?.y) },
    )
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
};

function useBackendGeometry() {
  const [zones, setZones] = useState<MapZone[]>(FALLBACK_ZONES);
  const [endpoints, setEndpoints] = useState<MapEndpoint[]>(FALLBACK_ENDPOINTS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [zoneRes, epRes] = await Promise.allSettled([
          robotApiService.getPublicZones(0, 100),
          robotApiService.getPublicEndpoints(0, 100),
        ]);
        if (!alive) return;
        let gotLive = false;
        if (zoneRes.status === 'fulfilled') {
          const parsed = (zoneRes.value?.content ?? [])
            .map((z: any): MapZone => {
              const type = String(z.zoneType ?? '').toUpperCase();
              return {
                code: z.zoneCode ?? z.code ?? '',
                name: z.zoneName ?? z.name ?? '',
                zoneType: type === 'KEEP_OUT' ? 'KEEP_OUT' : type === 'SPEED' ? 'SPEED' : 'ROOM',
                points: readPolygon(z.polygonJson ?? z.polygon),
              };
            })
            .filter((z) => z.points.length >= 3);
          if (parsed.length) {
            setZones(parsed);
            gotLive = true;
          }
        }
        if (epRes.status === 'fulfilled') {
          const parsed = (epRes.value?.content ?? [])
            .filter((e) => Number.isFinite(Number(e.xM)) && Number.isFinite(Number(e.yM)))
            .map((e) => ({ code: e.code, name: e.name, x: Number(e.xM), y: Number(e.yM) }));
          if (parsed.length) {
            setEndpoints(parsed);
            gotLive = true;
          }
        }
        setLive(gotLive || zoneRes.status === 'fulfilled');
      } catch {
        // giữ hình học dự phòng
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { zones, endpoints, live };
}

const VIEW_W = 1000;
const VIEW_H = 560;

export function IndoorHospitalMap({
  targetRoom = 'P_CAP_CUU',
  targetSubText,
  mapName = 'final_o_truong',
  robotCode = 'ROBOT_MAR_01',
  robotBusy = false,
  robotPose = DEFAULT_POSE,
  onSelectTarget,
}: Props) {
  const { zones, endpoints, live } = useBackendGeometry();
  const [mode, setMode] = useState<FilterMode>('otto_cad');

  // Tính khung nhìn (mét → px SVG), trục Y hướng lên như ROS.
  const project = useMemo(() => {
    const pts: MapPoint[] = [
      ...zones.flatMap((z) => z.points),
      ...endpoints.map((e) => ({ x: e.x, y: e.y })),
      { x: robotPose.xM, y: robotPose.yM },
    ];
    const pad = 1;
    const xMin = Math.min(...pts.map((p) => p.x)) - pad;
    const xMax = Math.max(...pts.map((p) => p.x)) + pad;
    const yMin = Math.min(...pts.map((p) => p.y)) - pad;
    const yMax = Math.max(...pts.map((p) => p.y)) + pad;
    const scale = Math.min(VIEW_W / (xMax - xMin), VIEW_H / (yMax - yMin));
    const offX = (VIEW_W - (xMax - xMin) * scale) / 2;
    const offY = (VIEW_H - (yMax - yMin) * scale) / 2;
    return {
      scale,
      toPx: (p: MapPoint) => ({
        x: offX + (p.x - xMin) * scale,
        y: offY + (yMax - p.y) * scale,
      }),
    };
  }, [zones, endpoints, robotPose.xM, robotPose.yM]);

  const { toPx, scale } = project;
  const targetCode = (targetRoom || '').toUpperCase();
  const targetEndpoint =
    endpoints.find((e) => e.code.toUpperCase() === targetCode) ??
    endpoints.find((e) => e.code.toUpperCase().includes(targetCode) || targetCode.includes(e.code.toUpperCase()));

  const robotPx = toPx({ x: robotPose.xM, y: robotPose.yM });
  const targetPx = targetEndpoint ? toPx({ x: targetEndpoint.x, y: targetEndpoint.y }) : null;

  // Quỹ đạo Nav2: đi theo hành lang (L-shape) từ robot tới đích.
  const trajectory = targetPx
    ? `${robotPx.x},${robotPx.y} ${targetPx.x},${robotPx.y} ${targetPx.x},${targetPx.y}`
    : '';

  const dark = mode === 'otto_dark';
  const raw = mode === 'raw';
  const canvasBg = dark ? '#1E242B' : raw ? '#7F7F7F' : '#CDCDCD';
  const roomFill = dark ? '#2B333D' : '#FFFFFF';
  const roomStroke = dark ? '#475569' : '#1F2937';
  const textColor = dark ? '#E2E8F0' : '#1F2937';
  const roomCount = zones.filter((z) => z.zoneType === 'ROOM').length;
  const fs = Math.max(13, scale * 0.42);
  const robotR = Math.max(14, scale * 0.45);

  const nextMode: Record<FilterMode, FilterMode> = { otto_cad: 'otto_dark', otto_dark: 'raw', raw: 'otto_cad' };
  const modeLabel: Record<FilterMode, string> = { otto_cad: 'OTTO CAD', otto_dark: 'OTTO DARK', raw: 'RAW MAP' };

  return (
    <View style={styles.wrapper}>
      {/* Status bar giống Staff */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <View style={[styles.statusDot, { backgroundColor: live ? '#22C55E' : '#F59E0B' }]} />
          <Text style={styles.statusText} numberOfLines={1}>
            {live ? 'BE LIVE' : 'OFFLINE'} · {mapName} · {roomCount} PHÒNG · {endpoints.length} ĐIỂM
          </Text>
        </View>
        <Text style={styles.statusRobot}>
          {robotCode} · {robotBusy ? 'BUSY' : 'IDLE'}
        </Text>
      </View>

      <View style={[styles.canvas, { backgroundColor: canvasBg }]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Defs>
            <Pattern id="ottoCadGrid" width={scale} height={scale} patternUnits="userSpaceOnUse">
              <Path
                d={`M ${scale} 0 L 0 0 0 ${scale}`}
                fill="none"
                stroke={dark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.10)'}
                strokeWidth={1}
              />
            </Pattern>
            <Pattern id="ottoHazardStripe" width={16} height={16} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Rect width={16} height={16} fill="rgba(239,68,68,0.18)" />
              <Rect width={6} height={16} fill="rgba(239,68,68,0.55)" />
            </Pattern>
            <Pattern id="ottoSpeedPattern" width={14} height={14} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <Rect width={14} height={14} fill="rgba(2,132,199,0.12)" />
              <Rect width={4} height={14} fill="rgba(2,132,199,0.40)" />
            </Pattern>
          </Defs>

          {!raw && <Rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#ottoCadGrid)" />}

          {/* Phòng (vùng ROOM) */}
          {zones
            .filter((z) => z.zoneType === 'ROOM')
            .map((z) => {
              const pts = z.points.map(toPx);
              const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
              const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
              const isTarget = z.code.toUpperCase() === targetCode;
              return (
                <G key={`room-${z.code}`} onPress={() => onSelectTarget?.(z.code)}>
                  <Polygon
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={isTarget ? 'rgba(14,165,233,0.22)' : roomFill}
                    stroke={isTarget ? '#0EA5E9' : roomStroke}
                    strokeWidth={isTarget ? 4 : 2.5}
                  />
                  <SvgText x={cx} y={cy + fs * 0.35} fontSize={fs} fontWeight="700" fill={isTarget ? '#0369A1' : textColor} textAnchor="middle">
                    {z.name || z.code}
                  </SvgText>
                </G>
              );
            })}

          {/* Traffic Control Zones */}
          {zones
            .filter((z) => z.zoneType !== 'ROOM')
            .map((z) => {
              const pts = z.points.map(toPx);
              const keepOut = z.zoneType === 'KEEP_OUT';
              const color = keepOut ? '#EF4444' : '#0284C7';
              const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
              const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
              const label = keepOut ? 'KEEP OUT' : 'SPEED';
              const bw = label.length * 8 + 14;
              return (
                <G key={`zone-${z.code}`}>
                  <Polygon
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={keepOut ? 'url(#ottoHazardStripe)' : 'url(#ottoSpeedPattern)'}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="8 5"
                  />
                  <Rect x={cx - bw / 2} y={cy - 11} width={bw} height={22} rx={11} fill={color} />
                  <SvgText x={cx} y={cy + 4.5} fontSize={12} fontWeight="700" fill="#FFFFFF" textAnchor="middle">
                    {label}
                  </SvgText>
                </G>
              );
            })}

          {/* Quỹ đạo Nav2 phát sáng */}
          {!!trajectory && (
            <>
              <Polyline points={trajectory} fill="none" stroke="rgba(14,165,233,0.35)" strokeWidth={14} strokeLinejoin="round" strokeLinecap="round" />
              <Polyline points={trajectory} fill="none" stroke="#0EA5E9" strokeWidth={4} strokeDasharray="14 8" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}

          {/* Endpoints */}
          {endpoints.map((e) => {
            const p = toPx({ x: e.x, y: e.y });
            const isTarget = e.code === targetEndpoint?.code;
            return (
              <G key={`ep-${e.code}`} onPress={() => onSelectTarget?.(e.code)}>
                <Circle cx={p.x} cy={p.y} r={isTarget ? 13 : 8} fill={isTarget ? '#0EA5E9' : '#F59E0B'} stroke="#FFFFFF" strokeWidth={3} />
                {isTarget && <Circle cx={p.x} cy={p.y} r={22} fill="none" stroke="#0EA5E9" strokeWidth={2} opacity={0.6} />}
              </G>
            );
          })}

          {/* Footprint AMR OTTO: trường LiDAR + thân xe + LED */}
          <G transform={`translate(${robotPx.x}, ${robotPx.y}) rotate(${(-robotPose.yawRad * 180) / Math.PI})`}>
            <Circle r={robotR * 2.4} fill="rgba(16,185,129,0.10)" stroke="rgba(16,185,129,0.45)" strokeWidth={1.5} strokeDasharray="6 4" />
            <Rect x={-robotR * 1.3} y={-robotR * 0.9} width={robotR * 2.6} height={robotR * 1.8} rx={robotR * 0.35} fill="#FFFFFF" stroke="#0F172A" strokeWidth={2.5} />
            <Rect x={robotR * 1.05} y={-robotR * 0.6} width={robotR * 0.22} height={robotR * 1.2} rx={2} fill="#10B981" />
            <Rect x={-robotR * 1.25} y={-robotR * 0.75} width={robotR * 0.16} height={robotR * 0.35} fill="#EF4444" />
            <Rect x={-robotR * 1.25} y={robotR * 0.4} width={robotR * 0.16} height={robotR * 0.35} fill="#EF4444" />
            <Line x1={0} y1={0} x2={robotR * 0.8} y2={0} stroke="#0F172A" strokeWidth={2.5} />
          </G>
        </Svg>

        {/* HUD 1: trục toạ độ + vị trí */}
        <View style={styles.hudAxis} pointerEvents="none">
          <Svg width={34} height={34}>
            <Line x1={4} y1={30} x2={30} y2={30} stroke="#EF4444" strokeWidth={2} />
            <Line x1={4} y1={30} x2={4} y2={4} stroke="#10B981" strokeWidth={2} />
          </Svg>
          <View>
            <Text style={styles.hudText}>x: {robotPose.xM.toFixed(2)} m</Text>
            <Text style={styles.hudText}>y: {robotPose.yM.toFixed(2)} m</Text>
          </View>
        </View>

        {/* HUD 2: phiên bản bản đồ */}
        <View style={styles.hudVersion} pointerEvents="none">
          <Text style={styles.hudVersionText}>🔒 Live › v1: {mapName}</Text>
        </View>

        {/* HUD 3: bộ lọc hiển thị */}
        <Pressable style={styles.hudFilter} onPress={() => setMode(nextMode[mode])} accessibilityRole="button">
          <Text style={styles.hudFilterText}>{modeLabel[mode]}</Text>
        </Pressable>

        {!!targetEndpoint && (
          <View style={styles.hudTarget} pointerEvents="none">
            <Text style={styles.hudTargetText} numberOfLines={1}>
              ➜ {targetEndpoint.code}
              {targetSubText ? ` · ${targetSubText}` : ''}
            </Text>
          </View>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <LegendItem color="#0284C7" label="Speed Limit Zone" />
        <LegendItem color="#EF4444" label="Exclusion Zone" />
        <LegendItem
          color="#10B981"
          label={`AMR (${robotPose.xM.toFixed(1)}, ${robotPose.yM.toFixed(1)} · ${Math.round((robotPose.yawRad * 180) / Math.PI)}°)`}
        />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: '#E2E8F0', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, flexShrink: 1 },
  statusRobot: { color: '#38BDF8', fontSize: 10, fontWeight: '700' },
  canvas: { width: '100%', aspectRatio: VIEW_W / VIEW_H, position: 'relative' },
  hudAxis: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  hudText: { color: '#E2E8F0', fontSize: 9, fontFamily: 'monospace' },
  hudVersion: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    left: '38%',
    backgroundColor: 'rgba(16,185,129,0.92)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hudVersionText: { color: '#FFFFFF', fontSize: 9, fontWeight: '700' },
  hudFilter: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  hudFilterText: { color: '#38BDF8', fontSize: 9, fontWeight: '800' },
  hudTarget: {
    position: 'absolute',
    top: 6,
    left: 6,
    maxWidth: '60%',
    backgroundColor: 'rgba(14,165,233,0.92)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hudTargetText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { color: '#CBD5E1', fontSize: 9, fontWeight: '600' },
});
