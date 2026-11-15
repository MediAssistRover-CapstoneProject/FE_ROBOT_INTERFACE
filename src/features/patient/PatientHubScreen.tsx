import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RootStackParamList } from '../../app/navigation';
import { AppText } from '../../components/ui';
import {
  BackendHospitalMap,
  MapResponse,
  ZoneDto,
  EndpointResponse,
  MapRobotPose,
  MapPlanPoint,
} from '../../components/map/BackendHospitalMap';
import { apiClient, robotApiService } from '../../services/api';
import { generateUuid } from '../../services/api/config';
import {
  computeGuidance,
  NavigationGuidanceResult,
} from '../navigation/navigationGuidance';
import {
  planFallbackCorridorPath,
  planPathOnSlamGrid,
  SlamAutoAlignResult,
} from '../../components/map/slamMapAutoAlign';
import {
  robotMapService,
  DEFAULT_HOSPITAL_MAP,
  DEFAULT_MAP_METADATA,
  DEFAULT_HOSPITAL_ZONES,
  DEFAULT_HOSPITAL_ENDPOINTS,
  PresentationDocument,
} from '../../services/api/robotMapService';
import { ClinicDestination, DEFAULT_HOSPITAL_ROOMS, DEFAULT_MAP_ID } from './types';
import { colors, radii, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function PatientHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  // Khóa cứng màn hình xoay ngang (Landscape HMI)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  // 1. Dữ liệu Bản đồ Backend (Đồng bộ từ API /api/v1/maps & /endpoints)
  const [activeMap, setActiveMap] = useState<MapResponse>(DEFAULT_HOSPITAL_MAP);
  const [mapMetadata, setMapMetadata] = useState<Record<string, any>>(DEFAULT_MAP_METADATA);
  const [zones, setZones] = useState<ZoneDto[]>(DEFAULT_HOSPITAL_ZONES);
  const [endpoints, setEndpoints] = useState<EndpointResponse[]>(DEFAULT_HOSPITAL_ENDPOINTS);
  const [presentationDoc, setPresentationDoc] = useState<PresentationDocument | null>(
    null
  );
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [autoAlign, setAutoAlign] = useState<SlamAutoAlignResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionMapId, setSessionMapId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const navigationInFlightRef = useRef<boolean>(false);

  // 2. Tọa độ Robot AMR thời gian thực & điểm xuất phát chặng dẫn đường
  const [routeOrigin, setRouteOrigin] = useState<MapPlanPoint>({
    xM: 0.5745,
    yM: 2.2425,
  });
  const [robotPose, setRobotPose] = useState<MapRobotPose | null>({
    xM: 0.606,
    yM: 2.873,
    yawRad: 1.515,
    fresh: true,
    mapId: DEFAULT_HOSPITAL_MAP.mapId,
  });
  const [isPoseLive, setIsPoseLive] = useState<boolean>(false);
  const [robotStatus, setRobotStatus] = useState<string>('IDLE');
  const [batteryPercent, setBatteryPercent] = useState<number>(85);

  // 3. Lựa chọn điểm đến từ danh sách Endpoint API của Map
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    DEFAULT_HOSPITAL_ENDPOINTS[0]?.endpointId || 'b4730be6-6d2f-43ec-aae3-05b1b426fa64'
  );

  // 4. Trạng thái Dẫn đường (Escort) & Quỹ đạo Nav2
  const [isEscorting, setIsEscorting] = useState<boolean>(false);
  const [loadingEscort, setLoadingEscort] = useState<boolean>(false);
  const [isStoppingEscort, setIsStoppingEscort] = useState<boolean>(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [escortStatus, setEscortStatus] = useState<string>('IDLE');
  const [liveNavPlan, setLiveNavPlan] = useState<MapPlanPoint[] | null>(null);
  const [backendGuidance, setBackendGuidance] = useState<NavigationGuidanceResult | null>(null);

  // 5. Trợ lý giọng nói & Báo động SOS
  const [isSendingVoice, setIsSendingVoice] = useState<boolean>(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [isTriggeringSos] = useState<boolean>(false);

  // Chuyển đổi danh sách Endpoints từ API Map sang danh mục Điểm đến cho Bệnh nhân
  const mapEndpoints = useMemo(() => {
    const filtered = endpoints.filter(
      (ep) => ep.active !== false && (!ep.mapId || ep.mapId === activeMap.mapId)
    );
    return filtered.length > 0 ? filtered : endpoints;
  }, [endpoints, activeMap.mapId]);

  const destinations: ClinicDestination[] = useMemo(() => {
    if (mapEndpoints.length === 0) return DEFAULT_HOSPITAL_ROOMS;
    const rx = robotPose?.xM ?? 0.5745;
    const ry = robotPose?.yM ?? 2.2425;
    return mapEndpoints.map((ep, idx) => {
      const distM = Math.hypot(Number(ep.xM) - rx, Number(ep.yM) - ry);
      const distCm = Math.max(10, Math.round(distM * 100));
      const etaSec = Math.max(2, Math.round(distM / 0.25));
      return {
        id: ep.endpointId || `ep-${idx}`,
        name: ep.endpointName || ep.endpointCode,
        category: 'clinic' as const,
        department: 'Khoa Khám bệnh',
        roomCode: ep.endpointCode || ep.endpointName || `P${idx + 1}`,
        doctor: 'Bác sĩ trực chuyên khoa',
        location: activeMap.mapName || 'Tầng 1',
        eta: `${etaSec} giây`,
        distance: `${distCm} cm`,
        status: 'Sẵn sàng đón tiếp',
        xPercent: 50,
        yPercent: 50,
      };
    });
  }, [mapEndpoints, robotPose?.xM, robotPose?.yM, activeMap.mapName]);

  // Tải dữ liệu Map và khởi tạo kết nối Backend
  useEffect(() => {
    let alive = true;

    async function initMapData() {
      try {
        const pkg = await robotMapService.loadMapPackage();
        if (!alive) return;
        setActiveMap(pkg.activeMap);
        setMapMetadata(pkg.metadata);
        setZones(pkg.zones);
        setEndpoints(pkg.endpoints);
        setPresentationDoc(pkg.presentation ?? null);
        setAuthToken(pkg.token);

        const activeEps = pkg.endpoints.filter(
          (ep) => ep.active !== false && (!ep.mapId || ep.mapId === pkg.activeMap.mapId)
        );
        if (activeEps.length > 0) {
          const letanEp =
            activeEps.find((ep) => ep.endpointCode.toLowerCase() === 'letan') || activeEps[0];
          const phong01Ep =
            activeEps.find((ep) => ep.endpointCode.toLowerCase() === 'phong01') || activeEps[1];
          if (letanEp && letanEp.endpointId) {
            setSelectedRoomId(letanEp.endpointId);
          }
          if (phong01Ep && letanEp) {
            const p01x = Number(phong01Ep.xM) || 0.5745;
            const p01y = Number(phong01Ep.yM) || 2.2425;
            const ltx = Number(letanEp.xM) || 0.6245;
            const lty = Number(letanEp.yM) || 3.1425;
            setRouteOrigin({ xM: p01x, yM: p01y });
            // Đặt vị trí khởi tạo của robot trên hành lang từ phong01 hướng về lễ tân (còn ~27 cm)
            const dx = ltx - p01x;
            const dy = lty - p01y;
            const len = Math.hypot(dx, dy) || 1;
            const remM = Math.min(0.27, len * 0.5);
            setRobotPose({
              xM: ltx - (dx / len) * remM,
              yM: lty - (dy / len) * remM,
              yawRad: Math.atan2(dy, dx),
              fresh: true,
              mapId: pkg.activeMap.mapId,
            });
          }
        }
      } catch (err) {
        console.warn('Lỗi khi tải map backend:', err);
      }
    }

    initMapData();
    return () => {
      alive = false;
    };
  }, []);

  // Polling telemetry robot và quỹ đạo Nav2 mỗi 1 giây
  useEffect(() => {
    let alive = true;

    const pollTelemetry = async () => {
      try {
        const snap = await robotMapService.loadRobotSnapshot();
        if (!alive) return;
        if (snap.sessionId) {
          setSessionId(snap.sessionId);
        }
        setSessionMapId(snap.sessionMapId ?? null);
        setSessionState(snap.sessionState ?? null);
        setActiveJobId(snap.activeJobId ?? null);
        // Chỉ ghi đè robotPose từ telemetry nếu dữ liệu là live và khớp với map đang hiển thị
        if (
          snap.pose &&
          snap.isPoseLive &&
          (!snap.pose.mapId || snap.pose.mapId === activeMap.mapId)
        ) {
          setRobotPose(snap.pose);
          setIsPoseLive(true);
        } else {
          setIsPoseLive(false);
        }
        setRobotStatus(snap.status);
        if (snap.batteryRaw) {
          const pct = Math.min(100, Math.max(10, Math.round(snap.batteryRaw / 100)));
          setBatteryPercent(pct);
        }
        if (snap.navigationPlan && snap.navigationPlan.length >= 2) {
          setLiveNavPlan(snap.navigationPlan);
          if (snap.planEndpointId) {
            setSelectedRoomId(snap.planEndpointId);
          }
        } else if (snap.status === 'IDLE' && !isEscorting) {
          setLiveNavPlan(null);
        }
        if (snap.backendGuidance && snap.backendGuidance.state !== 'IDLE') {
          setBackendGuidance(snap.backendGuidance);
        } else {
          setBackendGuidance(null);
        }
      } catch {}
    };

    pollTelemetry();
    const timer = setInterval(pollTelemetry, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeMap.mapId, isEscorting]);

  const fallbackRoom = destinations[0] || (DEFAULT_HOSPITAL_ROOMS[0] as ClinicDestination);
  const selectedRoom: ClinicDestination =
    destinations.find(
      (d) =>
        d.id === selectedRoomId ||
        d.roomCode.toLowerCase() === selectedRoomId.toLowerCase()
    ) || fallbackRoom;

  const selectedEndpoint: EndpointResponse | undefined = useMemo(() => {
    return (
      mapEndpoints.find(
        (ep) =>
          ep.endpointId === selectedRoom.id ||
          ep.endpointCode.toLowerCase() === selectedRoom.roomCode.toLowerCase()
      ) || mapEndpoints[0]
    );
  }, [mapEndpoints, selectedRoom.id, selectedRoom.roomCode]);

  // Quỹ đạo dẫn đường trên bản đồ: ưu tiên liveNavPlan từ Nav2, hoặc tính toán trên lưới SLAM của map API
  const plannedPath: MapPlanPoint[] | null = useMemo(() => {
    if (liveNavPlan && liveNavPlan.length >= 2) {
      return liveNavPlan;
    }
    if (!selectedEndpoint) return null;

    const targetPt: MapPlanPoint = {
      xM: Number(selectedEndpoint.xM),
      yM: Number(selectedEndpoint.yM),
    };
    const startPt: MapPlanPoint = routeOrigin || {
      xM: robotPose?.xM ?? 0.5745,
      yM: robotPose?.yM ?? 2.2425,
    };

    const resolution =
      Number(
        mapMetadata?.resolution_m_per_pixel ??
          mapMetadata?.resolutionMPerPixel ??
          mapMetadata?.resolution ??
          activeMap.resolutionMPerPixel
      ) || 0.05;
    const origin = Array.isArray(mapMetadata?.origin) ? mapMetadata.origin : [];
    const originX =
      Number(
        mapMetadata?.origin_x_m ??
          mapMetadata?.originXM ??
          mapMetadata?.originX ??
          origin[0] ??
          activeMap.originXM
      ) || 0;
    const originY =
      Number(
        mapMetadata?.origin_y_m ??
          mapMetadata?.originYM ??
          mapMetadata?.originY ??
          origin[1] ??
          activeMap.originYM
      ) || 0;
    const originYaw =
      Number(
        mapMetadata?.origin_yaw_rad ??
          mapMetadata?.originYawRad ??
          mapMetadata?.originYaw ??
          origin[2] ??
          activeMap.originYawRad
      ) || 0;

    if (autoAlign) {
      const slamRoute = planPathOnSlamGrid(
        autoAlign,
        {
          widthPx: autoAlign.width,
          heightPx: autoAlign.height,
          resolution,
          originX,
          originY,
          originYaw,
        },
        startPt,
        targetPt
      );
      if (slamRoute && slamRoute.length >= 2) {
        return slamRoute;
      }
    }

    return planFallbackCorridorPath(startPt, targetPt);
  }, [liveNavPlan, selectedEndpoint, routeOrigin, robotPose?.xM, robotPose?.yM, mapMetadata, activeMap, autoAlign]);

  // Realtime Navigation Guidance (hiển thị banner chỉ dẫn màu xanh trên bản đồ như ảnh mẫu)
  const guidance: NavigationGuidanceResult | null = useMemo(() => {
    if (backendGuidance && isPoseLive && backendGuidance.state !== 'IDLE') {
      return backendGuidance;
    }
    if (!plannedPath || plannedPath.length < 2) return null;
    return computeGuidance({
      planPoints: plannedPath,
      robotPose,
      destinationName: selectedEndpoint?.endpointName || selectedRoom.name,
      speedMps: 0.25,
      preferCm: true,
    });
  }, [backendGuidance, isPoseLive, plannedPath, robotPose, selectedEndpoint, selectedRoom.name]);

  // Chuyển động dẫn đường mượt dọc theo quỹ đạo plannedPath khi người dùng bấm "Bắt đầu Dẫn đường"
  useEffect(() => {
    if (!isEscorting || isPoseLive || !plannedPath || plannedPath.length < 2) return;

    const stepMeters = 0.045; // ~0.18 m/s mỗi 250ms
    const timer = setInterval(() => {
      setRobotPose((prev) => {
        if (!prev) return prev;
        const lastPt = plannedPath[plannedPath.length - 1];
        if (!lastPt) return prev;

        const g = computeGuidance({
          planPoints: plannedPath,
          robotPose: prev,
          destinationName: selectedEndpoint?.endpointName || selectedRoom.name,
          speedMps: 0.25,
          preferCm: true,
        });

        if (g.state === 'ARRIVED' || (typeof g.remainingCm === 'number' && g.remainingCm <= 14)) {
          setIsEscorting(false);
          setEscortStatus('COMPLETED');
          setVoiceFeedback(`Đã đến ${selectedEndpoint?.endpointName || selectedRoom.name}!`);
          return {
            ...prev,
            xM: lastPt.xM,
            yM: lastPt.yM,
            fresh: true,
          };
        }

        const segIdx = typeof g.segmentIndex === 'number' ? g.segmentIndex : 0;
        const projX = g.projection ? g.projection.xM : prev.xM;
        const projY = g.projection ? g.projection.yM : prev.yM;

        let remStep = stepMeters;
        let curX = projX;
        let curY = projY;
        let curYaw = prev.yawRad;

        for (let i = segIdx + 1; i < plannedPath.length; i += 1) {
          const target = plannedPath[i]!;
          const dx = target.xM - curX;
          const dy = target.yM - curY;
          const segDist = Math.hypot(dx, dy);
          if (segDist <= 1e-5) continue;

          curYaw = Math.atan2(dy, dx);
          if (segDist >= remStep) {
            curX += (dx / segDist) * remStep;
            curY += (dy / segDist) * remStep;
            break;
          } else {
            curX = target.xM;
            curY = target.yM;
            remStep -= segDist;
          }
        }

        return {
          ...prev,
          xM: curX,
          yM: curY,
          yawRad: curYaw,
          fresh: true,
        };
      });
    }, 250);

    return () => clearInterval(timer);
  }, [isEscorting, isPoseLive, plannedPath, selectedEndpoint, selectedRoom.name]);

  // Polling theo dõi trạng thái yêu cầu dẫn đường thật từ GET /api/v1/pi/requests/{requestId}
  useEffect(() => {
    if (!activeRequestId || !isEscorting) return;

    const pollTimer = setInterval(async () => {
      try {
        const detail = await robotApiService.getRequestDetail(activeRequestId);
        if (detail?.status) {
          setEscortStatus(detail.status);
          if (detail.status === 'COMPLETED') {
            clearInterval(pollTimer);
            setIsEscorting(false);
            setActiveRequestId(null);
            Alert.alert(
              'Đã đến nơi an toàn!',
              `Robot đã dẫn bạn đến trước cửa ${selectedRoom.name} (${selectedRoom.roomCode}). Chúc bạn khám bệnh thuận lợi!`
            );
          } else if (detail.status === 'CANCELLED' || detail.status === 'FAILED') {
            clearInterval(pollTimer);
            setIsEscorting(false);
            setActiveRequestId(null);
          }
        }
      } catch {}
    }, 2000);

    return () => {
      clearInterval(pollTimer);
    };
  }, [activeRequestId, isEscorting, selectedRoom]);

  // Hàm chọn điểm đến & chuẩn bị lộ trình chỉ đường trên bản đồ
  const selectDestinationEndpoint = (ep: EndpointResponse) => {
    setSelectedRoomId(ep.endpointId || ep.endpointCode);
    const phong01Ep =
      mapEndpoints.find((item) => item.endpointCode.toLowerCase() === 'phong01') ||
      mapEndpoints[1] ||
      mapEndpoints[0];

    const epX = Number(ep.xM) || 0;
    const epY = Number(ep.yM) || 0;
    const curX = robotPose?.xM ?? 0.5745;
    const curY = robotPose?.yM ?? 2.2425;
    const distToTarget = Math.hypot(epX - curX, epY - curY);

    // Nếu robot đang đứng trùng hoặc quá sát điểm đến được chọn, đặt điểm xuất phát tại phong01 (hoặc lễ tân) để vẽ rõ lộ trình dẫn đường
    if (distToTarget < 0.25 && phong01Ep) {
      const p01x = Number(phong01Ep.xM) || 0.5745;
      const p01y = Number(phong01Ep.yM) || 2.2425;
      const altOrigin: MapPlanPoint =
        Math.hypot(epX - p01x, epY - p01y) > 0.25
          ? { xM: p01x, yM: p01y }
          : { xM: 0.6245, yM: 3.1425 };
      const dx = epX - altOrigin.xM;
      const dy = epY - altOrigin.yM;
      setRouteOrigin(altOrigin);
      if (!isPoseLive) {
        setRobotPose({
          xM: altOrigin.xM,
          yM: altOrigin.yM,
          yawRad: Math.atan2(dy, dx),
          fresh: true,
          mapId: activeMap.mapId,
        });
      }
    } else {
      const originPt: MapPlanPoint = { xM: curX, yM: curY };
      setRouteOrigin(originPt);
      if (!isPoseLive) {
        const dx = epX - curX;
        const dy = epY - curY;
        setRobotPose((prev) =>
          prev
            ? {
                ...prev,
                yawRad: Math.atan2(dy, dx),
                fresh: true,
              }
            : prev
        );
      }
    }
    setVoiceFeedback(`Đã chọn chỉ đường đến: ${ep.endpointName || ep.endpointCode}`);
  };

  // Khởi tạo 1 job dẫn đường trong workflow NAVIGATION có sẵn (chỉ chạy khi robot IDLE & không có job đè)
  const startNavigationToEndpoint = async (targetEp?: EndpointResponse) => {
    if (!targetEp) return;

    selectDestinationEndpoint(targetEp);

    if (navigationInFlightRef.current) {
      return;
    }
    if (isEscorting || activeRequestId) {
      setVoiceFeedback(
        `Robot đang thực hiện lộ trình (${escortStatus}). Vui lòng bấm Dừng trước khi chọn điểm đến mới.`
      );
      return;
    }

    navigationInFlightRef.current = true;
    setLoadingEscort(true);

    const targetName = targetEp.endpointName || targetEp.endpointCode || selectedRoom.name;
    const destinationEndpointId = targetEp.endpointId;
    const targetMapId = activeMap.mapId || DEFAULT_MAP_ID;

    try {
      // 1. Kiểm tra trạng thái sẵn sàng (IDLE + chưa có job đang chạy) từ snapshot mới nhất
      const freshSnap = await robotMapService.loadRobotSnapshot();
      setRobotStatus(freshSnap.status);
      setActiveJobId(freshSnap.activeJobId ?? null);
      if (freshSnap.sessionId) setSessionId(freshSnap.sessionId);
      setSessionMapId(freshSnap.sessionMapId ?? null);
      setSessionState(freshSnap.sessionState ?? null);

      if (freshSnap.snapshotReachable && freshSnap.status !== 'IDLE') {
        setVoiceFeedback(
          `Robot đang ${freshSnap.status}, cần ở trạng thái IDLE sẵn sàng mới bắt đầu dẫn đường.`
        );
        return;
      }

      if (freshSnap.activeJobId) {
        setVoiceFeedback(
          'Robot đang có job hoạt động trên hệ thống, chưa thể nhận thêm lệnh dẫn đường.'
        );
        return;
      }

      if (!destinationEndpointId) {
        setVoiceFeedback('Endpoint này chưa có ID hợp lệ từ bản đồ Backend.');
        return;
      }

      // 2. Lấy workflow NAVIGATION đã publish sẵn trên BE (không tạo workflow mới)
      const existingWorkflowId = await robotApiService.resolveNavigationWorkflowId('NAVIGATION');
      const resolvedSessionId = freshSnap.sessionId || sessionId;
      const useSessionId =
        resolvedSessionId &&
        freshSnap.sessionState === 'READY' &&
        freshSnap.sessionMapId === targetMapId
          ? resolvedSessionId
          : undefined;

      // 3. Tạo đúng 1 Job dẫn đường qua POST /api/v1/pi/requests/navigation
      const reqKey = generateUuid();
      const navRes = await robotApiService.requestNavigation(
        {
          mapId: targetMapId,
          workflowId: existingWorkflowId,
          destinationEndpointId,
          targetMode: 'ENDPOINT',
          navigationMode: 'STANDARD',
          passengerCount: 1,
          priority: 80,
          navigationSessionId: useSessionId,
          note: `Bệnh nhân chọn dẫn đường đến ${targetName}`,
        },
        reqKey,
      );

      const serviceRequestId = navRes?.request?.serviceRequestId;
      if (serviceRequestId) {
        setActiveRequestId(serviceRequestId);
        setIsEscorting(true);
        setEscortStatus(navRes.request?.status || 'QUEUED');
        setVoiceFeedback(`Robot đã nhận lệnh dẫn đường đến ${targetName}.`);
        await robotApiService
          .sendHeartbeat('BUSY', batteryPercent * 100, targetMapId)
          .catch(() => {});
        return;
      }

      setVoiceFeedback(`Đã gửi yêu cầu dẫn đường đến ${targetName}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Nếu server kết nối được nhưng từ chối do conflict/not IDLE/workflow, tuyệt đối không chạy đè
      const isServerRejection =
        /409|400|403|401|idle|conflict|active|workflow|session|job/i.test(msg);

      if (isServerRejection) {
        setVoiceFeedback(msg || 'Không thể bắt đầu dẫn đường vì robot chưa sẵn sàng.');
        return;
      }

      // Chỉ mô phỏng dẫn đường cục bộ khi tablet không kết nối được máy chủ/robot vật lý
      if (!isPoseLive && robotPose) {
        const tx = Number(targetEp.xM) || 0;
        const ty = Number(targetEp.yM) || 0;
        if (Math.hypot(tx - robotPose.xM, ty - robotPose.yM) <= 0.35) {
          const startPt = routeOrigin || { xM: 0.5745, yM: 2.2425 };
          const firstNext =
            plannedPath && plannedPath.length >= 2
              ? plannedPath[1]!
              : { xM: tx, yM: ty };
          setRobotPose({
            xM: startPt.xM,
            yM: startPt.yM,
            yawRad: Math.atan2(firstNext.yM - startPt.yM, firstNext.xM - startPt.xM),
            fresh: true,
            mapId: activeMap.mapId,
          });
        }
      }
      setIsEscorting(true);
      setEscortStatus('OFFLINE_PREVIEW');
      setVoiceFeedback(`Đang dẫn đường mô phỏng đến ${targetName} (chưa kết nối BE/robot).`);
    } finally {
      navigationInFlightRef.current = false;
      setLoadingEscort(false);
    }
  };

  // Bấm nút "Bắt đầu Dẫn đường" trên bảng điều khiển phải
  const handleRequestEscort = () => {
    void startNavigationToEndpoint(selectedEndpoint || mapEndpoints[0]);
  };

  // Dừng dẫn đường qua POST /api/v1/pi/requests/{requestId}/cancel
  const handleCancelEscort = async () => {
    if (!activeRequestId) {
      setIsEscorting(false);
      setEscortStatus('IDLE');
      setVoiceFeedback(null);
      return;
    }
    setIsStoppingEscort(true);
    try {
      await robotApiService.cancelRequest(activeRequestId, 'Bệnh nhân dừng yêu cầu');
      await robotApiService.sendHeartbeat('IDLE', batteryPercent * 100, activeMap.mapId).catch(() => {});
    } catch {
      // Handled
    } finally {
      setIsStoppingEscort(false);
      setIsEscorting(false);
      setEscortStatus('IDLE');
      setActiveRequestId(null);
      setVoiceFeedback(null);
    }
  };

  // Bấm nút Hỏi Trợ lý
  const handleVoicePress = async () => {
    setIsSendingVoice(true);
    setVoiceFeedback('Trợ lý: "Tôi có thể giúp bạn tìm phòng khám nào hôm nay?"');

    try {
      await robotApiService.sendVoiceCommand('Chỉ đường đến ' + selectedRoom.name);
    } catch {} finally {
      setIsSendingVoice(false);
      navigation.navigate('Assistant');
    }
  };

  // Bấm nút Cấp cứu khẩn cấp (SOS): Điều hướng sang màn hình Emergency
  const handleEmergencySos = () => {
    const hasValidCoords =
      robotPose &&
      typeof robotPose.xM === 'number' &&
      !isNaN(robotPose.xM) &&
      typeof robotPose.yM === 'number' &&
      !isNaN(robotPose.yM);

    console.log('[SOS] Tap nút CẤP CỨU SOS -> mở Emergency', {
      baseUrl: apiClient.getBaseUrl(),
      mapId: hasValidCoords && activeMap?.mapId ? activeMap.mapId : undefined,
      hasValidCoords,
      roomCode: selectedRoom?.roomCode,
    });

    navigation.navigate('Emergency', {
      mapId: hasValidCoords && activeMap?.mapId ? activeMap.mapId : undefined,
      xM: hasValidCoords ? robotPose.xM : undefined,
      yM: hasValidCoords ? robotPose.yM : undefined,
      roomCode: selectedRoom?.roomCode,
      roomName: selectedRoom?.name,
      destinationName: selectedRoom?.name,
    });
  };

  // Khi bấm trực tiếp vào một Endpoint trên bản đồ: kiểm tra robot IDLE và tạo job trong workflow có sẵn
  const handleSelectEndpoint = (ep: EndpointResponse) => {
    void startNavigationToEndpoint(ep);
  };

  return (
    <View
      style={[
        styles.landscapeRoot,
        {
          paddingTop: Math.max(insets.top, spacing.sm),
          paddingBottom: Math.max(insets.bottom, spacing.sm),
          paddingLeft: Math.max(insets.left, spacing.lg),
          paddingRight: Math.max(insets.right, spacing.lg),
        },
      ]}
    >
      {/* ======================================================== */}
      {/* CỘT TRÁI (2/3 CHIỀU NGANG): BẢN ĐỒ SLAM ROBOT CHUẨN      */}
      {/* ======================================================== */}
      <View style={styles.landscapeMapColumn}>
        {/* Khung Bản đồ Card Trắng */}
        <View style={styles.mapCard}>
          <BackendHospitalMap
            map={activeMap}
            metadata={mapMetadata}
            endpoints={endpoints}
            zones={zones}
            presentation={presentationDoc}
            token={authToken}
            selectedEndpointId={selectedRoom.id}
            onSelectEndpoint={handleSelectEndpoint}
            robotPose={robotPose}
            isPoseLive={isPoseLive}
            plannedPath={plannedPath}
            guidance={guidance}
            onStopEscort={handleCancelEscort}
            isStoppingEscort={isStoppingEscort}
            onAutoAlignReady={setAutoAlign}
          />
        </View>
      </View>

      {/* ======================================================== */}
      {/* CỘT PHẢI (1/3 CHIỀU NGANG): BẢNG THAO TÁC BỆNH NHÂN       */}
      {/* ======================================================== */}
      <View style={styles.landscapeControlColumn}>
        <ScrollView
          style={styles.controlScroll}
          contentContainerStyle={styles.controlScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* CẶP NÚT HÀNH ĐỘNG NỔI BẬT: SOS & HỎI TRỢ LÝ */}
          <View style={styles.actionButtonsRow}>
            {/* NÚT CẤP CỨU SOS (ĐỎ NỔI BẬT, MINHEIGHT 56DP) */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cấp cứu SOS gọi điều dưỡng khẩn cấp"
              onPress={handleEmergencySos}
              disabled={isTriggeringSos}
              style={({ pressed }) => [
                styles.sosButton,
                pressed && styles.sosButtonPressed,
              ]}
            >
              <View style={styles.sosIconCircle}>
                {isTriggeringSos ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Ionicons name="alert-circle" size={24} color={colors.danger} />
                )}
              </View>
              <View style={styles.actionTextCol}>
                <AppText style={styles.sosTitle}>CẤP CỨU SOS</AppText>
                <AppText style={styles.sosSubtitle}>Gọi Điều dưỡng ngay</AppText>
              </View>
            </Pressable>

            {/* NÚT HỎI TRỢ LÝ */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hỏi trợ lý bệnh viện tìm phòng khám"
              onPress={handleVoicePress}
              disabled={isSendingVoice}
              style={({ pressed }) => [
                styles.assistantButton,
                pressed && styles.assistantButtonPressed,
              ]}
            >
              <View style={styles.assistantIconCircle}>
                {isSendingVoice ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Ionicons name="chatbubbles" size={20} color={colors.textPrimary} />
                )}
              </View>
              <View style={styles.actionTextCol}>
                <AppText style={styles.assistantTitle}>Hỏi Trợ lý</AppText>
                <AppText style={styles.assistantSubtitle}>Tìm phòng khám & thông tin</AppText>
              </View>
            </Pressable>
          </View>

          {/* 3. CARD ĐIỂM ĐẾN & NÚT BẮT ĐẦU DẪN ĐƯỜNG (CTA CHÍNH MÀU ĐEN THAN) */}
          <View style={styles.destinationCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.sectionIconSquare}>
                <Ionicons name="location" size={16} color={colors.textInverse} />
              </View>
              <AppText variant="caption" style={[styles.cardHeaderTitle, { flex: 1 }]}>
                ĐIỂM ĐẾN ĐÃ CHỌN
              </AppText>
              <AppText
                variant="caption"
                style={{
                  fontWeight: '700',
                  color:
                    robotStatus === 'IDLE' && !activeJobId
                      ? '#157347'
                      : '#B45309',
                }}
              >
                {robotStatus === 'IDLE' && !activeJobId
                  ? 'IDLE · Sẵn sàng'
                  : activeJobId
                  ? `${robotStatus} · Có job`
                  : robotStatus}
              </AppText>
            </View>

            {/* Banner phản hồi (nếu có) */}
            {voiceFeedback ? (
              <View style={styles.feedbackBanner}>
                <Ionicons name="sparkles" size={14} color={colors.warningText} />
                <AppText variant="caption" style={styles.feedbackBannerText}>
                  {voiceFeedback}
                </AppText>
              </View>
            ) : null}

            {/* Thông tin phòng khám */}
            <View style={styles.roomDetailBox}>
              <View style={styles.roomCodePill}>
                <AppText style={styles.roomCodePillText}>{selectedRoom.roomCode}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="heading" style={styles.roomNameText}>
                  {selectedRoom.name}
                </AppText>
                <AppText variant="caption" style={styles.roomSubDetailText}>
                  {selectedRoom.location} • {selectedRoom.distance} • ~{selectedRoom.eta}
                </AppText>
              </View>
            </View>

            {/* CTA Dẫn đường: Màu đen than #202022 (Ảnh mẫu hero CTA) */}
            {isEscorting ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dừng dẫn đường"
                onPress={handleCancelEscort}
                disabled={isStoppingEscort}
                style={({ pressed }) => [
                  styles.stopEscortBtn,
                  pressed && { opacity: 0.85 },
                  isStoppingEscort && { opacity: 0.6 },
                ]}
              >
                {isStoppingEscort ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="stop-circle" size={22} color="#FFFFFF" />
                    <AppText style={styles.escortBtnText}>
                      Dừng dẫn đường ({escortStatus})
                    </AppText>
                  </>
                )}
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Bắt đầu dẫn đường đến ${selectedRoom.name}`}
                onPress={handleRequestEscort}
                disabled={loadingEscort}
                style={({ pressed }) => [
                  styles.startEscortBtn,
                  pressed && { opacity: 0.85 },
                  loadingEscort && { opacity: 0.6 },
                ]}
              >
                {loadingEscort ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="walk" size={22} color="#FFFFFF" />
                    <AppText style={styles.escortBtnText}>Bắt đầu Dẫn đường</AppText>
                  </>
                )}
              </Pressable>
            )}
          </View>

          {/* 4. CHỌN NHANH ĐIỂM ĐẾN TỪ DỮ LIỆU API MAP */}
          <View style={styles.quickRoomsCard}>
            <AppText variant="caption" style={styles.quickRoomsLabel}>
              CHỌN NHANH ĐIỂM ĐẾN TRÊN MAP
            </AppText>
            <View style={styles.quickRoomsRow}>
              {destinations.map((item) => {
                const isSelected =
                  item.id === selectedRoom.id ||
                  item.roomCode.toLowerCase() === selectedRoom.roomCode.toLowerCase();
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Chọn phòng ${item.name}`}
                    onPress={() => {
                      const ep = mapEndpoints.find(
                        (e) =>
                          e.endpointId === item.id ||
                          e.endpointCode.toLowerCase() === item.roomCode.toLowerCase()
                      );
                      if (ep) {
                        selectDestinationEndpoint(ep);
                      } else {
                        setSelectedRoomId(item.id);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.roomChip,
                      isSelected ? styles.roomChipSelected : styles.roomChipUnselected,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Ionicons
                      name="location-outline"
                      size={13}
                      color={isSelected ? colors.textInverse : colors.textSecondary}
                    />
                    <AppText
                      style={[
                        styles.roomChipText,
                        isSelected && styles.roomChipTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  landscapeRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  landscapeMapColumn: {
    flex: 2,
    height: '100%',
    paddingRight: spacing.md,
    justifyContent: 'flex-start',
  },
  mapCard: {
    flex: 1,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  landscapeControlColumn: {
    flex: 1,
    height: '100%',
  },
  controlScroll: {
    flex: 1,
  },
  controlScrollContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },

  // Action buttons row (SOS & Voice)
  actionButtonsRow: {
    gap: spacing.sm,
  },
  sosButton: {
    minHeight: 58,
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: colors.danger,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  sosButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  sosIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextCol: {
    flex: 1,
  },
  sosTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sosSubtitle: {
    color: '#FEE2E2',
    fontSize: 12,
    fontWeight: '500',
  },

  assistantButton: {
    minHeight: 56,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  assistantButtonPressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ scale: 0.985 }],
  },
  assistantIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  assistantSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
  },

  // 3. Destination card
  destinationCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderColor: colors.border,
    borderWidth: 1,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionIconSquare: {
    width: 26,
    height: 26,
    borderRadius: radii.xs,
    backgroundColor: colors.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderTitle: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warningSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  feedbackBannerText: {
    color: colors.warningText,
    fontWeight: '600',
    flex: 1,
  },
  roomDetailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  roomCodePill: {
    backgroundColor: colors.hero,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm,
  },
  roomCodePillText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 13,
  },
  roomNameText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 24,
  },
  roomSubDetailText: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  startEscortBtn: {
    minHeight: 56,
    backgroundColor: colors.hero,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  stopEscortBtn: {
    minHeight: 56,
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  escortBtnText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },

  // 4. Quick rooms
  quickRoomsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    gap: spacing.sm,
  },
  quickRoomsLabel: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  quickRoomsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  roomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  roomChipUnselected: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roomChipSelected: {
    backgroundColor: colors.hero,
    borderWidth: 1,
    borderColor: colors.hero,
  },
  roomChipText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  roomChipTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
});
