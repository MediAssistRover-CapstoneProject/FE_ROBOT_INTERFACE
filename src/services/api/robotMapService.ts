import {
  MapResponse,
  ZoneDto,
  EndpointResponse,
  MapRobotPose,
  MapPlanPoint,
} from '../../components/map/BackendHospitalMap';
import { NavigationGuidanceResult } from '../../features/navigation/navigationGuidance';
import { DEFAULT_ROBOT_CODE, generateUuid } from './config';
import { parseDeviceJwtClaims } from './client';
import { robotApiService } from './robotApiService';
import defaultPresentationData from './defaultPresentationMap.json';

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

export interface PresentationPublishedResponse {
  source?: PresentationSource | null;
  revision?: number;
  document?: PresentationDocument | null;
  publishedAt?: string;
}

const rawDefaultPresentation =
  (defaultPresentationData as any).published ||
  (defaultPresentationData as any).draft ||
  defaultPresentationData;

export const DEFAULT_PRESENTATION_DOC: PresentationDocument = {
  ...(rawDefaultPresentation as PresentationDocument),
  source: (defaultPresentationData as any).source ?? null,
};

export const REMOTE_API_BASE = 'https://mediassistrover.duckdns.org/api/v1';

// Cấu hình chuẩn của map bệnh viện ('map mới nhất' - bdf6503a-d38e-4bde-9a67-763e91668593)
export const DEFAULT_HOSPITAL_MAP: MapResponse = {
  mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
  floorId: '9584bf02-e008-11f1-8dbe-06ffc22cc223',
  mapCode: 'MAP_4e42fdd9259247879813b0e0ae05091a',
  versionNo: 1,
  mapName: 'map mới nhất',
  widthM: 3.85,
  heightM: 4.225,
  resolutionMPerPixel: 0.025,
  originXM: -0.513023376450729,
  originYM: -0.6450063744738561,
  originYawRad: 0,
};

export const DEFAULT_MAP_METADATA = {
  width_px: 154,
  height_px: 169,
  resolution_m_per_pixel: 0.02500000037252903,
  width_m: 3.8500000573694706,
  height_m: 4.225000062957406,
  origin_x_m: -0.513023376450729,
  origin_y_m: -0.6450063744738561,
  origin_yaw_rad: 0,
  frame_id: 'map',
  map_id: 'bdf6503a-d38e-4bde-9a67-763e91668593',
  image_url:
    'https://mediassistrover-media-2026-179897609252.s3.ap-southeast-1.amazonaws.com/images/maps/bdf6503a-d38e-4bde-9a67-763e91668593.png',
};

// 2 Vùng phân khu giao thông thực tế trên map bệnh viện: Vùng giảm tốc (SPEED) và Vùng cấm (KEEP_OUT)
export const DEFAULT_HOSPITAL_ZONES: ZoneDto[] = [
  {
    zoneId: '51b5a5d3-44e0-4283-b4d7-6723edd4f47e',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    zoneCode: 'ZONE_001',
    zoneName: 'giảm tốc',
    zoneType: 'SPEED',
    speedLimitMps: 0.1,
    active: true,
    polygonJson: {
      points: [
        [0.349477, 0.542494],
        [0.299477, -0.007506],
        [1.499477, -0.082506],
        [1.499477, 0.292494],
        [0.824477, 0.467494],
        [0.824477, 0.867494],
        [0.299477, 1.017494],
      ],
    },
  },
  {
    zoneId: '0d9a837b-9f49-4a56-a4f6-d28fcadf3820',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    zoneCode: 'ZONE_002',
    zoneName: 'cấm',
    zoneType: 'KEEP_OUT',
    active: true,
    polygonJson: {
      points: [
        [2.649477, 3.267494],
        [2.674477, 2.667494],
        [3.174477, 2.692494],
        [3.224477, 3.142494],
      ],
    },
  },
];

// 11 Điểm đến (Endpoints) thực tế đã hiệu chuẩn trên map bệnh viện ('map mới nhất')
export const DEFAULT_HOSPITAL_ENDPOINTS: EndpointResponse[] = [
  {
    endpointId: 'cb9cf2d2-e7aa-4c17-9f02-8de24503cdc6',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'Letan',
    endpointName: 'lễ tân',
    endpointType: 'WAYPOINT',
    xM: 0.6245,
    yM: 3.1425,
    yawRad: 2.982299,
    active: true,
  },
  {
    endpointId: 'de5a11cc-6c26-41b7-b21b-ce5eca33ee9a',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'phong01',
    endpointName: 'Phòng 01',
    endpointType: 'WAYPOINT',
    xM: 0.5745,
    yM: 2.2425,
    yawRad: 3.01691,
    active: true,
  },
  {
    endpointId: '045a65ee-6658-45c6-89d8-6d26dd230679',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'phong02',
    endpointName: 'Phòng 02',
    endpointType: 'WAYPOINT',
    xM: 0.4495,
    yM: 1.1925,
    yawRad: 3.045026,
    active: true,
  },
  {
    endpointId: '390ca660-06a4-4945-b70f-d06d337ad0be',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'phong03',
    endpointName: 'Phòng 03',
    endpointType: 'WAYPOINT',
    xM: 0.4495,
    yM: 0.7925,
    yawRad: 3.141593,
    active: true,
  },
  {
    endpointId: '5c1fd2e2-7573-4054-bda7-464eb297d567',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'capcuu',
    endpointName: 'Phòng cấp cứu',
    endpointType: 'WAYPOINT',
    xM: 0.5245,
    yM: 0.1925,
    yawRad: -2.391101,
    active: true,
  },
  {
    endpointId: '0b4ad195-a8c6-4f97-9be7-b00a073b789f',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'Nhikhoa',
    endpointName: 'Phòng nhi khoa',
    endpointType: 'WAYPOINT',
    xM: 1.2245,
    yM: 1.7925,
    yawRad: 1.385751,
    active: true,
  },
  {
    endpointId: '99a00b7c-23fc-41ac-ad92-40a05e026ec7',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'quaythuoc',
    endpointName: 'Quầy Thuốc',
    endpointType: 'WAYPOINT',
    xM: 1.5745,
    yM: 1.3175,
    yawRad: -1.703421,
    active: true,
  },
  {
    endpointId: '75f1ea74-744f-45e1-bf16-cc1b9c95cb20',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'PHONGXETNGHIEM',
    endpointName: 'phòng xét nghiệm',
    endpointType: 'WAYPOINT',
    xM: 2.2245,
    yM: 1.3925,
    yawRad: -0.05593,
    active: true,
  },
  {
    endpointId: '0921e125-37fa-4437-a6c3-51cf34eadcaf',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'PHONGCHANTHUONG',
    endpointName: 'phòng chấn thương chỉnh hình',
    endpointType: 'WAYPOINT',
    xM: 2.1995,
    yM: 0.3925,
    yawRad: -0.221002,
    active: true,
  },
  {
    endpointId: '53890882-a955-4c76-8ff8-c58405b231ea',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'PHONG SOS',
    endpointName: 'phòng sos',
    endpointType: 'WAYPOINT',
    xM: 2.3495,
    yM: 2.0925,
    yawRad: -0.050969,
    active: true,
  },
  {
    endpointId: '7aad633d-a0b9-4d08-80e7-9a8a5a4a1c79',
    mapId: 'bdf6503a-d38e-4bde-9a67-763e91668593',
    endpointCode: 'Vesinh',
    endpointName: 'nhà vệ sinh',
    endpointType: 'WAYPOINT',
    xM: 2.1745,
    yM: -0.3325,
    yawRad: 0.05236,
    active: true,
  },
];

const VIEWER_LOGIN_COOLDOWN_MS = 20_000;
const ROBOT_LOOKUP_COOLDOWN_MS = 30_000;

let cachedViewerToken: string | null = null;
let tokenExpiresAt = 0;
let viewerTokenPromise: Promise<string | null> | null = null;
let viewerLoginCooldownUntil = 0;
let cachedActiveRobotId: string = '0e3f1083-2546-4f45-8004-5eda5cb75a6f';
let hasResolvedRobotId = false;
let robotLookupCooldownUntil = 0;

export interface RobotSnapshotSummary {
  pose: MapRobotPose | null;
  isPoseLive: boolean;
  status: string;
  batteryRaw: number;
  mqttConnected: boolean;
  navigationPlan: MapPlanPoint[] | null;
  planEndpointId?: string | null;
  planEndpointName?: string | null;
  backendGuidance?: NavigationGuidanceResult | null;
  sessionMapId?: string | null;
  sessionId?: string | null;
  sessionState?: string | null;
  activeJobId?: string | null;
  dispatchReady?: boolean;
  snapshotReachable?: boolean;
}

function buildSnapshotSummary(snapshot: any, guidData: any): RobotSnapshotSummary {
  const p = snapshot?.latestPose;
  const pose: MapRobotPose | null =
    p && Number.isFinite(Number(p.xM)) && Number.isFinite(Number(p.yM))
      ? {
          xM: Number(p.xM),
          yM: Number(p.yM),
          yawRad: Number(p.yawRad) || 0,
          fresh: Boolean(p.fresh),
          mapId: p.mapId,
        }
      : null;

  const rawPlan = guidData?.plan || snapshot?.navigationPlan;
  let navigationPlan: MapPlanPoint[] | null = null;
  const rawPoints = rawPlan?.points;
  if (Array.isArray(rawPoints) && rawPoints.length >= 2) {
    navigationPlan = rawPoints
      .map((pt: any) => ({
        xM: Number(pt?.xM ?? pt?.x_m ?? pt?.x),
        yM: Number(pt?.yM ?? pt?.y_m ?? pt?.y),
      }))
      .filter((pt) => Number.isFinite(pt.xM) && Number.isFinite(pt.yM));
  }

  let backendGuidance: NavigationGuidanceResult | null = null;
  if (
    guidData &&
    ['TRACKING', 'WAITING_FOR_POSE', 'ARRIVED'].includes(guidData.state) &&
    navigationPlan &&
    navigationPlan.length >= 2
  ) {
    const epName = rawPlan?.endpointName || 'Điểm đến';
    const remCm =
      typeof guidData.remainingCm === 'number' ? Math.round(guidData.remainingCm) : undefined;
    backendGuidance = {
      state: guidData.state,
      direction: guidData.direction,
      distanceCm:
        typeof guidData.distanceCm === 'number' ? Math.round(guidData.distanceCm) : remCm,
      remainingCm: remCm,
      turn:
        guidData.turn &&
        Number.isFinite(Number(guidData.turn.xM)) &&
        Number.isFinite(Number(guidData.turn.yM))
          ? { xM: Number(guidData.turn.xM), yM: Number(guidData.turn.yM) }
          : undefined,
      projection:
        guidData.projection &&
        Number.isFinite(Number(guidData.projection.xM)) &&
        Number.isFinite(Number(guidData.projection.yM))
          ? { xM: Number(guidData.projection.xM), yM: Number(guidData.projection.yM) }
          : undefined,
      segmentIndex:
        typeof guidData.segmentIndex === 'number' ? guidData.segmentIndex : undefined,
      primaryText: guidData.text || 'Đang chờ vị trí robot',
      secondaryText:
        guidData.state === 'TRACKING' && typeof remCm === 'number'
          ? `${epName} · Còn ${remCm} cm`
          : epName,
      observedAt: guidData.observedAt,
    };
  }

  return {
    pose,
    isPoseLive: Boolean(
      snapshot?.mqttConnected && snapshot?.heartbeatFresh && p?.fresh !== false
    ),
    status: snapshot?.robot?.status || 'IDLE',
    batteryRaw: snapshot?.robot?.batteryRaw || 7850,
    mqttConnected: Boolean(snapshot?.mqttConnected),
    navigationPlan:
      navigationPlan && navigationPlan.length >= 2 ? navigationPlan : null,
    planEndpointId: rawPlan?.endpointId || null,
    planEndpointName: rawPlan?.endpointName || null,
    backendGuidance,
    sessionMapId: snapshot?.navigationSession?.mapId || null,
    sessionId: snapshot?.navigationSession?.sessionId || null,
    sessionState: snapshot?.navigationSession?.state || null,
    activeJobId: snapshot?.activeJobId || null,
    dispatchReady: Boolean(snapshot?.dispatchReady),
    snapshotReachable: true,
  };
}

export const POLL_INTERVAL_ACTIVE_MS = 2_500;
export const POLL_INTERVAL_IDLE_MS = 8_000;
export const POLL_INTERVAL_OFFLINE_MS = 10_000;

/**
 * Chu kỳ poll thích ứng theo trạng thái hoạt động của robot:
 * - 2.5s khi robot đang chạy / có job / có lộ trình
 * - 8s khi IDLE không có job
 * - 10s khi mất kết nối tạm thời
 */
export function getAdaptivePollDelayMs(summary: RobotSnapshotSummary | null | undefined): number {
  if (!summary || summary.snapshotReachable === false) {
    return POLL_INTERVAL_OFFLINE_MS;
  }
  const hasPlan = Boolean(summary.navigationPlan && summary.navigationPlan.length >= 2);
  const isActive = Boolean(summary.activeJobId || hasPlan || summary.status !== 'IDLE');
  return isActive ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
}

class RobotMapService {
  /**
   * Xóa cache phiên viewer (phục vụ kiểm thử hoặc làm mới kết nối)
   */
  public resetViewerCache() {
    cachedViewerToken = null;
    tokenExpiresAt = 0;
    viewerTokenPromise = null;
    viewerLoginCooldownUntil = 0;
    hasResolvedRobotId = false;
    robotLookupCooldownUntil = 0;
  }

  /**
   * Lấy token đọc dữ liệu hệ thống (viewer/admin) với single-flight dedup và backoff khi lỗi
   */
  public async getViewerToken(): Promise<string | null> {
    const now = Date.now();
    if (cachedViewerToken && tokenExpiresAt > now + 60_000) {
      return cachedViewerToken;
    }

    if (now < viewerLoginCooldownUntil) {
      return cachedViewerToken;
    }

    if (viewerTokenPromise) {
      return viewerTokenPromise;
    }

    viewerTokenPromise = (async () => {
      try {
        const res = await fetch(`${REMOTE_API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'admin',
            password: '1234567891011',
            deviceInfo: 'RobotScreen-LiveMonitor',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.accessToken) {
            const claims = parseDeviceJwtClaims(String(data.accessToken));
            const expMs =
              typeof claims?.exp === 'number'
                ? claims.exp * 1000
                : Date.now() + 3600 * 1000;
            cachedViewerToken = String(data.accessToken);
            tokenExpiresAt = expMs;
            viewerLoginCooldownUntil = 0;
            return cachedViewerToken;
          }
        }
        viewerLoginCooldownUntil = Date.now() + VIEWER_LOGIN_COOLDOWN_MS;
      } catch {
        viewerLoginCooldownUntil = Date.now() + VIEWER_LOGIN_COOLDOWN_MS;
      } finally {
        viewerTokenPromise = null;
      }
      return cachedViewerToken;
    })();

    return viewerTokenPromise;
  }

  /**
   * Tải toàn bộ cấu hình Map, Zones, Endpoints từ Backend
   */
  public async loadMapPackage(preferredMapId?: string) {
    const token = await this.getViewerToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    let activeMap: MapResponse = DEFAULT_HOSPITAL_MAP;
    let metadata: Record<string, any> = DEFAULT_MAP_METADATA;
    let zones: ZoneDto[] = DEFAULT_HOSPITAL_ZONES;
    let endpoints: EndpointResponse[] = DEFAULT_HOSPITAL_ENDPOINTS;
    let presentation: PresentationDocument | null = null;
    let availableMaps: MapResponse[] = [DEFAULT_HOSPITAL_MAP];

    // 1. Lấy song song danh sách maps, endpoints, zones và snapshot hiện tại từ backend
    let mapsList: MapResponse[] = [];
    let allEndpoints: EndpointResponse[] = [];
    let allZones: ZoneDto[] = [];
    let liveSessionMapId: string | null = null;
    let initialSnapshot: RobotSnapshotSummary | null = null;

    try {
      const [mapsRes, epRes, zonesRes, snapRes] = await Promise.all([
        fetch(`${REMOTE_API_BASE}/maps?page=0&size=50`, { headers }).catch(() => null),
        fetch(`${REMOTE_API_BASE}/endpoints?page=0&size=100`, { headers }).catch(() => null),
        fetch(`${REMOTE_API_BASE}/zones?page=0&size=100`, { headers }).catch(() => null),
        fetch(`${REMOTE_API_BASE}/robots/${cachedActiveRobotId}/snapshot`, { headers }).catch(
          () => null
        ),
      ]);

      if (mapsRes?.ok) {
        const mapsData = await mapsRes.json();
        if (Array.isArray(mapsData?.content)) {
          mapsList = mapsData.content;
        }
      }

      if (epRes?.ok) {
        const epData = await epRes.json();
        if (Array.isArray(epData?.content)) {
          allEndpoints = epData.content.filter(
            (e: any) =>
              e.active !== false &&
              Number.isFinite(Number(e.xM)) &&
              Number.isFinite(Number(e.yM))
          );
        }
      }

      if (zonesRes?.ok) {
        const zonesData = await zonesRes.json();
        if (Array.isArray(zonesData?.content)) {
          allZones = zonesData.content;
        }
      }

      if (snapRes?.ok) {
        const snapData = await snapRes.json();
        initialSnapshot = buildSnapshotSummary(snapData, null);
        const sess = snapData?.navigationSession;
        const planMapId = snapData?.navigationPlan?.mapId;
        if (planMapId) {
          liveSessionMapId = planMapId;
        } else if (
          sess?.mapId &&
          ['WAITING_FOR_PI', 'LOCALIZING', 'READY'].includes(sess.state)
        ) {
          liveSessionMapId = sess.mapId;
        }
      }
    } catch {}

    // 2. Chọn map tối ưu nhất từ danh sách maps của BE
    if (mapsList.length > 0) {
      availableMaps = mapsList;
      const endpointCountByMap = new Map<string, number>();
      allEndpoints.forEach((ep) => {
        if (ep.mapId) {
          endpointCountByMap.set(ep.mapId, (endpointCountByMap.get(ep.mapId) || 0) + 1);
        }
      });

      const byPreferred = preferredMapId
        ? mapsList.find((m) => m.mapId === preferredMapId)
        : null;
      const byLiveSession =
        liveSessionMapId && (endpointCountByMap.get(liveSessionMapId) || 0) > 0
          ? mapsList.find((m) => m.mapId === liveSessionMapId)
          : null;

      // Ưu tiên map có nhiều endpoints đã cấu hình nhất (vd: 'map mới nhất' bdf6503a với 11 endpoints bệnh viện)
      const sortedByEndpoints = [...mapsList].sort(
        (a, b) =>
          (endpointCountByMap.get(b.mapId) || 0) - (endpointCountByMap.get(a.mapId) || 0)
      );

      activeMap =
        byPreferred ||
        byLiveSession ||
        sortedByEndpoints[0] ||
        mapsList[0] ||
        DEFAULT_HOSPITAL_MAP;
    }

    // 3. Lấy metadata của ảnh map đã chọn
    try {
      const metaRes = await fetch(`${REMOTE_API_BASE}/maps/${activeMap.mapId}/image-metadata`, {
        headers,
      });
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        if (metaData?.width_px) {
          metadata = metaData;
        }
      }
    } catch {}

    // 4. Lọc phân khu zones thuộc map đã chọn
    if (allZones.length > 0) {
      zones = allZones.filter((z: any) => z.mapId === activeMap.mapId && z.active !== false);
    }

    // 5. Lọc danh sách endpoints thuộc map đã chọn (giữ nguyên tên và mã endpoint từ API)
    if (allEndpoints.length > 0) {
      const filtered = allEndpoints.filter((e: any) => e.mapId === activeMap.mapId);
      if (filtered.length > 0) {
        endpoints = filtered.map((ep: any) => ({
          ...ep,
          endpointName: (ep.endpointName || ep.endpointCode || '').trim(),
          endpointCode: (ep.endpointCode || ep.endpointName || '').trim(),
        }));
      }
    }

    // 6. Lấy Presentation Map ưu tiên endpoint /presentation/published (đồng bộ với UI app)
    const extractPresentation = (raw: any): PresentationDocument | null => {
      if (!raw || typeof raw !== 'object') return null;
      const doc =
        raw?.document ||
        raw?.published ||
        raw?.draft ||
        (Array.isArray(raw?.features) ? raw : null);
      if (doc && Array.isArray(doc.features) && doc.features.length > 0) {
        return {
          ...doc,
          source: raw?.source ?? doc?.source ?? null,
        };
      }
      return null;
    };

    try {
      const publishedRes = await fetch(
        `${REMOTE_API_BASE}/maps/${activeMap.mapId}/presentation/published`,
        { headers }
      );
      if (publishedRes.ok) {
        presentation = extractPresentation(await publishedRes.json());
      } else {
        const presRes = await fetch(
          `${REMOTE_API_BASE}/maps/${activeMap.mapId}/presentation`,
          { headers }
        );
        if (presRes.ok) {
          presentation = extractPresentation(await presRes.json());
        }
      }
    } catch {}

    const defaultPresentationMapId = (defaultPresentationData as any)?.source?.mapId;
    if (
      !presentation &&
      defaultPresentationMapId &&
      activeMap.mapId === defaultPresentationMapId
    ) {
      presentation = DEFAULT_PRESENTATION_DOC;
    }

    return {
      activeMap,
      availableMaps,
      metadata,
      zones,
      endpoints,
      presentation,
      token,
      initialSnapshot,
    };
  }

  /**
   * Tải snapshot, vị trí thời gian thực và chỉ dẫn điều hướng (chỉ gọi navigation-guidance khi đang có hoạt động)
   */
  public async loadRobotSnapshot(options?: {
    includeGuidance?: boolean;
  }): Promise<RobotSnapshotSummary> {
    const token = await this.getViewerToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // 1. Nhận diện ID robot theo cấu hình (chỉ lookup /robots tối đa 1 lần hoặc sau cooldown)
    const configuredRobotId = (process.env.EXPO_PUBLIC_ROBOT_ID || '').trim();
    if (configuredRobotId) {
      cachedActiveRobotId = configuredRobotId;
      hasResolvedRobotId = true;
    } else if (!hasResolvedRobotId && Date.now() >= robotLookupCooldownUntil) {
      try {
        const robotsRes = await fetch(`${REMOTE_API_BASE}/robots`, { headers });
        if (robotsRes.ok) {
          const robotsData = await robotsRes.json();
          const list = robotsData?.content || robotsData;
          if (Array.isArray(list) && list.length > 0) {
            const matching = list.find(
              (r: any) => r.robotCode === DEFAULT_ROBOT_CODE || r.robotId === cachedActiveRobotId
            );
            const selected = matching || list[0];
            if (selected?.robotId) {
              cachedActiveRobotId = selected.robotId;
            }
          }
          hasResolvedRobotId = true;
        } else {
          robotLookupCooldownUntil = Date.now() + ROBOT_LOOKUP_COOLDOWN_MS;
        }
      } catch {
        robotLookupCooldownUntil = Date.now() + ROBOT_LOOKUP_COOLDOWN_MS;
      }
    }

    // 2. Lấy snapshot trước; chỉ gọi navigation-guidance khi robot không IDLE hoặc đang có job/plan
    try {
      const snapRes = await fetch(`${REMOTE_API_BASE}/robots/${cachedActiveRobotId}/snapshot`, {
        headers,
      });

      if (snapRes.status === 401) {
        cachedViewerToken = null;
        tokenExpiresAt = 0;
      }

      if (snapRes.ok) {
        const snapshot = await snapRes.json();
        const robotState = snapshot?.robot?.status || 'IDLE';
        const hasPlanPoints =
          Array.isArray(snapshot?.navigationPlan?.points) &&
          snapshot.navigationPlan.points.length >= 2;
        const shouldFetchGuidance =
          options?.includeGuidance !== false &&
          Boolean(snapshot?.activeJobId || hasPlanPoints || robotState !== 'IDLE');

        let guidData: any = null;
        if (shouldFetchGuidance) {
          const guidRes = await fetch(
            `${REMOTE_API_BASE}/robots/${cachedActiveRobotId}/navigation-guidance`,
            { headers }
          ).catch(() => null);
          guidData = guidRes?.ok ? await guidRes.json().catch(() => null) : null;
        }

        return buildSnapshotSummary(snapshot, guidData);
      }
    } catch {}

    // Dự phòng khi mất kết nối mạng
    return {
      pose: null,
      isPoseLive: false,
      status: 'IDLE',
      batteryRaw: 7850,
      mqttConnected: false,
      navigationPlan: null,
      backendGuidance: null,
      activeJobId: null,
      dispatchReady: false,
      snapshotReachable: false,
    };
  }

  /**
   * Tạo job dẫn đường trong workflow NAVIGATION đã publish sẵn (không tạo workflow mới),
   * chỉ gửi khi robot ở trạng thái IDLE và không có job nào đang chạy.
   */
  public async dispatchMoveWorkflow(
    endpointId: string,
    mapId: string,
    sessionId?: string | null
  ): Promise<{ ok: boolean; serviceRequestId?: string; workflowId?: string; reason?: string }> {
    const snapshot = await this.loadRobotSnapshot({ includeGuidance: false });
    if (snapshot.snapshotReachable && snapshot.status !== 'IDLE') {
      return {
        ok: false,
        reason: `Robot đang ở trạng thái ${snapshot.status}, cần IDLE để nhận lệnh mới.`,
      };
    }
    if (snapshot.activeJobId) {
      return {
        ok: false,
        reason: 'Robot đang có job hoạt động, không thể gửi thêm lệnh đè.',
      };
    }

    try {
      const workflowId = await robotApiService.resolveNavigationWorkflowId('NAVIGATION');
      const useSessionId =
        sessionId && snapshot.sessionState === 'READY' && snapshot.sessionMapId === mapId
          ? sessionId
          : undefined;
      const res = await robotApiService.requestNavigation(
        {
          mapId,
          workflowId,
          destinationEndpointId: endpointId,
          targetMode: 'ENDPOINT',
          navigationMode: 'STANDARD',
          passengerCount: 1,
          priority: 80,
          navigationSessionId: useSessionId,
          note: 'Bệnh nhân chọn điểm đến trên bản đồ robot',
        },
        generateUuid(),
      );
      return {
        ok: true,
        serviceRequestId: res?.request?.serviceRequestId,
        workflowId: res?.workflowId || workflowId,
      };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'Không thể tạo yêu cầu dẫn đường.',
      };
    }
  }
}

export const robotMapService = new RobotMapService();
