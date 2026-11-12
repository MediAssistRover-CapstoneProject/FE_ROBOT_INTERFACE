import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Pattern,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NavigationGuidanceBanner } from './NavigationGuidanceBanner';
import {
  NavigationGuidanceResult,
  guidanceSymbol,
} from '../../features/navigation/navigationGuidance';
import {
  analyzeSlamMapGeometry,
  decodePngGrayscale,
  SlamAutoAlignResult,
} from './slamMapAutoAlign';

export interface MapRobotPose {
  robotId?: string;
  mapId?: string;
  xM: number;
  yM: number;
  yawRad: number;
  fresh?: boolean;
  capturedAt?: string;
  localizationConfidence?: number;
}

export interface MapPlanPoint {
  xM: number;
  yM: number;
}

export interface MapResponse {
  mapId: string;
  floorId?: string;
  mapCode?: string;
  versionNo?: number;
  mapName: string;
  widthM?: number;
  heightM?: number;
  resolutionMPerPixel?: number;
  originXM?: number;
  originYM?: number;
  originYawRad?: number;
}

export interface ZoneDto {
  zoneId?: string;
  mapId?: string;
  zoneCode: string;
  zoneName?: string;
  zoneType: 'KEEP_OUT' | 'SPEED' | 'RESTRICTED' | 'NORMAL' | string;
  polygonJson: any;
  speedLimitMps?: number | null;
  active?: boolean;
}

export interface EndpointResponse {
  endpointId?: string;
  mapId?: string;
  zoneId?: string;
  endpointCode: string;
  endpointName?: string;
  endpointType?: string;
  xM?: number;
  yM?: number;
  yawRad?: number;
  active?: boolean;
}

export interface PresentationPoint {
  x: number;
  y: number;
}

export interface PresentationFeature {
  id: string;
  type: 'ROOM' | 'WALL' | 'CORRIDOR' | 'DOOR' | 'LABEL' | 'LANDMARK' | string;
  label?: string;
  color?: string;
  points: PresentationPoint[];
  lineWidthM?: number;
  fontSizeM?: number;
  endpointId?: string | null;
  roomId?: string | null;
  roomCode?: string | null;
  roomName?: string | null;
  roomType?: string | null;
  departmentCode?: string | null;
  roomDescription?: string | null;
  roomPublicVisible?: boolean | null;
}

export interface PresentationDocument {
  schemaVersion?: number;
  backgroundColor?: string;
  rotationDegrees?: number;
  features: PresentationFeature[];
}

export interface BackendHospitalMapProps {
  map: MapResponse;
  metadata?: Record<string, any> | null;
  endpoints: EndpointResponse[];
  zones: ZoneDto[];
  presentation?: PresentationDocument | null;
  token?: string | null;
  selectedEndpointId?: string | null;
  onSelectEndpoint?: (endpoint: EndpointResponse) => void;
  robotPose?: MapRobotPose | null;
  isPoseLive?: boolean;
  plannedPath?: MapPlanPoint[] | null;
  customImageUrl?: string;
  guidance?: NavigationGuidanceResult | null;
  onStopEscort?: () => void;
  isStoppingEscort?: boolean;
}

interface MapPoint {
  x: number;
  y: number;
}

type MapFilterMode = 'otto_cad' | 'otto_dark' | 'raw';

const readPoint = (value: any): MapPoint | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  if (value && typeof value === 'object') {
    const x = Number(value.xM ?? value.x_m ?? value.x ?? value.lng);
    const y = Number(value.yM ?? value.y_m ?? value.y ?? value.lat);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  return null;
};

const readPolygon = (polygonJson: unknown): MapPoint[] => {
  if (!polygonJson) return [];

  let value: any = polygonJson;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  const candidates =
    value?.type === 'Polygon'
      ? value.coordinates?.[0]
      : value?.points ?? value?.vertices ?? value?.coordinates ?? value;

  if (!Array.isArray(candidates)) return [];
  return candidates.map(readPoint).filter((point): point is MapPoint => point !== null);
};

export const BackendHospitalMap: React.FC<BackendHospitalMapProps> = ({
  map,
  metadata,
  endpoints,
  zones,
  presentation,
  token,
  selectedEndpointId,
  onSelectEndpoint,
  robotPose,
  isPoseLive = false,
  plannedPath,
  customImageUrl,
  guidance,
  onStopEscort,
  isStoppingEscort,
}) => {
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [autoAlign, setAutoAlign] = useState<SlamAutoAlignResult | null>(null);
  const [filterMode, setFilterMode] = useState<MapFilterMode>('otto_cad');

  const presentationRooms = useMemo(() => {
    if (!presentation?.features) return [];
    return presentation.features.filter(
      (f) =>
        (f.type === 'ROOM' || f.type === 'CORRIDOR') &&
        Array.isArray(f.points) &&
        f.points.length >= 3
    );
  }, [presentation]);

  const presentationWalls = useMemo(() => {
    if (!presentation?.features) return [];
    return presentation.features.filter(
      (f) => f.type === 'WALL' && Array.isArray(f.points) && f.points.length >= 2
    );
  }, [presentation]);

  const imageUrl = useMemo(() => {
    if (customImageUrl) return customImageUrl;
    if (metadata?.image_url && typeof metadata.image_url === 'string') {
      return metadata.image_url;
    }
    return `https://mediassistrover.duckdns.org/api/v1/maps/${map.mapId}/image.png`;
  }, [customImageUrl, map.mapId, metadata?.image_url]);

  const mapImageSource = useMemo(
    () => ({
      uri: imageUrl,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),
    [imageUrl, token]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoadingImage(true);
    setImageFailed(false);
    setNaturalSize(null);
    setAutoAlign(null);

    // Tải binary PNG để tự động nhận diện góc nghiêng viền tường SLAM
    const analyzeMapBinary = async () => {
      try {
        const res = await fetch(imageUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const decoded = decodePngGrayscale(new Uint8Array(buffer));
        if (!decoded || cancelled) return;

        setNaturalSize({ width: decoded.width, height: decoded.height });
        const aligned = analyzeSlamMapGeometry(decoded.width, decoded.height, decoded.gray);
        if (!cancelled) {
          setAutoAlign(aligned);
          setIsLoadingImage(false);
        }
      } catch {
        if (!cancelled && imageUrl && typeof Image.getSizeWithHeaders === 'function') {
          Image.getSizeWithHeaders(
            imageUrl,
            token ? { Authorization: `Bearer ${token}` } : {},
            (width, height) => {
              if (!cancelled && width > 0 && height > 0) {
                setNaturalSize({ width, height });
              }
              if (!cancelled) setIsLoadingImage(false);
            },
            () => {
              if (!cancelled) setIsLoadingImage(false);
            }
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingImage(false);
        }
      }
    };

    analyzeMapBinary();

    return () => {
      cancelled = true;
    };
  }, [imageUrl, map.mapId, token]);

  const visibleEndpoints = useMemo(
    () =>
      endpoints.filter(
        (endpoint) =>
          endpoint.mapId === map.mapId &&
          endpoint.active !== false &&
          Number.isFinite(Number(endpoint.xM)) &&
          Number.isFinite(Number(endpoint.yM))
      ),
    [endpoints, map.mapId]
  );

  const visibleZones = useMemo(
    () =>
      zones
        .filter((zone) => zone.mapId === map.mapId && zone.active !== false)
        .map((zone) => ({ zone, points: readPolygon(zone.polygonJson) }))
        .filter(({ points }) => points.length >= 3),
    [map.mapId, zones]
  );

  const validPlannedPath = useMemo(() => {
    if (!Array.isArray(plannedPath) || plannedPath.length < 2) return null;
    const pts = plannedPath
      .map((p: any) => ({
        xM: Number(p?.xM ?? p?.x_m ?? p?.x),
        yM: Number(p?.yM ?? p?.y_m ?? p?.y),
      }))
      .filter((p) => Number.isFinite(p.xM) && Number.isFinite(p.yM));
    return pts.length >= 2 ? pts : null;
  }, [plannedPath]);

  const validRobotPose = useMemo(() => {
    if (!robotPose) return null;
    const xM = Number(robotPose.xM);
    const yM = Number(robotPose.yM);
    if (!Number.isFinite(xM) || !Number.isFinite(yM)) return null;
    return {
      ...robotPose,
      xM,
      yM,
      yawRad: Number(robotPose.yawRad) || 0,
    };
  }, [robotPose]);

  const geometry = useMemo(() => {
    const resolution = Math.max(
      Number(
        metadata?.resolution ??
          metadata?.resolution_m_per_pixel ??
          metadata?.resolutionMPerPixel ??
          map.resolutionMPerPixel
      ) || 0.025,
      0.000001
    );

    const metaWidthPx = Number(
      metadata?.width_px ?? metadata?.widthPx ?? metadata?.imageWidthPx ?? metadata?.width
    );
    const metaHeightPx = Number(
      metadata?.height_px ?? metadata?.heightPx ?? metadata?.imageHeightPx ?? metadata?.height
    );

    const pixelWidth = Math.max(
      1,
      (autoAlign?.width && autoAlign.width > 0 ? autoAlign.width : 0) ||
        (metaWidthPx > 0 ? metaWidthPx : 0) ||
        (naturalSize?.width && naturalSize.width > 0 ? naturalSize.width : 0) ||
        (Number(map.widthM) > 0 ? Number(map.widthM) / resolution : 1)
    );
    const pixelHeight = Math.max(
      1,
      (autoAlign?.height && autoAlign.height > 0 ? autoAlign.height : 0) ||
        (metaHeightPx > 0 ? metaHeightPx : 0) ||
        (naturalSize?.height && naturalSize.height > 0 ? naturalSize.height : 0) ||
        (Number(map.heightM) > 0 ? Number(map.heightM) / resolution : 1)
    );

    const origin = Array.isArray(metadata?.origin) ? metadata.origin : [];
    const originX =
      Number(
        metadata?.origin_x_m ??
          metadata?.originXM ??
          metadata?.originX ??
          origin[0] ??
          map.originXM
      ) || 0;
    const originY =
      Number(
        metadata?.origin_y_m ??
          metadata?.originYM ??
          metadata?.originY ??
          origin[1] ??
          map.originYM
      ) || 0;
    const originYaw =
      Number(
        metadata?.origin_yaw_rad ??
          metadata?.originYawRad ??
          metadata?.originYaw ??
          metadata?.yaw ??
          origin[2] ??
          map.originYawRad
      ) || 0;
    const cosO = Math.cos(originYaw);
    const sinO = Math.sin(originYaw);

    const rotationDeg =
      presentation?.rotationDegrees !== undefined
        ? presentation.rotationDegrees
        : autoAlign
        ? autoAlign.rotationDeg
        : -19.9;
    const rotationRad = (rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rotationRad);
    const sinR = Math.sin(rotationRad);

    const worldToRotatedCenter = (point: MapPoint) => {
      const dx = point.x - originX;
      const dy = point.y - originY;
      const u = (cosO * dx + sinO * dy) / resolution;
      const v = pixelHeight - (-sinO * dx + cosO * dy) / resolution;
      const relU = u - pixelWidth / 2;
      const relV = v - pixelHeight / 2;
      return {
        rx: cosR * relU - sinR * relV,
        ry: sinR * relU + cosR * relV,
        rawU: u,
        rawV: v,
      };
    };

    let xMin = autoAlign ? autoAlign.xMin : -pixelWidth * 0.45;
    let xMax = autoAlign ? autoAlign.xMax : pixelWidth * 0.45;
    let yMin = autoAlign ? autoAlign.yMin : -pixelHeight * 0.42;
    let yMax = autoAlign ? autoAlign.yMax : pixelHeight * 0.42;

    const expandWithPoint = (pt: MapPoint, margin = 6) => {
      const { rx, ry } = worldToRotatedCenter(pt);
      if (rx - margin < xMin) xMin = rx - margin;
      if (rx + margin > xMax) xMax = rx + margin;
      if (ry - margin < yMin) yMin = ry - margin;
      if (ry + margin > yMax) yMax = ry + margin;
    };

    if (presentation?.features) {
      presentation.features.forEach((feature) => {
        feature.points.forEach((p) => {
          expandWithPoint({ x: originX + p.x, y: originY + p.y }, 8);
        });
      });
    }

    visibleEndpoints.forEach((ep) =>
      expandWithPoint({ x: Number(ep.xM), y: Number(ep.yM) }, 6)
    );
    visibleZones.forEach(({ points }) => points.forEach((p) => expandWithPoint(p, 6)));
    if (validRobotPose) {
      expandWithPoint({ x: validRobotPose.xM, y: validRobotPose.yM }, 6);
    }

    const viewWidth = Math.max(10, xMax - xMin);
    const viewHeight = Math.max(10, yMax - yMin);

    const toViewPixel = (point: MapPoint) => {
      const { rx, ry, rawU, rawV } = worldToRotatedCenter(point);
      return {
        x: rx - xMin,
        y: ry - yMin,
        rawU,
        rawV,
      };
    };

    const toViewHeadingRad = (yawRad: number) => {
      const safeYaw = Number.isFinite(yawRad) ? yawRad : 0;
      return -(safeYaw - originYaw) + rotationRad;
    };

    return {
      pixelWidth,
      pixelHeight,
      resolution,
      originX,
      originY,
      originYaw,
      rotationDeg,
      rotationRad,
      xMin,
      xMax,
      yMin,
      yMax,
      viewWidth,
      viewHeight,
      toViewPixel,
      toViewHeadingRad,
    };
  }, [
    autoAlign,
    map,
    metadata,
    naturalSize,
    presentation,
    validRobotPose,
    visibleEndpoints,
    visibleZones,
  ]);

  const cycleFilterMode = () => {
    setFilterMode((prev) =>
      prev === 'otto_cad' ? 'otto_dark' : prev === 'otto_dark' ? 'raw' : 'otto_cad'
    );
  };

  const viewWidth = geometry.viewWidth;
  const viewHeight = geometry.viewHeight;
  const aspectRatio = viewWidth / viewHeight;

  const imageWidthPct = (geometry.pixelWidth / viewWidth) * 100;
  const imageHeightPct = (geometry.pixelHeight / viewHeight) * 100;
  const imageLeftPct = ((-geometry.xMin - geometry.pixelWidth / 2) / viewWidth) * 100;
  const imageTopPct = ((-geometry.yMin - geometry.pixelHeight / 2) / viewHeight) * 100;

  const gridStepPx = Math.max(12, 1 / geometry.resolution);

  return (
    <View style={styles.outerWrapper}>
      <View
        style={[
          styles.canvasContainer,
          {
            aspectRatio,
            backgroundColor: filterMode === 'otto_dark' ? '#1E242B' : '#F8FAFC',
          },
        ]}
      >
        <View style={styles.gridBackground} />

        {!imageFailed && (
          <Image
            source={mapImageSource}
            resizeMode="stretch"
            style={[
              styles.rotatedMapImage,
              {
                width: `${imageWidthPct}%`,
                height: `${imageHeightPct}%`,
                left: `${imageLeftPct}%`,
                top: `${imageTopPct}%`,
                opacity: filterMode === 'otto_dark' ? 0.88 : 0.98,
                transform: [{ rotate: `${geometry.rotationDeg}deg` }],
              },
            ]}
            onLoad={(event) => {
              const src = event.nativeEvent?.source;
              if (src?.width && src?.height) {
                setNaturalSize((prev) => prev || { width: src.width, height: src.height });
              }
              setIsLoadingImage(false);
            }}
            onLoadEnd={() => setIsLoadingImage(false)}
            onError={() => {
              setImageFailed(true);
              setIsLoadingImage(false);
            }}
          />
        )}

        {filterMode !== 'raw' && (
          <View
            pointerEvents="none"
            style={[
              styles.fullSize,
              filterMode === 'otto_cad' ? styles.ottoCadTint : styles.ottoDarkTint,
            ]}
          />
        )}

        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          preserveAspectRatio="none"
          style={styles.fullSize}
        >
          <Defs>
            <Pattern
              id="ottoCadGrid"
              width={gridStepPx}
              height={gridStepPx}
              patternUnits="userSpaceOnUse"
            >
              <Line
                x1="0"
                y1="0"
                x2={gridStepPx}
                y2="0"
                stroke={
                  filterMode === 'otto_dark'
                    ? 'rgba(56, 189, 248, 0.14)'
                    : 'rgba(14, 116, 144, 0.11)'
                }
                strokeWidth="0.45"
              />
              <Line
                x1="0"
                y1="0"
                x2="0"
                y2={gridStepPx}
                stroke={
                  filterMode === 'otto_dark'
                    ? 'rgba(56, 189, 248, 0.14)'
                    : 'rgba(14, 116, 144, 0.11)'
                }
                strokeWidth="0.45"
              />
            </Pattern>

            <Pattern
              id="ottoHazardStripe"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <Rect width="6" height="6" fill="rgba(239, 68, 68, 0.18)" />
              <Line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="rgba(220, 38, 38, 0.52)"
                strokeWidth="2.2"
              />
            </Pattern>

            <Pattern
              id="ottoSpeedPattern"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-30)"
            >
              <Rect width="5" height="5" fill="rgba(14, 165, 233, 0.18)" />
              <Line
                x1="0"
                y1="0"
                x2="0"
                y2="5"
                stroke="rgba(2, 132, 199, 0.36)"
                strokeWidth="1.4"
              />
            </Pattern>
          </Defs>

          {filterMode !== 'raw' && (
            <Rect
              x="0"
              y="0"
              width={viewWidth}
              height={viewHeight}
              fill="url(#ottoCadGrid)"
            />
          )}

          {/* Sơ đồ CAD Kiến trúc (Presentation Map): Tường (Walls) */}
          {presentationWalls.map((wall, idx) => {
            const pixelPoints = wall.points.map((p) =>
              geometry.toViewPixel({
                x: geometry.originX + p.x,
                y: geometry.originY + p.y,
              })
            );
            const pointsStr = pixelPoints.map((p) => `${p.x},${p.y}`).join(' ');
            return (
              <Polyline
                key={wall.id || `pres-wall-${idx}`}
                points={pointsStr}
                fill="none"
                stroke={wall.color || '#334155'}
                strokeWidth={Math.max(1.8, viewWidth / 140)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Sơ đồ CAD Kiến trúc (Presentation Map): Các phòng khám dạng khối màu sắc sắc nét */}
          {presentationRooms.map((room) => {
            const pixelPoints = room.points.map((p) =>
              geometry.toViewPixel({
                x: geometry.originX + p.x,
                y: geometry.originY + p.y,
              })
            );
            const pointsStr = pixelPoints.map((p) => `${p.x},${p.y}`).join(' ');
            const centerX =
              pixelPoints.reduce((s, p) => s + p.x, 0) / pixelPoints.length;
            const centerY =
              pixelPoints.reduce((s, p) => s + p.y, 0) / pixelPoints.length;

            const matchEp = visibleEndpoints.find((e) => {
              if (room.endpointId && e.endpointId === room.endpointId) return true;
              const epCode = (e.endpointCode || '').trim().toLowerCase();
              const rCode = (room.roomCode || '').trim().toLowerCase();
              const rLabel = (room.label || '').trim().toLowerCase();
              if (rCode && epCode === rCode) return true;
              if (rLabel && epCode === rLabel) return true;
              if (rLabel && (e.endpointName || '').toLowerCase().includes(rLabel)) return true;
              return false;
            });

            const isSelected = Boolean(
              selectedEndpointId &&
                ((room.endpointId && selectedEndpointId === room.endpointId) ||
                  (matchEp &&
                    (selectedEndpointId === matchEp.endpointId ||
                      selectedEndpointId.toLowerCase() ===
                        (matchEp.endpointCode || '').toLowerCase())) ||
                  (room.roomCode &&
                    selectedEndpointId.toLowerCase() === room.roomCode.toLowerCase()) ||
                  (room.label &&
                    selectedEndpointId.toLowerCase() === room.label.toLowerCase()))
            );

            const roomColor = room.color || '#3B82F6';
            const labelFontSize = Math.max(4.6, viewWidth / 34);

            return (
              <G
                key={room.id}
                onPress={
                  matchEp && onSelectEndpoint
                    ? () => onSelectEndpoint(matchEp)
                    : undefined
                }
              >
                {/* Khối phòng màu pastel nổi bật */}
                <Polygon
                  points={pointsStr}
                  fill={roomColor}
                  fillOpacity={isSelected ? 0.35 : 0.18}
                  stroke={roomColor}
                  strokeWidth={
                    isSelected
                      ? Math.max(2.4, viewWidth / 100)
                      : Math.max(1.4, viewWidth / 160)
                  }
                  strokeLinejoin="round"
                />
                {/* Tên phòng với viền trắng tương phản cao (Halo) */}
                {room.label ? (
                  <G pointerEvents="none">
                    <SvgText
                      x={centerX}
                      y={centerY + labelFontSize * 0.32}
                      textAnchor="middle"
                      fontSize={labelFontSize}
                      fontWeight="800"
                      fill="#FFFFFF"
                      stroke="#FFFFFF"
                      strokeWidth={Math.max(2.4, viewWidth / 75)}
                      strokeLinejoin="round"
                    >
                      {room.label}
                    </SvgText>
                    <SvgText
                      x={centerX}
                      y={centerY + labelFontSize * 0.32}
                      textAnchor="middle"
                      fontSize={labelFontSize}
                      fontWeight="800"
                      fill="#0F172A"
                    >
                      {room.label}
                    </SvgText>
                  </G>
                ) : null}
              </G>
            );
          })}

          {/* 1. Các phân khu Traffic Control (Zones) */}
          {visibleZones.map(({ zone, points }) => {
            const pixelPoints = points.map(geometry.toViewPixel);
            const pointsText = pixelPoints.map((point) => `${point.x},${point.y}`).join(' ');
            const labelX =
              pixelPoints.reduce((sum, point) => sum + point.x, 0) / pixelPoints.length;
            const labelY =
              pixelPoints.reduce((sum, point) => sum + point.y, 0) / pixelPoints.length;
            const zoneEndpoint = visibleEndpoints.find(
              (endpoint) => endpoint.zoneId === zone.zoneId
            );
            const isKeepOut = zone.zoneType === 'KEEP_OUT';
            const strokeColor = isKeepOut ? '#EF4444' : '#0284C7';
            const innerDashColor = isKeepOut ? '#FCA5A5' : '#38BDF8';
            const badgeBg = isKeepOut
              ? 'rgba(153, 27, 27, 0.90)'
              : 'rgba(3, 105, 161, 0.90)';
            const zoneLabel = (zone.zoneName || zone.zoneCode || '').trim();
            const zoneFontSize = Math.max(4.6, viewWidth / 38);
            const badgeW = Math.max(zoneLabel.length * zoneFontSize * 0.58 + 7, 18);
            const badgeH = zoneFontSize + 3.4;

            return (
              <G
                key={zone.zoneId || zone.zoneCode}
                onPress={zoneEndpoint && onSelectEndpoint ? () => onSelectEndpoint(zoneEndpoint) : undefined}
              >
                <Polygon
                  points={pointsText}
                  fill={isKeepOut ? 'url(#ottoHazardStripe)' : 'url(#ottoSpeedPattern)'}
                  stroke={strokeColor}
                  strokeWidth={Math.max(1.3, viewWidth / 165)}
                />
                <Polygon
                  points={pointsText}
                  fill="none"
                  stroke={innerDashColor}
                  strokeWidth={Math.max(0.7, viewWidth / 280)}
                  strokeDasharray="3,2"
                />
                <Rect
                  x={labelX - badgeW / 2}
                  y={labelY - badgeH / 2}
                  width={badgeW}
                  height={badgeH}
                  rx={badgeH / 2}
                  fill={badgeBg}
                  stroke={innerDashColor}
                  strokeWidth={0.5}
                />
                <SvgText
                  x={labelX}
                  y={labelY + zoneFontSize * 0.32}
                  textAnchor="middle"
                  fontSize={zoneFontSize}
                  fontWeight="800"
                  fill="#FFFFFF"
                >
                  {zoneLabel}
                </SvgText>
              </G>
            );
          })}

          {/* 2. Đường dẫn Nav2 phát sáng & Tách chặng theo Guidance */}
          {validPlannedPath && (() => {
            const isTracking =
              guidance?.state === 'TRACKING' &&
              guidance.projection &&
              typeof guidance.segmentIndex === 'number';

            // Đoạn sắp đi (upcoming path)
            const upcomingPoints: MapPlanPoint[] = isTracking
              ? [
                  { xM: guidance.projection!.xM, yM: guidance.projection!.yM },
                  ...validPlannedPath.slice(guidance.segmentIndex! + 1),
                ]
              : validPlannedPath;

            // Đoạn đã đi qua (completed path)
            const completedPoints: MapPlanPoint[] = isTracking
              ? [
                  ...validPlannedPath.slice(0, guidance.segmentIndex! + 1),
                  { xM: guidance.projection!.xM, yM: guidance.projection!.yM },
                ]
              : [];

            const completedPoly = completedPoints
              .map((pt) => {
                const p = geometry.toViewPixel({ x: Number(pt.xM), y: Number(pt.yM) });
                return `${p.x},${p.y}`;
              })
              .join(' ');

            const upcomingPoly = upcomingPoints
              .map((pt) => {
                const p = geometry.toViewPixel({ x: Number(pt.xM), y: Number(pt.yM) });
                return `${p.x},${p.y}`;
              })
              .join(' ');

            const lastPt = validPlannedPath[validPlannedPath.length - 1];
            const endPixel = lastPt ? geometry.toViewPixel({ x: lastPt.xM, y: lastPt.yM }) : null;

            // Điểm rẽ tiếp theo (turn indicator badge trên bản đồ)
            const turnPixel =
              guidance?.state === 'TRACKING' && guidance.turn
                ? geometry.toViewPixel({ x: guidance.turn.xM, y: guidance.turn.yM })
                : null;
            const turnBadgeRadius = Math.max(9, viewWidth / 48);

            return (
              <G>
                {/* 2a. Đoạn đường đã đi qua: màu xanh nhạt (#A9BFD8) */}
                {isTracking && completedPoly.length > 0 && (
                  <Polyline
                    points={completedPoly}
                    fill="none"
                    stroke="#A9BFD8"
                    strokeWidth={Math.max(2.4, viewWidth / 110)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.65}
                  />
                )}

                {/* 2b. Đoạn sắp đi: Hào quang phát sáng xanh dương đậm */}
                <Polyline
                  points={upcomingPoly}
                  fill="none"
                  stroke="rgba(24, 119, 237, 0.40)"
                  strokeWidth={Math.max(5.0, viewWidth / 55)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* 2c. Đoạn sắp đi: Đường nét chính màu xanh đậm (#1877ED) */}
                <Polyline
                  points={upcomingPoly}
                  fill="none"
                  stroke="#1877ED"
                  strokeWidth={Math.max(2.8, viewWidth / 100)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* 2d. Đường nét đứt màu trắng nổi bật ở giữa */}
                <Polyline
                  points={upcomingPoly}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={Math.max(1.1, viewWidth / 220)}
                  strokeDasharray="5,4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* 2e. Điểm ghim đích nổi bật (Destination Pin: Đỏ #D94B3D viền trắng) */}
                {endPixel && (
                  <G>
                    <Circle
                      cx={endPixel.x}
                      cy={endPixel.y}
                      r={Math.max(6.5, viewWidth / 55)}
                      fill="#D94B3D"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                    <Circle
                      cx={endPixel.x}
                      cy={endPixel.y}
                      r={Math.max(2.2, viewWidth / 150)}
                      fill="#FFFFFF"
                    />
                  </G>
                )}

                {/* 2f. Dấu rẽ ở ngã rẽ tiếp theo (Turn Badge) */}
                {turnPixel && (
                  <G>
                    <Circle
                      cx={turnPixel.x}
                      cy={turnPixel.y}
                      r={turnBadgeRadius}
                      fill="#075DC4"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                    <SvgText
                      x={turnPixel.x}
                      y={turnPixel.y + turnBadgeRadius * 0.38}
                      fill="#FFFFFF"
                      fontSize={turnBadgeRadius * 1.3}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {guidanceSymbol(guidance?.direction)}
                    </SvgText>
                  </G>
                )}
              </G>
            );
          })()}

          {/* 3. Điểm dừng / Điểm đến (Endpoints) */}
          {visibleEndpoints.map((endpoint) => {
            const point = geometry.toViewPixel({
              x: Number(endpoint.xM),
              y: Number(endpoint.yM),
            });
            const isSelected =
              selectedEndpointId === endpoint.endpointId ||
              selectedEndpointId === endpoint.endpointCode ||
              Boolean(
                selectedEndpointId &&
                  endpoint.endpointCode &&
                  selectedEndpointId.toUpperCase() === endpoint.endpointCode.toUpperCase()
              );
            const r = isSelected ? Math.max(3.8, viewWidth / 68) : Math.max(2.4, viewWidth / 95);
            const hitRadius = Math.max(12, viewWidth / 16);
            const epLabel = (endpoint.endpointName || endpoint.endpointCode || '').trim();
            const fontSize = Math.max(3.8, viewWidth / 48);

            return (
              <G
                key={endpoint.endpointId || endpoint.endpointCode}
                onPress={onSelectEndpoint ? () => onSelectEndpoint(endpoint) : undefined}
              >
                <Circle
                  cx={point.x}
                  cy={point.y}
                  r={hitRadius}
                  fill="rgba(0, 0, 0, 0.001)"
                  stroke="none"
                />
                <Circle
                  cx={point.x}
                  cy={point.y}
                  r={isSelected ? r * 2.2 : r * 1.5}
                  fill={isSelected ? 'rgba(37, 99, 235, 0.35)' : 'rgba(14, 165, 233, 0.16)'}
                />
                <Circle
                  cx={point.x}
                  cy={point.y}
                  r={r}
                  fill={isSelected ? '#2563EB' : '#0284C7'}
                  stroke="#FFFFFF"
                  strokeWidth={Math.max(0.7, viewWidth / 260)}
                />
                {/* Chỉ hiển thị nhãn của endpoint nếu chưa có Presentation Room hoặc khi endpoint được chọn để giao diện thoáng, tinh tế */}
                {(presentationRooms.length === 0 || isSelected) && (
                  <G pointerEvents="none">
                    <SvgText
                      x={point.x}
                      y={point.y - r - 2}
                      textAnchor="middle"
                      fontSize={fontSize}
                      fontWeight="800"
                      fill="#FFFFFF"
                      stroke="#FFFFFF"
                      strokeWidth={Math.max(2, viewWidth / 85)}
                      strokeLinejoin="round"
                    >
                      {epLabel}
                    </SvgText>
                    <SvgText
                      x={point.x}
                      y={point.y - r - 2}
                      textAnchor="middle"
                      fontSize={fontSize}
                      fontWeight="800"
                      fill={isSelected ? '#1D4ED8' : '#0F172A'}
                    >
                      {epLabel}
                    </SvgText>
                  </G>
                )}
              </G>
            );
          })}

          {/* 4. Thân xe AMR (OTTO Chassis + Heading Direction) */}
          {validRobotPose && (() => {
            const robotPt = geometry.toViewPixel({
              x: validRobotPose.xM,
              y: validRobotPose.yM,
            });
            const headingDeg =
              (geometry.toViewHeadingRad(validRobotPose.yawRad) * 180) / Math.PI;
            const chassisLen = Math.max(9.5, viewWidth / 22);
            const chassisWid = chassisLen * 0.72;
            const safetyLen = chassisLen * 1.36;
            const safetyWid = chassisWid * 1.38;

            const safetyStroke = isPoseLive ? '#0EA5E9' : '#64748B';
            const safetyFill = isPoseLive
              ? 'rgba(14, 165, 233, 0.22)'
              : 'rgba(100, 116, 139, 0.18)';
            const frontLedColor = isPoseLive ? '#10B981' : '#94A3B8';

            return (
              <G
                transform={`translate(${robotPt.x}, ${robotPt.y}) rotate(${headingDeg})`}
              >
                <Rect
                  x={-safetyLen / 2}
                  y={-safetyWid / 2}
                  width={safetyLen}
                  height={safetyWid}
                  rx={safetyWid * 0.26}
                  fill={safetyFill}
                  stroke={safetyStroke}
                  strokeWidth={Math.max(0.9, viewWidth / 210)}
                />
                <Rect
                  x={-chassisLen / 2}
                  y={-chassisWid / 2}
                  width={chassisLen}
                  height={chassisWid}
                  rx={chassisWid * 0.2}
                  fill="#FFFFFF"
                  stroke="#0F172A"
                  strokeWidth={Math.max(0.7, viewWidth / 260)}
                />
                <Rect
                  x={chassisLen * 0.18}
                  y={-chassisWid * 0.32}
                  width={chassisLen * 0.22}
                  height={chassisWid * 0.64}
                  rx={chassisWid * 0.12}
                  fill={frontLedColor}
                />
                <Rect
                  x={-chassisLen * 0.44}
                  y={-chassisWid * 0.34}
                  width={chassisLen * 0.1}
                  height={chassisWid * 0.2}
                  rx={0.6}
                  fill="#EF4444"
                />
                <Rect
                  x={-chassisLen * 0.44}
                  y={chassisWid * 0.14}
                  width={chassisLen * 0.1}
                  height={chassisWid * 0.2}
                  rx={0.6}
                  fill="#EF4444"
                />
              </G>
            );
          })()}
        </Svg>

        {/* Banner chỉ dẫn điều hướng Nav2 (Còn 43 cm, rẽ phải) */}
        {guidance && guidance.state !== 'IDLE' && (
          <NavigationGuidanceBanner
            guidance={guidance}
            onStop={onStopEscort}
            isStopping={isStoppingEscort}
          />
        )}

        {/* HUD 1: Hệ trục tọa độ và vị trí mét */}
        <View style={styles.ottoAxisHud} pointerEvents="none">
          <Svg width={24} height={24} viewBox="0 0 28 28">
            <Line x1="14" y1="23" x2="14" y2="5" stroke="#94A3B8" strokeWidth="1.2" />
            <Polygon points="14,3 11.8,7 16.2,7" fill="#E2E8F0" />
            <Line x1="5" y1="14" x2="23" y2="14" stroke="#94A3B8" strokeWidth="1.2" />
            <Polygon points="25,14 21,11.8 21,16.2" fill="#E2E8F0" />
            <Circle cx="14" cy="14" r="1.8" fill="#38BDF8" />
          </Svg>
          <View style={styles.ottoAxisTextCol}>
            <Text style={styles.ottoAxisCoordText}>
              x: {validRobotPose ? `${validRobotPose.xM.toFixed(2)} m` : '-- m'}
            </Text>
            <Text style={styles.ottoAxisCoordText}>
              y: {validRobotPose ? `${validRobotPose.yM.toFixed(2)} m` : '-- m'}
            </Text>
          </View>
        </View>

        {/* HUD 2: Tên map và phiên bản Live */}
        <View style={styles.ottoLivePillWrap} pointerEvents="none">
          <View style={styles.ottoLivePill}>
            <View style={styles.ottoLiveLockIcon}>
              <Ionicons name="lock-closed" size={9} color="#052E16" />
            </View>
            <Text style={styles.ottoLivePillText} numberOfLines={1}>
              Live {'>'} v{map.versionNo || 1}: {map.mapName || 'final o truong'}
            </Text>
          </View>
        </View>

        {/* HUD 3: Nút chuyển Filter CAD / Dark / Raw */}
        <TouchableOpacity
          style={styles.ottoFilterBtn}
          onPress={cycleFilterMode}
          activeOpacity={0.8}
        >
          <Ionicons name="layers-outline" size={12} color="#38BDF8" />
          <Text style={styles.ottoFilterBtnText}>
            {filterMode === 'otto_cad'
              ? 'OTTO CAD'
              : filterMode === 'otto_dark'
              ? 'OTTO DARK'
              : 'RAW MAP'}
          </Text>
        </TouchableOpacity>

        {isLoadingImage && !naturalSize && !autoAlign && !imageFailed && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.loadingText}>Đang tải & căn chỉnh viền map...</Text>
          </View>
        )}

        {imageFailed && (
          <View style={styles.warningBadge} pointerEvents="none">
            <Text style={styles.warningText}>
              Đang hiển thị chế độ CAD từ dữ liệu tọa độ SLAM
            </Text>
          </View>
        )}
      </View>

      {/* Thanh chú thích Traffic Control */}
      <View style={styles.legendBar}>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#0284C7' }]} />
            <Text style={styles.legendLabel}>Speed Limit Zone</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
            <Text style={styles.legendLabel}>Exclusion Zone</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: validRobotPose
                    ? isPoseLive
                      ? '#10B981'
                      : '#64748B'
                    : '#94A3B8',
                },
              ]}
            />
            <Text style={styles.legendLabel}>
              {validRobotPose
                ? `AMR (${validRobotPose.xM.toFixed(2)}m, ${validRobotPose.yM.toFixed(2)}m · ${Math.round((validRobotPose.yawRad * 180) / Math.PI)}°)`
                : 'AMR: Chờ định vị AMCL'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  canvasContainer: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  rotatedMapImage: {
    position: 'absolute',
  },
  fullSize: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  ottoCadTint: {
    backgroundColor: 'rgba(14, 116, 144, 0.07)',
  },
  ottoDarkTint: {
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
  },
  gridBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#CDCDCD',
  },
  ottoAxisHud: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.28)',
  },
  ottoAxisTextCol: {
    justifyContent: 'center',
  },
  ottoAxisCoordText: {
    color: '#E2E8F0',
    fontSize: 8.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ottoLivePillWrap: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  ottoLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    borderWidth: 1.2,
    borderColor: '#10B981',
  },
  ottoLiveLockIcon: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ottoLivePillText: {
    color: '#F8FAFC',
    fontSize: 9,
    fontWeight: '700',
  },
  ottoFilterBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  ottoFilterBtnText: {
    color: '#E0F2FE',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(248, 250, 252, 0.82)',
  },
  loadingText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  warningBadge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 34,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(254, 243, 199, 0.95)',
  },
  warningText: {
    color: '#92400E',
    fontSize: 9.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  legendBar: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendLabel: {
    color: '#E2E8F0',
    fontSize: 9.5,
    fontWeight: '600',
  },
});
