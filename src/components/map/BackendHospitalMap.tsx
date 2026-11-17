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
  endpointName?: string | null;
  roomId?: string | null;
  roomCode?: string | null;
  roomName?: string | null;
  roomType?: string | null;
  departmentCode?: string | null;
  roomDescription?: string | null;
  roomPublicVisible?: boolean | null;
}

export interface PresentationSource {
  mapId?: string;
  assetHash?: string;
  widthM?: number;
  heightM?: number;
  resolutionMPerPixel?: number;
  originXM?: number;
  originYM?: number;
  originYawRad?: number;
  frameId?: string;
  widthPx?: number;
  heightPx?: number;
}

export interface PresentationDocument {
  schemaVersion?: number;
  backgroundColor?: string;
  rotationDegrees?: number;
  features: PresentationFeature[];
  source?: PresentationSource | null;
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
  onAutoAlignReady?: (align: SlamAutoAlignResult | null) => void;
  interactive?: boolean;
  skipImageFetch?: boolean;
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
  onAutoAlignReady,
  interactive = true,
  skipImageFetch = false,
}) => {
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [autoAlign, setAutoAlign] = useState<SlamAutoAlignResult | null>(null);
  const [filterMode, setFilterMode] = useState<MapFilterMode>('raw');

  const presDoc = useMemo<PresentationDocument | null>(() => {
    if (!presentation) return null;
    const rawAny = presentation as any;
    const doc = rawAny.document ?? presentation;
    if (!doc || !Array.isArray(doc.features) || doc.features.length === 0) return null;
    const src: PresentationSource | null = rawAny.source ?? doc.source ?? null;
    if (src?.mapId && map.mapId && src.mapId !== map.mapId) {
      return null;
    }
    return {
      ...doc,
      source: src,
    };
  }, [map.mapId, presentation]);

  const presSource = presDoc?.source ?? null;

  const presentationFeatures = useMemo(() => {
    if (!presDoc?.features) return [];
    return presDoc.features.filter(
      (f) => Array.isArray(f.points) && f.points.length > 0
    );
  }, [presDoc]);

  const hasPresentation = presentationFeatures.length > 0;

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
    // Nếu đã có sơ đồ vector /presentation hoặc đang chờ loadMapPackage thì không tải image.png thừa
    if (hasPresentation || skipImageFetch) {
      setIsLoadingImage(false);
      return;
    }

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
          onAutoAlignReady?.(aligned);
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
  }, [hasPresentation, imageUrl, map.mapId, skipImageFetch, token]);

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
        (hasPresentation ? presSource?.resolutionMPerPixel : undefined) ??
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
      (hasPresentation && presSource?.widthPx && presSource.widthPx > 0 ? presSource.widthPx : 0) ||
        (autoAlign?.width && autoAlign.width > 0 ? autoAlign.width : 0) ||
        (metaWidthPx > 0 ? metaWidthPx : 0) ||
        (naturalSize?.width && naturalSize.width > 0 ? naturalSize.width : 0) ||
        (Number(map.widthM) > 0 ? Number(map.widthM) / resolution : 1)
    );
    const pixelHeight = Math.max(
      1,
      (hasPresentation && presSource?.heightPx && presSource.heightPx > 0 ? presSource.heightPx : 0) ||
        (autoAlign?.height && autoAlign.height > 0 ? autoAlign.height : 0) ||
        (metaHeightPx > 0 ? metaHeightPx : 0) ||
        (naturalSize?.height && naturalSize.height > 0 ? naturalSize.height : 0) ||
        (Number(map.heightM) > 0 ? Number(map.heightM) / resolution : 1)
    );

    const origin = Array.isArray(metadata?.origin) ? metadata.origin : [];
    const originX =
      Number(
        (hasPresentation ? presSource?.originXM : undefined) ??
          metadata?.origin_x_m ??
          metadata?.originXM ??
          metadata?.originX ??
          origin[0] ??
          map.originXM
      ) || 0;
    const originY =
      Number(
        (hasPresentation ? presSource?.originYM : undefined) ??
          metadata?.origin_y_m ??
          metadata?.originYM ??
          metadata?.originY ??
          origin[1] ??
          map.originYM
      ) || 0;
    const originYaw =
      Number(
        (hasPresentation ? presSource?.originYawRad : undefined) ??
          metadata?.origin_yaw_rad ??
          metadata?.originYawRad ??
          metadata?.originYaw ??
          metadata?.yaw ??
          origin[2] ??
          map.originYawRad
      ) || 0;
    const cosO = Math.cos(originYaw);
    const sinO = Math.sin(originYaw);

    // Góc xoay chuẩn từ bản đồ /presentation/published hoặc căn chỉnh tường SLAM (-4.5°)
    const docRotation = presDoc?.rotationDegrees;
    const rotationDeg =
      hasPresentation && typeof docRotation === 'number' && Number.isFinite(docRotation)
        ? docRotation
        : autoAlign
        ? autoAlign.rotationDeg
        : -4.5;
    const rotationRad = (rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rotationRad);
    const sinR = Math.sin(rotationRad);

    const uvToRotatedCenter = (u: number, v: number) => {
      const relU = u - pixelWidth / 2;
      const relV = v - pixelHeight / 2;
      return {
        rx: cosR * relU - sinR * relV,
        ry: sinR * relU + cosR * relV,
        rawU: u,
        rawV: v,
      };
    };

    const worldToRotatedCenter = (point: MapPoint) => {
      const dx = point.x - originX;
      const dy = point.y - originY;
      const u = (cosO * dx + sinO * dy) / resolution;
      const v = pixelHeight - (-sinO * dx + cosO * dy) / resolution;
      return uvToRotatedCenter(u, v);
    };

    // Tọa độ trong presentation/published là mét tương đối từ góc gốc bản đồ (dx, dy)
    const presentationToRotatedCenter = (point: MapPoint) => {
      const u = point.x / resolution;
      const v = pixelHeight - point.y / resolution;
      return uvToRotatedCenter(u, v);
    };

    let xMin = hasPresentation ? Infinity : autoAlign ? autoAlign.xMin : -pixelWidth * 0.45;
    let xMax = hasPresentation ? -Infinity : autoAlign ? autoAlign.xMax : pixelWidth * 0.45;
    let yMin = hasPresentation ? Infinity : autoAlign ? autoAlign.yMin : -pixelHeight * 0.42;
    let yMax = hasPresentation ? -Infinity : autoAlign ? autoAlign.yMax : pixelHeight * 0.42;

    const expandRotated = (rx: number, ry: number, margin = 6) => {
      if (rx - margin < xMin) xMin = rx - margin;
      if (rx + margin > xMax) xMax = rx + margin;
      if (ry - margin < yMin) yMin = ry - margin;
      if (ry + margin > yMax) yMax = ry + margin;
    };

    if (hasPresentation) {
      presentationFeatures.forEach((feature) => {
        feature.points.forEach((p) => {
          const { rx, ry } = presentationToRotatedCenter(p);
          expandRotated(rx, ry, 3);
        });
      });
    }

    const expandWithPoint = (pt: MapPoint, margin = 3) => {
      const { rx, ry } = worldToRotatedCenter(pt);
      expandRotated(rx, ry, margin);
    };

    visibleEndpoints.forEach((ep) =>
      expandWithPoint({ x: Number(ep.xM), y: Number(ep.yM) }, 4)
    );
    visibleZones.forEach(({ points }) => points.forEach((p) => expandWithPoint(p, 3)));
    if (validRobotPose) {
      expandWithPoint({ x: validRobotPose.xM, y: validRobotPose.yM }, 5);
    }
    if (validPlannedPath) {
      validPlannedPath.forEach((pt) => expandWithPoint({ x: pt.xM, y: pt.yM }, 4));
    }

    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
      xMin = -pixelWidth * 0.45;
      xMax = pixelWidth * 0.45;
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -pixelHeight * 0.42;
      yMax = pixelHeight * 0.42;
    }

    // Khoảng đệm đối xứng gọn quanh bản đồ để hiển thị to, rõ và cân chính giữa
    const pad = 2;
    xMin -= pad;
    xMax += pad;
    yMin -= pad;
    yMax += pad;

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

    const presentationToViewPixel = (point: MapPoint) => {
      const { rx, ry, rawU, rawV } = presentationToRotatedCenter(point);
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
      presentationToViewPixel,
      toViewHeadingRad,
    };
  }, [
    autoAlign,
    hasPresentation,
    map,
    metadata,
    naturalSize,
    presDoc,
    presSource,
    presentationFeatures,
    validPlannedPath,
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

  const fittedBox = useMemo(() => {
    if (!viewportSize || viewportSize.width <= 8 || viewportSize.height <= 8) {
      return null;
    }
    const availW = viewportSize.width - 8;
    const availH = viewportSize.height - 8;
    const containerAspect = availW / availH;
    if (containerAspect > aspectRatio) {
      const h = availH;
      return { width: h * aspectRatio, height: h };
    }
    const w = availW;
    return { width: w, height: w / aspectRatio };
  }, [aspectRatio, viewportSize]);

  const imageWidthPct = (geometry.pixelWidth / viewWidth) * 100;
  const imageHeightPct = (geometry.pixelHeight / viewHeight) * 100;
  const imageLeftPct = ((-geometry.xMin - geometry.pixelWidth / 2) / viewWidth) * 100;
  const imageTopPct = ((-geometry.yMin - geometry.pixelHeight / 2) / viewHeight) * 100;

  const gridStepPx = Math.max(12, 1 / geometry.resolution);
  const mapBgColor =
    filterMode === 'otto_dark'
      ? '#1E242B'
      : hasPresentation
      ? presDoc?.backgroundColor || '#F8FAFC'
      : '#E5E7EB';

  return (
    <View
      style={[styles.outerWrapper, { backgroundColor: mapBgColor }]}
      pointerEvents={interactive ? 'auto' : 'none'}
    >
      {/* Banner chỉ dẫn điều hướng đặt gọn phía trên bản đồ để không che khuất phòng/tường */}
      {guidance && guidance.state !== 'IDLE' && (
        <NavigationGuidanceBanner
          guidance={guidance}
          onStop={interactive ? onStopEscort : undefined}
          isStopping={isStoppingEscort}
        />
      )}

      <View
        style={styles.canvasViewport}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setViewportSize((prev) =>
              prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
                ? prev
                : { width, height }
            );
          }
        }}
      >
        <View style={styles.canvasCenterLayer}>
          {fittedBox && (
            <View
              style={[
                styles.canvasContainer,
                { width: fittedBox.width, height: fittedBox.height, backgroundColor: mapBgColor },
              ]}
            >
              {!hasPresentation && <View style={styles.gridBackground} />}

        {!hasPresentation && !skipImageFetch && !imageFailed && (
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
                opacity: filterMode === 'otto_dark' ? 0.88 : 1,
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

        {!hasPresentation && filterMode !== 'raw' && (
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
          preserveAspectRatio="xMidYMid meet"
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

          {(hasPresentation || filterMode !== 'raw') && (
            <Rect
              x="0"
              y="0"
              width={viewWidth}
              height={viewHeight}
              fill="url(#ottoCadGrid)"
            />
          )}

          {/* Sơ đồ vector chuẩn kiến trúc từ GET /maps/{mapId}/presentation/published */}
          {hasPresentation &&
            presentationFeatures
              .slice()
              .sort((a, b) => {
                const order: Record<string, number> = {
                  CORRIDOR: 0,
                  ROOM: 1,
                  WALL: 2,
                  DOOR: 3,
                  LANDMARK: 4,
                  LABEL: 5,
                };
                return (order[a.type] ?? 9) - (order[b.type] ?? 9);
              })
              .map((feature, idx) => {
                const pixelPoints = feature.points.map(geometry.presentationToViewPixel);
                if (pixelPoints.length === 0) return null;
                const pointsStr = pixelPoints.map((p) => `${p.x},${p.y}`).join(' ');
                const strokePx = Math.max(
                  1.2,
                  (Number(feature.lineWidthM) || 0.04) / geometry.resolution
                );
                const fontPx = Math.max(
                  4.5,
                  Math.min(11, (Number(feature.fontSizeM) || 0.11) / geometry.resolution)
                );
                const featureColor = feature.color || '#334155';
                const isDark = filterMode === 'otto_dark';

                if (feature.type === 'ROOM' || feature.type === 'CORRIDOR') {
                  const centerX =
                    pixelPoints.reduce((s, p) => s + p.x, 0) / pixelPoints.length;
                  const centerY =
                    pixelPoints.reduce((s, p) => s + p.y, 0) / pixelPoints.length;

                  const matchEp =
                    feature.type === 'ROOM'
                      ? visibleEndpoints.find((e) => {
                          if (feature.endpointId && e.endpointId === feature.endpointId) {
                            return true;
                          }
                          const epCode = (e.endpointCode || '').trim().toLowerCase();
                          const rCode = (feature.roomCode || '').trim().toLowerCase();
                          const rLabel = (feature.label || feature.roomName || '')
                            .trim()
                            .toLowerCase();
                          if (rCode && epCode === rCode) return true;
                          if (rLabel && epCode === rLabel) return true;
                          if (
                            rLabel &&
                            (e.endpointName || '').toLowerCase().includes(rLabel)
                          ) {
                            return true;
                          }
                          return false;
                        })
                      : undefined;

                  const isSelected = Boolean(
                    selectedEndpointId &&
                      ((feature.endpointId && selectedEndpointId === feature.endpointId) ||
                        (matchEp &&
                          (selectedEndpointId === matchEp.endpointId ||
                            selectedEndpointId.toLowerCase() ===
                              (matchEp.endpointCode || '').toLowerCase())) ||
                        (feature.roomCode &&
                          selectedEndpointId.toLowerCase() ===
                            feature.roomCode.toLowerCase()) ||
                        (feature.label &&
                          selectedEndpointId.toLowerCase() ===
                            feature.label.toLowerCase()))
                  );

                  const labelText = feature.label || feature.roomName || '';
                  const minRoomX = Math.min(...pixelPoints.map((p) => p.x));
                  const maxRoomX = Math.max(...pixelPoints.map((p) => p.x));
                  const roomBoxW = Math.max(12, maxRoomX - minRoomX);
                  const roomFontPx = labelText
                    ? Math.min(
                        fontPx,
                        Math.max(3.6, (roomBoxW * 0.88) / Math.max(3, labelText.length * 0.56))
                      )
                    : fontPx;
                  const fillColor =
                    feature.type === 'CORRIDOR'
                      ? isDark
                        ? 'rgba(148, 163, 184, 0.16)'
                        : 'rgba(226, 232, 240, 0.55)'
                      : `${featureColor}${isDark ? '38' : isSelected ? '48' : '26'}`;

                  return (
                    <G
                      key={feature.id || `pres-room-${idx}`}
                      onPress={
                        interactive && matchEp && onSelectEndpoint
                          ? () => onSelectEndpoint(matchEp)
                          : undefined
                      }
                    >
                      {pixelPoints.length >= 3 ? (
                        <Polygon
                          points={pointsStr}
                          fill={fillColor}
                          stroke={featureColor}
                          strokeWidth={
                            isSelected
                              ? Math.max(2.0, strokePx)
                              : Math.max(0.9, strokePx * 0.75)
                          }
                          strokeLinejoin="round"
                        />
                      ) : (
                        <Polyline
                          points={pointsStr}
                          fill="none"
                          stroke={featureColor}
                          strokeWidth={strokePx}
                          strokeLinecap="round"
                        />
                      )}
                      {labelText ? (
                        <G pointerEvents="none">
                          <SvgText
                            x={centerX}
                            y={centerY + roomFontPx * 0.35}
                            textAnchor="middle"
                            fontSize={roomFontPx}
                            fontWeight="700"
                            fill="none"
                            stroke={
                              isDark
                                ? 'rgba(15, 23, 42, 0.9)'
                                : 'rgba(255, 255, 255, 0.92)'
                            }
                            strokeWidth={1.6}
                            strokeLinejoin="round"
                          >
                            {labelText}
                          </SvgText>
                          <SvgText
                            x={centerX}
                            y={centerY + roomFontPx * 0.35}
                            textAnchor="middle"
                            fontSize={roomFontPx}
                            fontWeight="700"
                            fill={isDark ? '#F8FAFC' : '#0F172A'}
                          >
                            {labelText}
                          </SvgText>
                        </G>
                      ) : null}
                    </G>
                  );
                }

                if (feature.type === 'WALL' || feature.type === 'DOOR') {
                  return (
                    <Polyline
                      key={feature.id || `pres-wall-${idx}`}
                      points={pointsStr}
                      fill="none"
                      stroke={
                        isDark && featureColor === '#334155' ? '#CBD5E1' : featureColor
                      }
                      strokeWidth={feature.type === 'DOOR' ? strokePx * 1.15 : strokePx}
                      strokeDasharray={feature.type === 'DOOR' ? '3,2' : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                }

                const pt0 = pixelPoints[0];
                if (!pt0) return null;
                const pointLabel = feature.label || feature.endpointName || '';
                return (
                  <G key={feature.id || `pres-pt-${idx}`}>
                    {feature.type === 'LANDMARK' && (
                      <Circle cx={pt0.x} cy={pt0.y} r={2.5} fill={featureColor} />
                    )}
                    {pointLabel ? (
                      <SvgText
                        x={pt0.x}
                        y={pt0.y - 3.5}
                        fontSize={fontPx}
                        fontWeight="600"
                        fill={isDark ? '#E2E8F0' : featureColor}
                        textAnchor="middle"
                      >
                        {pointLabel}
                      </SvgText>
                    ) : null}
                  </G>
                );
              })}

          {/* 1. Các phân khu Traffic Control (Zones) chuẩn map-navigation.js */}
          {visibleZones.map(({ zone, points }) => {
            const pixelPoints = points.map(geometry.toViewPixel);
            const pointsText = pixelPoints.map((point) => `${point.x},${point.y}`).join(' ');
            const firstPt = pixelPoints[0];
            const zoneEndpoint = visibleEndpoints.find(
              (endpoint) => endpoint.zoneId === zone.zoneId
            );
            const isKeepOut = zone.zoneType === 'KEEP_OUT';
            const fillStyle =
              !hasPresentation && filterMode === 'raw'
                ? isKeepOut
                  ? 'rgba(210, 30, 30, 0.22)'
                  : 'rgba(240, 170, 0, 0.23)'
                : isKeepOut
                ? 'url(#ottoHazardStripe)'
                : 'url(#ottoSpeedPattern)';
            const strokeColor =
              !hasPresentation && filterMode === 'raw'
                ? isKeepOut
                  ? '#C22222'
                  : '#AA7400'
                : isKeepOut
                ? '#EF4444'
                : '#0284C7';
            const speedVal = zone.speedLimitMps ?? (zone as any).maxLinearSpeedMps;
            const speedSuffix =
              zone.zoneType === 'SPEED' && speedVal
                ? ` (${speedVal} m/s)`
                : '';
            const zoneLabel = `${(zone.zoneName || zone.zoneCode || '').trim()}${speedSuffix}`;
            const zoneFontSize = Math.max(3.6, viewWidth / 44);

            return (
              <G
                key={zone.zoneId || zone.zoneCode}
                onPress={
                  interactive && zoneEndpoint && onSelectEndpoint
                    ? () => onSelectEndpoint(zoneEndpoint)
                    : undefined
                }
              >
                <Polygon
                  points={pointsText}
                  fill={fillStyle}
                  stroke={strokeColor}
                  strokeWidth={Math.max(0.9, viewWidth / 160)}
                  strokeLinejoin="round"
                />
                {firstPt && zoneLabel ? (
                  <G pointerEvents="none">
                    <SvgText
                      x={firstPt.x + 2}
                      y={firstPt.y - 2}
                      fontSize={zoneFontSize}
                      fontWeight="700"
                      fill="#FFFFFF"
                      stroke="#FFFFFF"
                      strokeWidth={Math.max(1.6, viewWidth / 110)}
                      strokeLinejoin="round"
                    >
                      {zoneLabel}
                    </SvgText>
                    <SvgText
                      x={firstPt.x + 2}
                      y={firstPt.y - 2}
                      fontSize={zoneFontSize}
                      fontWeight="700"
                      fill="#1F2430"
                    >
                      {zoneLabel}
                    </SvgText>
                  </G>
                ) : null}
              </G>
            );
          })}

          {/* 2. Đường dẫn Nav2 (Casing trắng + Đoạn đã đi #A9BFD8 + Đoạn sắp đi #1877ED + Điểm đích Đỏ + Nút rẽ) */}
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

            const fullPoly = validPlannedPath
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

            const destEndpoint = lastPt
              ? visibleEndpoints.find(
                  (ep) =>
                    Math.hypot(Number(ep.xM) - lastPt.xM, Number(ep.yM) - lastPt.yM) <= 0.12
                )
              : undefined;
            const destLabel = (
              destEndpoint?.endpointName ||
              destEndpoint?.endpointCode ||
              ''
            ).trim();
            const destFontSize = Math.max(3.8, viewWidth / 44);
            const destPinRadius = Math.max(3.0, viewWidth / 48);

            // Điểm rẽ tiếp theo (turn indicator badge trên bản đồ)
            const turnPixel =
              guidance?.state === 'TRACKING' &&
              guidance.turn &&
              guidance.direction !== 'STRAIGHT'
                ? geometry.toViewPixel({ x: guidance.turn.xM, y: guidance.turn.yM })
                : null;
            const turnBadgeRadius = Math.max(4.8, viewWidth / 30);

            return (
              <G>
                {/* 2a. Viền trắng bao ngoài toàn tuyến và phần đường đã đi qua (#A9BFD8) */}
                <Polyline
                  points={fullPoly}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={Math.max(4.0, viewWidth / 34)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {completedPoints.length >= 2 && (
                  <Polyline
                    points={fullPoly}
                    fill="none"
                    stroke="#A9BFD8"
                    strokeWidth={Math.max(2.4, viewWidth / 52)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* 2b. Đoạn sắp đi: Viền trắng + Đường nét chính màu xanh đậm (#1877ED) */}
                <Polyline
                  points={upcomingPoly}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={Math.max(4.2, viewWidth / 32)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Polyline
                  points={upcomingPoly}
                  fill="none"
                  stroke="#1877ED"
                  strokeWidth={Math.max(2.6, viewWidth / 48)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* 2c. Điểm ghim đích nổi bật (Destination Pin: Đỏ #D94B3D viền trắng + nhãn tên điểm đến) */}
                {endPixel && (
                  <G>
                    <Circle
                      cx={endPixel.x}
                      cy={endPixel.y}
                      r={destPinRadius}
                      fill="#D94B3D"
                      stroke="#FFFFFF"
                      strokeWidth={Math.max(1.2, viewWidth / 115)}
                    />
                    {destLabel ? (
                      <G pointerEvents="none">
                        <SvgText
                          x={endPixel.x}
                          y={endPixel.y - destPinRadius - 2.5}
                          textAnchor="middle"
                          fontSize={destFontSize}
                          fontWeight="800"
                          fill="#FFFFFF"
                          stroke="#FFFFFF"
                          strokeWidth={Math.max(1.8, viewWidth / 90)}
                          strokeLinejoin="round"
                        >
                          {destLabel}
                        </SvgText>
                        <SvgText
                          x={endPixel.x}
                          y={endPixel.y - destPinRadius - 2.5}
                          textAnchor="middle"
                          fontSize={destFontSize}
                          fontWeight="800"
                          fill="#172C43"
                        >
                          {destLabel}
                        </SvgText>
                      </G>
                    ) : null}
                  </G>
                )}

                {/* 2d. Dấu rẽ ở ngã rẽ tiếp theo (Turn Badge #075DC4) */}
                {turnPixel && (
                  <G>
                    <Circle
                      cx={turnPixel.x}
                      cy={turnPixel.y}
                      r={turnBadgeRadius}
                      fill="#075DC4"
                      stroke="#FFFFFF"
                      strokeWidth={Math.max(1.3, viewWidth / 110)}
                    />
                    <SvgText
                      x={turnPixel.x}
                      y={turnPixel.y + turnBadgeRadius * 0.38}
                      fill="#FFFFFF"
                      fontSize={turnBadgeRadius * 1.25}
                      fontWeight="900"
                      textAnchor="middle"
                    >
                      {guidanceSymbol(guidance?.direction)}
                    </SvgText>
                  </G>
                )}
              </G>
            );
          })()}

          {/* 3. Vị trí và Hướng của Robot AMR phong cách OTTO Motors (thân trắng, nắp khoang tối, dải LED cyan định hướng) */}
          {validRobotPose && (() => {
            const robotPt = geometry.toViewPixel({
              x: validRobotPose.xM,
              y: validRobotPose.yM,
            });
            const angleDeg = (geometry.toViewHeadingRad(validRobotPose.yawRad) * 180) / Math.PI;
            const s = Math.max(5.5, viewWidth / 28);
            const bodyL = s * 2.15;
            const bodyW = s * 1.48;
            const cornerR = bodyW * 0.28;
            const ledColor = isPoseLive ? '#06B6D4' : '#94A3B8';
            const ledBright = isPoseLive ? '#22D3EE' : '#CBD5E1';
            const auraFill = isPoseLive ? 'rgba(6, 182, 212, 0.14)' : 'rgba(148, 163, 184, 0.12)';
            const auraStroke = isPoseLive
              ? 'rgba(6, 182, 212, 0.42)'
              : 'rgba(148, 163, 184, 0.28)';
            const wedgeFill = isPoseLive
              ? 'rgba(34, 211, 238, 0.24)'
              : 'rgba(148, 163, 184, 0.14)';
            const sideStripH = Math.max(0.8, s * 0.11);

            return (
              <G
                pointerEvents="none"
                testID="robot-position-marker"
                transform={`translate(${robotPt.x}, ${robotPt.y}) rotate(${angleDeg})`}
              >
                {/* Vòng hào quang telemetry xung quanh robot */}
                <Circle
                  cx={0}
                  cy={0}
                  r={bodyL * 0.85}
                  fill={auraFill}
                  stroke={auraStroke}
                  strokeWidth={Math.max(0.6, s * 0.08)}
                />
                {/* Vùng quét cảm biến LiDAR phía trước (+x) */}
                <Polygon
                  points={`${bodyL * 0.42},0 ${bodyL * 1.18},${-bodyW * 0.68} ${bodyL * 1.18},${bodyW * 0.68}`}
                  fill={wedgeFill}
                />
                {/* Bóng đổ khung xe AMR */}
                <Rect
                  x={-bodyL / 2 + s * 0.06}
                  y={-bodyW / 2 + s * 0.1}
                  width={bodyL}
                  height={bodyW}
                  rx={cornerR}
                  ry={cornerR}
                  fill="rgba(15, 23, 42, 0.22)"
                />
                {/* Thân xe OTTO trắng bo góc */}
                <Rect
                  x={-bodyL / 2}
                  y={-bodyW / 2}
                  width={bodyL}
                  height={bodyW}
                  rx={cornerR}
                  ry={cornerR}
                  fill="#FFFFFF"
                  stroke="#0F172A"
                  strokeWidth={Math.max(0.95, s * 0.12)}
                />
                {/* Dải LED Cyan mặt trước (mũi xe +x) */}
                <Rect
                  x={bodyL * 0.31}
                  y={-bodyW * 0.43}
                  width={bodyL * 0.17}
                  height={bodyW * 0.86}
                  rx={cornerR * 0.45}
                  ry={cornerR * 0.45}
                  fill={ledColor}
                />
                <Rect
                  x={bodyL * 0.36}
                  y={-bodyW * 0.33}
                  width={bodyL * 0.09}
                  height={bodyW * 0.66}
                  rx={cornerR * 0.3}
                  ry={cornerR * 0.3}
                  fill={ledBright}
                />
                {/* Dải LED sườn xe 2 bên */}
                <Rect
                  x={-bodyL * 0.24}
                  y={-bodyW * 0.48}
                  width={bodyL * 0.44}
                  height={sideStripH}
                  rx={sideStripH / 2}
                  fill={ledColor}
                />
                <Rect
                  x={-bodyL * 0.24}
                  y={bodyW * 0.48 - sideStripH}
                  width={bodyL * 0.44}
                  height={sideStripH}
                  rx={sideStripH / 2}
                  fill={ledColor}
                />
                {/* Nắp khoang màu tối ở giữa thân */}
                <Rect
                  x={-bodyL * 0.34}
                  y={-bodyW * 0.32}
                  width={bodyL * 0.56}
                  height={bodyW * 0.64}
                  rx={cornerR * 0.45}
                  ry={cornerR * 0.45}
                  fill="#1E293B"
                  stroke="#334155"
                  strokeWidth={Math.max(0.5, s * 0.06)}
                />
                {/* Mũi tên định hướng tiến phía trước trên nắp khoang */}
                <Polygon
                  points={`${bodyL * 0.12},0 ${-bodyL * 0.06},${-bodyW * 0.17} ${-bodyL * 0.01},0 ${-bodyL * 0.06},${bodyW * 0.17}`}
                  fill={ledBright}
                />
                {/* Cụm LiDAR đầu xe */}
                <Circle
                  cx={bodyL * 0.22}
                  cy={0}
                  r={Math.max(1.0, s * 0.14)}
                  fill="#0F172A"
                  stroke={ledBright}
                  strokeWidth={Math.max(0.55, s * 0.07)}
                />
                {/* Đèn đuôi phân biệt mặt sau (-x) */}
                <Rect
                  x={-bodyL * 0.46}
                  y={-bodyW * 0.24}
                  width={Math.max(0.8, s * 0.09)}
                  height={bodyW * 0.48}
                  rx={0.4}
                  fill="#64748B"
                />
              </G>
            );
          })()}
        </Svg>

        {!hasPresentation && isLoadingImage && !naturalSize && !autoAlign && !imageFailed && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.loadingText}>Đang tải & căn chỉnh bản đồ SLAM...</Text>
          </View>
        )}

        {!hasPresentation && imageFailed && (
          <View style={styles.warningBadge} pointerEvents="none">
            <Text style={styles.warningText}>
              Đang hiển thị bản đồ từ dữ liệu tọa độ SLAM
            </Text>
          </View>
        )}
            </View>
          )}
        </View>
      </View>

      {/* Thanh chú thích chuẩn giao diện bản đồ chỉ đường */}
      <View style={styles.legendBar}>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#06B6D4' }]} />
            <Text style={styles.legendLabel}>Robot AMR</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#D94B3D' }]} />
            <Text style={styles.legendLabel}>Điểm đến</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#1877ED' }]} />
            <Text style={styles.legendLabel}>Đường chỉ đường</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    overflow: 'hidden',
  },
  canvasViewport: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  canvasCenterLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasContainer: {
    position: 'relative',
    overflow: 'hidden',
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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: '#E4E4E7',
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
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendLabel: {
    color: '#606068',
    fontSize: 10.5,
    fontWeight: '600',
  },
});
