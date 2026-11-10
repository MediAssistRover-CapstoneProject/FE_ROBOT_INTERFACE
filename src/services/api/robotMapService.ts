import {
  MapResponse,
  ZoneDto,
  EndpointResponse,
  MapRobotPose,
  MapPlanPoint,
} from '../../components/map/BackendHospitalMap';

export const REMOTE_API_BASE = 'https://mediassistrover.duckdns.org/api/v1';

// Cấu hình chuẩn của map 'final o truong' đang chạy trên hệ thống bệnh viện
export const DEFAULT_HOSPITAL_MAP: MapResponse = {
  mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09',
  floorId: 'c214abc7-c887-11f1-904a-f63b6c16c38d',
  mapCode: 'MAP_c91abd2e7ba64992a843d5bcb5e40540',
  versionNo: 1,
  mapName: 'final o truong',
  widthM: 5.775,
  heightM: 4.7,
  resolutionMPerPixel: 0.025,
  originXM: -3.4252,
  originYM: -1.4668,
  originYawRad: 0,
};

export const DEFAULT_MAP_METADATA = {
  width_px: 231,
  height_px: 188,
  resolution_m_per_pixel: 0.025,
  width_m: 5.775,
  height_m: 4.7,
  origin_x_m: -3.4252,
  origin_y_m: -1.4668,
  origin_yaw_rad: 0,
  frame_id: 'map',
  map_id: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09',
  image_url:
    'https://mediassistrover-media-2026-179897609252.s3.ap-southeast-1.amazonaws.com/images/maps/e571fe71-d3ea-4aa5-a673-ffd857ac9f09.png',
};

// 2 Vùng phân khu giao thông thực tế trên map: Vùng giảm tốc (SPEED) và Vùng cấm (KEEP_OUT)
export const DEFAULT_HOSPITAL_ZONES: ZoneDto[] = [
  {
    zoneId: '48cbf96f-d876-4889-abab-135f7a405884',
    mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09',
    zoneCode: 'giam toc',
    zoneName: 'giam toc',
    zoneType: 'SPEED',
    speedLimitMps: 0.15,
    active: true,
    polygonJson: {
      points: [
        [0.262258, 1.695686],
        [-0.037742, 1.270686],
        [0.862258, 0.620686],
        [1.337258, 1.395686],
      ],
    },
  },
  {
    zoneId: '6fbcfe97-6b89-40c1-979a-3ac8da98f41a',
    mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09',
    zoneCode: 'ZONE_001',
    zoneName: 'cấm',
    zoneType: 'KEEP_OUT',
    active: true,
    polygonJson: {
      points: [
        [0.912258, -0.554314],
        [1.387258, -0.754314],
        [1.212258, -1.154314],
        [0.787258, -0.979314],
      ],
    },
  },
];

// 11 Điểm đến (Endpoints) thực tế trên map final o truong
export const DEFAULT_HOSPITAL_ENDPOINTS: EndpointResponse[] = [
  { endpointId: 'ep-01', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: '01', endpointName: 'phòng 1', xM: 1.34, yM: -0.33 },
  { endpointId: 'ep-02', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: '02', endpointName: 'phòng 2', xM: 1.54, yM: 1.02 },
  { endpointId: 'ep-03', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: '03', endpointName: 'phòng 3', xM: 0.12, yM: 1.12 },
  { endpointId: 'ep-04', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: '04', endpointName: 'phòng 4', xM: 1.77, yM: -0.42 },
  { endpointId: 'ep-05', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: '05', endpointName: 'phòng 5', xM: 1.72, yM: 1.18 },
  { endpointId: 'ep-06', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: '06', endpointName: 'phòng 6', xM: 0.55, yM: -0.85 },
  { endpointId: 'ep-kho', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: 'kho', endpointName: 'phòng kho', xM: 0.85, yM: 0.25 },
  { endpointId: 'ep-lt', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: 'lt', endpointName: 'Lễ tân', xM: -0.25, yM: -0.15 },
  { endpointId: 'ep-wc', mapId: 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09', endpointCode: 'WC', endpointName: 'Khu vệ sinh', xM: -1.15, yM: 0.75 },
];

let cachedViewerToken: string | null = null;
let tokenExpiresAt = 0;
let cachedActiveRobotId: string = '0e3f1083-2546-4f45-8004-5eda5cb75a6f';

class RobotMapService {
  /**
   * Lấy token đọc dữ liệu hệ thống (viewer/admin) từ Backend
   */
  public async getViewerToken(): Promise<string | null> {
    const now = Date.now();
    if (cachedViewerToken && tokenExpiresAt > now + 60_000) {
      return cachedViewerToken;
    }

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
          cachedViewerToken = data.accessToken;
          tokenExpiresAt = now + 3600 * 1000;
          return cachedViewerToken;
        }
      }
    } catch {
      // Ignored
    }
    return cachedViewerToken;
  }

  /**
   * Tải toàn bộ cấu hình Map, Zones, Endpoints từ Backend
   */
  public async loadMapPackage() {
    const token = await this.getViewerToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    let activeMap: MapResponse = DEFAULT_HOSPITAL_MAP;
    let metadata: Record<string, any> = DEFAULT_MAP_METADATA;
    let zones: ZoneDto[] = DEFAULT_HOSPITAL_ZONES;
    let endpoints: EndpointResponse[] = DEFAULT_HOSPITAL_ENDPOINTS;

    // 1. Lấy danh sách map từ backend
    try {
      const mapsRes = await fetch(`${REMOTE_API_BASE}/maps`, { headers });
      if (mapsRes.ok) {
        const mapsData = await mapsRes.json();
        const list = mapsData?.content;
        if (Array.isArray(list) && list.length > 0) {
          const match =
            list.find((m: any) => m.mapName?.toLowerCase().includes('truong')) || list[0];
          activeMap = match;
        }
      }
    } catch {}

    // 2. Lấy metadata của ảnh map
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

    // 3. Lấy phân khu zones
    try {
      const zonesRes = await fetch(`${REMOTE_API_BASE}/zones`, { headers });
      if (zonesRes.ok) {
        const zonesData = await zonesRes.json();
        const list = zonesData?.content;
        if (Array.isArray(list) && list.length > 0) {
          const filtered = list.filter((z: any) => z.mapId === activeMap.mapId);
          if (filtered.length > 0) zones = filtered;
        }
      }
    } catch {}

    // 4. Lấy danh sách endpoints
    try {
      const epRes = await fetch(`${REMOTE_API_BASE}/endpoints`, { headers });
      if (epRes.ok) {
        const epData = await epRes.json();
        const list = epData?.content;
        if (Array.isArray(list) && list.length > 0) {
          const filtered = list.filter(
            (e: any) => e.mapId === activeMap.mapId && Number.isFinite(Number(e.xM))
          );
          if (filtered.length > 0) endpoints = filtered;
        }
      }
    } catch {}

    return {
      activeMap,
      metadata,
      zones,
      endpoints,
      token,
    };
  }

  /**
   * Tải snapshot & vị trí thời gian thực của Robot (Nav2 Telemetry + Quỹ đạo di chuyển)
   */
  public async loadRobotSnapshot(): Promise<{
    pose: MapRobotPose | null;
    isPoseLive: boolean;
    status: string;
    batteryRaw: number;
    mqttConnected: boolean;
    navigationPlan: MapPlanPoint[] | null;
  }> {
    const token = await this.getViewerToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // 1. Tự động nhận diện ID robot đang hoạt động trên hệ thống
    try {
      const robotsRes = await fetch(`${REMOTE_API_BASE}/robots`, { headers });
      if (robotsRes.ok) {
        const robotsData = await robotsRes.json();
        const list = robotsData?.content || robotsData;
        if (Array.isArray(list) && list.length > 0) {
          const busy = list.find((r: any) => r.status === 'BUSY');
          const idle = list.find((r: any) => r.status === 'IDLE');
          const selected = busy || idle || list[0];
          if (selected?.robotId) {
            cachedActiveRobotId = selected.robotId;
          }
        }
      }
    } catch {}

    // 2. Lấy Snapshot trực tiếp của Robot (Tọa độ Nav2 + Đường đi Planned Path)
    try {
      const res = await fetch(`${REMOTE_API_BASE}/robots/${cachedActiveRobotId}/snapshot`, {
        headers,
      });
      if (res.ok) {
        const snapshot = await res.json();
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

        // Trích xuất toàn bộ toạ độ điểm đường đi từ kế hoạch điều hướng Nav2 (navigationPlan)
        let navigationPlan: MapPlanPoint[] | null = null;
        const rawPoints = snapshot?.navigationPlan?.points;
        if (Array.isArray(rawPoints) && rawPoints.length >= 2) {
          navigationPlan = rawPoints
            .map((pt: any) => ({
              xM: Number(pt?.xM ?? pt?.x_m ?? pt?.x),
              yM: Number(pt?.yM ?? pt?.y_m ?? pt?.y),
            }))
            .filter((pt) => Number.isFinite(pt.xM) && Number.isFinite(pt.yM));
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
        };
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
    };
  }
}

export const robotMapService = new RobotMapService();
