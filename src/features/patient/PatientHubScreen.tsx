import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RootStackParamList } from '../../app/navigation';
import { AppText } from '../../components/ui';
import { DraggableSosButton } from '../../components/DraggableSosButton';
import { QrStaffCameraOverlay } from '../../components/QrStaffCameraOverlay';
import {
  BackendHospitalMap,
  MapResponse,
  ZoneDto,
  EndpointResponse,
  MapRobotPose,
  MapPlanPoint,
} from '../../components/map/BackendHospitalMap';
import { apiClient, robotApiService } from '../../services/api';
import {
  computeGuidance,
  guidanceSymbol,
  NavigationGuidanceResult,
} from '../navigation/navigationGuidance';
import {
  robotMapService,
  DEFAULT_HOSPITAL_MAP,
  DEFAULT_MAP_METADATA,
  DEFAULT_HOSPITAL_ZONES,
  DEFAULT_HOSPITAL_ENDPOINTS,
  PresentationDocument,
  RobotSnapshotSummary,
  getAdaptivePollDelayMs,
  POLL_INTERVAL_IDLE_MS,
} from '../../services/api/robotMapService';
import { colors, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

interface ActiveQrWindowState {
  jobId: string;
  authJobStepId: string | null;
  stepCode: string | null;
  purpose?: 'DELIVERY_SENDER' | 'DELIVERY_RECEIVER';
  expiresAt?: string | null;
}

export function PatientHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [rootBounds, setRootBounds] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Theo dõi trạng thái foreground của ứng dụng để tạm dừng poll khi xuống nền
  const [isAppActive, setIsAppActive] = useState<boolean>(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  // Khóa cứng màn hình xoay ngang (Landscape HMI)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  // 1. Dữ liệu Bản đồ Backend (chỉ đọc từ /api/v1/maps & /endpoints)
  const [activeMap, setActiveMap] = useState<MapResponse>(DEFAULT_HOSPITAL_MAP);
  const [mapMetadata, setMapMetadata] = useState<Record<string, any>>(DEFAULT_MAP_METADATA);
  const [zones, setZones] = useState<ZoneDto[]>(DEFAULT_HOSPITAL_ZONES);
  const [endpoints, setEndpoints] = useState<EndpointResponse[]>(DEFAULT_HOSPITAL_ENDPOINTS);
  const [presentationDoc, setPresentationDoc] = useState<PresentationDocument | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState<boolean>(false);

  // 2. Vị trí Robot AMR từ Backend (chỉ hiển thị dữ liệu thật)
  const [robotPose, setRobotPose] = useState<MapRobotPose | null>(null);
  const [isPoseLive, setIsPoseLive] = useState<boolean>(false);

  // 3. Lộ trình & Chỉ dẫn Nav2 thật từ Backend (chỉ vẽ khi server có lộ trình)
  const [liveNavPlan, setLiveNavPlan] = useState<MapPlanPoint[] | null>(null);
  const [planEndpointId, setPlanEndpointId] = useState<string | null>(null);
  const [planEndpointName, setPlanEndpointName] = useState<string | null>(null);
  const [backendGuidance, setBackendGuidance] = useState<NavigationGuidanceResult | null>(null);

  // 4. Trạng thái hiển thị camera chờ Staff quét QR khi robot đang ở bước AUTHENTICATE
  const [activeQrWindow, setActiveQrWindow] = useState<ActiveQrWindowState | null>(null);
  const handledQrStepIdsRef = useRef<Set<string>>(new Set());
  const checkingQrRef = useRef<boolean>(false);

  const pollInFlightRef = useRef<boolean>(false);
  const initialDelayRef = useRef<number | null>(null);

  const syncQrAuthWindow = useCallback(async (snap: RobotSnapshotSummary) => {
    const jobId = snap.activeJobId;
    const stepId = snap.selectedJobStepId ?? null;
    if (!jobId || snap.selectedStepType !== 'AUTHENTICATE') {
      return;
    }
    if (stepId && handledQrStepIdsRef.current.has(stepId)) {
      return;
    }
    if (checkingQrRef.current) {
      return;
    }
    checkingQrRef.current = true;
    try {
      const challenge = await robotApiService.getStaffQrScanWindow(jobId);
      if (challenge) {
        if (handledQrStepIdsRef.current.has(challenge.authJobStepId)) {
          return;
        }
        setActiveQrWindow({
          jobId: challenge.jobId,
          authJobStepId: challenge.authJobStepId,
          stepCode: snap.selectedStepCode ?? null,
          purpose: challenge.purpose,
          expiresAt: challenge.expiresAt,
        });
        return;
      }

      if (stepId) {
        const jobStep = await robotMapService.checkJobQrStepStatus(jobId, stepId);
        if (jobStep?.stepStatus === 'RUNNING') {
          setActiveQrWindow({
            jobId,
            authJobStepId: stepId,
            stepCode: snap.selectedStepCode ?? null,
          });
        }
      }
    } finally {
      checkingQrRef.current = false;
    }
  }, []);

  const applySnapshotSummary = useCallback(
    (snap: RobotSnapshotSummary, targetMapId: string) => {
      if (snap.pose && (!snap.pose.mapId || snap.pose.mapId === targetMapId)) {
        setRobotPose(snap.pose);
        setIsPoseLive(Boolean(snap.isPoseLive));
      } else {
        if (snap.snapshotReachable) {
          setRobotPose(null);
        }
        setIsPoseLive(false);
      }

      if (snap.navigationPlan && snap.navigationPlan.length >= 2) {
        setLiveNavPlan(snap.navigationPlan);
        setPlanEndpointId(snap.planEndpointId ?? null);
        setPlanEndpointName(snap.planEndpointName ?? null);
      } else {
        setLiveNavPlan(null);
        setPlanEndpointId(null);
        setPlanEndpointName(null);
      }

      if (snap.backendGuidance && snap.backendGuidance.state !== 'IDLE') {
        setBackendGuidance(snap.backendGuidance);
      } else {
        setBackendGuidance(null);
      }

      if (snap.activeJobId && snap.selectedStepType === 'AUTHENTICATE') {
        void syncQrAuthWindow(snap);
      }
    },
    [syncQrAuthWindow]
  );

  // Tải gói dữ liệu Bản đồ lúc khởi tạo (tái sử dụng snapshot ban đầu, tránh gọi trùng)
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
        if (pkg.initialSnapshot) {
          applySnapshotSummary(pkg.initialSnapshot, pkg.activeMap.mapId);
          const hasActivity = Boolean(
            pkg.initialSnapshot.activeJobId ||
              pkg.initialSnapshot.navigationPlan?.length ||
              pkg.initialSnapshot.status !== 'IDLE'
          );
          initialDelayRef.current = hasActivity ? 200 : POLL_INTERVAL_IDLE_MS;
        }
      } catch (err) {
        console.warn('Lỗi khi tải map backend:', err);
      } finally {
        if (alive) {
          setIsMapLoaded(true);
        }
      }
    }

    initMapData();
    return () => {
      alive = false;
    };
  }, [applySnapshotSummary]);

  // Poll thông minh theo chu kỳ setTimeout nối tiếp (2.5s khi chạy, 8s khi IDLE),
  // chỉ chạy khi app active + màn hình Map đang focus + không ở màn camera QR
  useEffect(() => {
    if (!isMapLoaded || !isFocused || !isAppActive || activeQrWindow !== null) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void runPoll();
      }, delayMs);
    };

    const runPoll = async () => {
      if (cancelled || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      let nextDelayMs = POLL_INTERVAL_IDLE_MS;
      try {
        const snap = await robotMapService.loadRobotSnapshot();
        if (cancelled) return;
        applySnapshotSummary(snap, activeMap.mapId);
        nextDelayMs = getAdaptivePollDelayMs(snap);
      } catch {
        nextDelayMs = POLL_INTERVAL_IDLE_MS;
      } finally {
        pollInFlightRef.current = false;
        scheduleNext(nextDelayMs);
      }
    };

    if (initialDelayRef.current !== null) {
      const delay = initialDelayRef.current;
      initialDelayRef.current = null;
      scheduleNext(delay);
    } else {
      void runPoll();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeMap.mapId, activeQrWindow, applySnapshotSummary, isAppActive, isFocused, isMapLoaded]);

  const mapEndpoints = useMemo(() => {
    const filtered = endpoints.filter(
      (ep) => ep.active !== false && (!ep.mapId || ep.mapId === activeMap.mapId),
    );
    return filtered.length > 0 ? filtered : endpoints;
  }, [endpoints, activeMap.mapId]);

  const activeDestinationEndpoint = useMemo(() => {
    if (!planEndpointId && !planEndpointName) return undefined;
    return mapEndpoints.find(
      (ep) =>
        (planEndpointId &&
          (ep.endpointId === planEndpointId ||
            ep.endpointCode.toLowerCase() === planEndpointId.toLowerCase())) ||
        (planEndpointName &&
          (ep.endpointName || '').toLowerCase() === planEndpointName.toLowerCase()),
    );
  }, [mapEndpoints, planEndpointId, planEndpointName]);

  const activeDestinationLabel =
    planEndpointName ||
    activeDestinationEndpoint?.endpointName ||
    activeDestinationEndpoint?.endpointCode ||
    'Điểm đến';

  // Chỉ vẽ path thật khi Backend có navigationPlan (>= 2 điểm)
  const plannedPath: MapPlanPoint[] | null = useMemo(() => {
    return liveNavPlan && liveNavPlan.length >= 2 ? liveNavPlan : null;
  }, [liveNavPlan]);

  // Chỉ hiện banner hướng dẫn khi Backend có chỉ dẫn active hoặc có lộ trình thật
  const guidance: NavigationGuidanceResult | null = useMemo(() => {
    if (backendGuidance && backendGuidance.state !== 'IDLE') {
      return backendGuidance;
    }
    if (!plannedPath || plannedPath.length < 2) {
      return null;
    }
    return computeGuidance({
      planPoints: plannedPath,
      robotPose,
      destinationName: activeDestinationLabel,
      speedMps: 0.25,
      preferCm: true,
    });
  }, [backendGuidance, plannedPath, robotPose, activeDestinationLabel]);

  // Nút SOS hình tròn nổi (kéo thả tự do trên màn hình)
  const handleEmergencySos = useCallback(() => {
    const hasValidCoords =
      robotPose &&
      typeof robotPose.xM === 'number' &&
      !isNaN(robotPose.xM) &&
      typeof robotPose.yM === 'number' &&
      !isNaN(robotPose.yM);

    const hasActiveDestination = Boolean(plannedPath || (guidance && guidance.state !== 'IDLE'));
    const roomCode = hasActiveDestination ? activeDestinationEndpoint?.endpointCode : undefined;
    const roomName = hasActiveDestination ? activeDestinationLabel : undefined;

    console.log('[SOS] Tap nút CẤP CỨU SOS -> mở Emergency', {
      baseUrl: apiClient.getBaseUrl(),
      mapId: hasValidCoords && activeMap?.mapId ? activeMap.mapId : undefined,
      hasValidCoords,
      roomCode,
    });

    navigation.navigate('Emergency', {
      mapId: hasValidCoords && activeMap?.mapId ? activeMap.mapId : undefined,
      xM: hasValidCoords ? robotPose.xM : undefined,
      yM: hasValidCoords ? robotPose.yM : undefined,
      roomCode,
      roomName,
      destinationName: roomName,
    });
  }, [
    activeDestinationEndpoint?.endpointCode,
    activeDestinationLabel,
    activeMap?.mapId,
    guidance,
    navigation,
    plannedPath,
    robotPose,
  ]);

  const handleQrCompleteOrDismiss = useCallback((stepId: string | null) => {
    if (stepId) {
      handledQrStepIdsRef.current.add(stepId);
    }
    setActiveQrWindow(null);
  }, []);

  const hasActiveRoute = Boolean(plannedPath || (guidance && guidance.state !== 'IDLE'));
  const padTop = Math.max(insets.top, spacing.sm);
  const padBottom = Math.max(insets.bottom, spacing.sm);
  const padLeft = Math.max(insets.left, spacing.lg);
  const padRight = Math.max(insets.right, spacing.lg);

  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setRootBounds((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      }}
      style={[
        styles.landscapeRoot,
        {
          paddingTop: padTop,
          paddingBottom: padBottom,
          paddingLeft: padLeft,
          paddingRight: padRight,
        },
      ]}
    >
      {activeQrWindow ? (
        <QrStaffCameraOverlay
          jobId={activeQrWindow.jobId}
          authJobStepId={activeQrWindow.authJobStepId}
          stepCode={activeQrWindow.stepCode}
          purpose={activeQrWindow.purpose}
          expiresAt={activeQrWindow.expiresAt}
          active={isFocused && isAppActive}
          onSuccessComplete={handleQrCompleteOrDismiss}
          onDismiss={handleQrCompleteOrDismiss}
        />
      ) : (
        <>
          {/* ======================================================== */}
          {/* CỘT TRÁI: BẢN ĐỒ OTTO AMR CHỈ XEM VỊ TRÍ & PATH          */}
          {/* ======================================================== */}
          <View style={styles.landscapeMapColumn}>
            <View style={styles.mapCard}>
              <BackendHospitalMap
                interactive={false}
                skipImageFetch={!isMapLoaded}
                showEndpoints={false}
                map={activeMap}
                metadata={mapMetadata}
                endpoints={endpoints}
                zones={zones}
                presentation={presentationDoc}
                token={authToken}
                selectedEndpointId={hasActiveRoute ? planEndpointId : null}
                robotPose={robotPose}
                isPoseLive={isPoseLive}
                plannedPath={plannedPath}
                guidance={guidance}
              />
            </View>
          </View>

          {/* ======================================================== */}
          {/* CỘT PHẢI: TOÀN BỘ KHÔNG GIAN DÀNH CHO LỘ TRÌNH CHỈ ĐƯỜNG */}
          {/* ======================================================== */}
          <View style={styles.landscapeControlColumn}>
            <ScrollView
              style={styles.infoScroll}
              contentContainerStyle={styles.infoScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.infoCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.sectionIconSquare}>
                    <Ionicons name="trail-sign" size={16} color={colors.textInverse} />
                  </View>
                  <AppText variant="caption" style={styles.cardHeaderTitle}>
                    LỘ TRÌNH CHỈ ĐƯỜNG
                  </AppText>
                </View>

                {hasActiveRoute ? (
                  <View style={styles.routeActiveBox}>
                    <View style={styles.roomDetailBox}>
                      {activeDestinationEndpoint?.endpointCode ? (
                        <View style={styles.roomCodePill}>
                          <AppText style={styles.roomCodePillText}>
                            {activeDestinationEndpoint.endpointCode}
                          </AppText>
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }}>
                        <AppText variant="heading" style={styles.roomNameText} numberOfLines={2}>
                          {activeDestinationLabel}
                        </AppText>
                      </View>
                    </View>

                    {guidance ? (
                      <View style={styles.guidancePreviewBox}>
                        <View style={styles.guidanceDirectionRow}>
                          <View style={styles.guidanceSymbolBadge}>
                            <AppText style={styles.guidanceSymbolText}>
                              {guidance.state === 'ARRIVED'
                                ? '✓'
                                : guidanceSymbol(guidance.direction)}
                            </AppText>
                          </View>
                          <View style={{ flex: 1, gap: 4 }}>
                            <AppText style={styles.guidancePrimaryText}>
                              {guidance.primaryText}
                            </AppText>
                            {guidance.secondaryText ? (
                              <AppText variant="caption" style={styles.guidanceSecondaryText}>
                                {guidance.secondaryText}
                              </AppText>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.idleRouteNotice}>
                    <Ionicons name="eye-outline" size={20} color={colors.textSecondary} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <AppText style={styles.idleNoticeTitle}>Chưa có lộ trình chỉ đường</AppText>
                      <AppText variant="caption" style={styles.idleNoticeSub}>
                        Bản đồ đang hiển thị vị trí robot theo thời gian thực. Khi nhận nhiệm vụ dẫn đường hoặc giao hàng, lộ trình chỉ dẫn sẽ tự động hiện tại đây.
                      </AppText>
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        </>
      )}

      {/* Nút SOS hình tròn nổi, có thể kéo di chuyển tự do trên màn hình tablet */}
      <DraggableSosButton
        onPress={handleEmergencySos}
        boundsWidth={rootBounds.width}
        boundsHeight={rootBounds.height}
        insetTop={padTop}
        insetBottom={padBottom}
        insetLeft={padLeft}
        insetRight={padRight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  landscapeRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
    position: 'relative',
  },
  landscapeMapColumn: {
    flex: 2.3,
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
  infoScroll: {
    flex: 1,
  },
  infoScrollContent: {
    flexGrow: 1,
    paddingBottom: 92,
  },
  infoCard: {
    flex: 1,
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
    flexWrap: 'wrap',
  },
  sectionIconSquare: {
    width: 28,
    height: 28,
    borderRadius: radii.xs,
    backgroundColor: colors.heroSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderTitle: {
    flex: 1,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  routeActiveBox: {
    gap: spacing.md,
  },
  roomDetailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  roomCodePill: {
    backgroundColor: colors.heroSurface,
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
  guidancePreviewBox: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  guidanceDirectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  guidanceSymbolBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: '#0757A6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidanceSymbolText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  guidancePrimaryText: {
    color: '#1E3A8A',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  guidanceSecondaryText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '600',
  },
  idleRouteNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  idleNoticeTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  idleNoticeSub: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
});
