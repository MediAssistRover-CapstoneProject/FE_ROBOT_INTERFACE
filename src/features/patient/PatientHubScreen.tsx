import React, { useState, useEffect, useMemo } from 'react';
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
import { AppText, StatusChip } from '../../components/ui';
import {
  BackendHospitalMap,
  MapResponse,
  ZoneDto,
  EndpointResponse,
  MapRobotPose,
  MapPlanPoint,
} from '../../components/map/BackendHospitalMap';
import { robotApiService } from '../../services/api';
import { generateUuid } from '../../services/api/config';
import {
  computeGuidance,
  NavigationGuidanceResult,
} from '../navigation/navigationGuidance';
import {
  robotMapService,
  DEFAULT_HOSPITAL_MAP,
  DEFAULT_MAP_METADATA,
  DEFAULT_HOSPITAL_ZONES,
  DEFAULT_HOSPITAL_ENDPOINTS,
  DEFAULT_PRESENTATION_DOC,
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

  // 1. Dữ liệu Bản đồ Backend (Đồng bộ với Staff App & Web Admin Presentation Map)
  const [activeMap, setActiveMap] = useState<MapResponse>(DEFAULT_HOSPITAL_MAP);
  const [mapMetadata, setMapMetadata] = useState<Record<string, any>>(DEFAULT_MAP_METADATA);
  const [zones, setZones] = useState<ZoneDto[]>(DEFAULT_HOSPITAL_ZONES);
  const [endpoints, setEndpoints] = useState<EndpointResponse[]>(DEFAULT_HOSPITAL_ENDPOINTS);
  const [presentationDoc, setPresentationDoc] = useState<PresentationDocument | null>(
    DEFAULT_PRESENTATION_DOC
  );
  const [authToken, setAuthToken] = useState<string | null>(null);

  // 2. Tọa độ Robot AMR thời gian thực (Nav2 Telemetry)
  const [robotPose, setRobotPose] = useState<MapRobotPose | null>({
    xM: 0.15,
    yM: -0.26,
    yawRad: -1.92,
    fresh: true,
    mapId: DEFAULT_HOSPITAL_MAP.mapId,
  });
  const [isPoseLive, setIsPoseLive] = useState<boolean>(false);
  const [robotStatus, setRobotStatus] = useState<string>('IDLE');
  const [batteryPercent, setBatteryPercent] = useState<number>(85);

  // 3. Danh mục phòng khám & Lựa chọn điểm đến
  const [destinations] = useState<ClinicDestination[]>(DEFAULT_HOSPITAL_ROOMS);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    DEFAULT_HOSPITAL_ROOMS[0]?.id || 'room-01'
  );

  // 4. Trạng thái Dẫn đường (Escort) & Quỹ đạo Nav2
  const [isEscorting, setIsEscorting] = useState<boolean>(false);
  const [loadingEscort, setLoadingEscort] = useState<boolean>(false);
  const [isStoppingEscort, setIsStoppingEscort] = useState<boolean>(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [escortStatus, setEscortStatus] = useState<string>('IDLE');
  const [liveNavPlan, setLiveNavPlan] = useState<MapPlanPoint[] | null>(null);

  // 5. Trợ lý giọng nói & Báo động SOS
  const [isSendingVoice, setIsSendingVoice] = useState<boolean>(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [isTriggeringSos] = useState<boolean>(false);

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
        if (pkg.presentation) {
          setPresentationDoc(pkg.presentation);
        }
        setAuthToken(pkg.token);
      } catch (err) {
        console.warn('Lỗi khi tải map backend:', err);
      }
    }

    initMapData();

    // Polling telemetry robot và quỹ đạo Nav2 mỗi 1 giây (như Staff App)
    const pollTelemetry = async () => {
      try {
        const snap = await robotMapService.loadRobotSnapshot();
        if (!alive) return;
        if (snap.pose) {
          setRobotPose(snap.pose);
          setIsPoseLive(snap.isPoseLive);
        }
        setRobotStatus(snap.status);
        if (snap.batteryRaw) {
          const pct = Math.min(100, Math.max(10, Math.round(snap.batteryRaw / 100)));
          setBatteryPercent(pct);
        }
        if (snap.navigationPlan && snap.navigationPlan.length >= 2) {
          setLiveNavPlan(snap.navigationPlan);
        } else if (snap.status === 'IDLE' && !isEscorting) {
          setLiveNavPlan(null);
        }
      } catch {}
    };

    pollTelemetry();
    const timer = setInterval(pollTelemetry, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isEscorting]);

  const fallbackRoom = DEFAULT_HOSPITAL_ROOMS[0] as ClinicDestination;
  const selectedRoom: ClinicDestination =
    destinations.find((d) => d.id === selectedRoomId) || fallbackRoom;

  // Quỹ đạo Nav2 thật từ Backend
  const plannedPath: MapPlanPoint[] | null = useMemo(() => {
    if (liveNavPlan && liveNavPlan.length >= 2) {
      return liveNavPlan;
    }
    return null;
  }, [liveNavPlan]);

  // Realtime Navigation Guidance
  const guidance: NavigationGuidanceResult | null = useMemo(() => {
    if (!isEscorting) return null;
    return computeGuidance({
      planPoints: plannedPath || [],
      robotPose,
      destinationName: selectedRoom.name,
      speedMps: isPoseLive ? 0.25 : null,
    });
  }, [isEscorting, plannedPath, robotPose, selectedRoom.name, isPoseLive]);

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

  // Xử lý yêu cầu Robot dẫn đường (POST /api/v1/pi/requests/escort)
  const handleRequestEscort = async () => {
    setLoadingEscort(true);
    setVoiceFeedback(`Đang gửi yêu cầu dẫn bạn đến ${selectedRoom.name}...`);

    const matchEp =
      endpoints.find(
        (ep) => ep.endpointCode.toUpperCase() === selectedRoom.roomCode.toUpperCase()
      ) ||
      endpoints.find(
        (ep) => ep.endpointName?.toLowerCase().includes(selectedRoom.name.toLowerCase())
      ) ||
      endpoints[0];
    const destinationEndpointId =
      matchEp?.endpointId || '049204b7-cd5c-41b8-af99-1cd2797d796c';

    const reqKey = generateUuid();
    try {
      const escortRes = await robotApiService.requestEscort(
        {
          mapId: activeMap.mapId || DEFAULT_MAP_ID,
          destinationEndpointId,
          destinationRoomId:
            selectedRoom.id.includes('-') && selectedRoom.id.length === 36
              ? selectedRoom.id
              : undefined,
          targetMode: 'ENDPOINT',
          escortMode: 'GUIDED',
          walkingSpeedMps: 0.25,
          confirmationTimeoutSec: 60,
          escortNote: `Bệnh nhân yêu cầu dẫn đường đến ${selectedRoom.name}`,
          priority: 80,
        },
        reqKey,
      );

      const serviceRequestId = escortRes?.request?.serviceRequestId;
      if (serviceRequestId) {
        setActiveRequestId(serviceRequestId);
        setIsEscorting(true);
        setEscortStatus(escortRes.request?.status || 'SUBMITTED');
        setVoiceFeedback(`Robot đang bắt đầu dẫn bạn đến ${selectedRoom.name}...`);
        await robotApiService.sendHeartbeat('BUSY', batteryPercent * 100, activeMap.mapId).catch(() => {});
      } else {
        throw new Error('Máy chủ không trả về mã serviceRequestId');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Không thể bắt đầu dẫn đường', msg);
    } finally {
      setLoadingEscort(false);
    }
  };

  // Dừng dẫn đường qua POST /api/v1/pi/requests/{requestId}/cancel
  const handleCancelEscort = async () => {
    if (!activeRequestId) {
      setIsEscorting(false);
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

    navigation.navigate('Emergency', {
      mapId: hasValidCoords && activeMap?.mapId ? activeMap.mapId : undefined,
      xM: hasValidCoords ? robotPose.xM : undefined,
      yM: hasValidCoords ? robotPose.yM : undefined,
      roomCode: selectedRoom?.roomCode,
      roomName: selectedRoom?.name,
      destinationName: selectedRoom?.name,
    });
  };

  // Khi bấm trực tiếp vào một Endpoint hoặc Room trên bản đồ
  const handleSelectEndpoint = (ep: EndpointResponse) => {
    const epCode = (ep.endpointCode || '').toUpperCase();
    const match = destinations.find(
      (d) =>
        d.roomCode.toUpperCase() === epCode ||
        d.id === ep.endpointId ||
        d.id === `room-${epCode.toLowerCase()}` ||
        (ep.endpointName && d.name.toLowerCase().includes(ep.endpointName.toLowerCase()))
    );
    if (match) {
      setSelectedRoomId(match.id);
      setVoiceFeedback(`Đã chọn điểm đến: ${match.name} (${match.roomCode})`);
    } else {
      setVoiceFeedback(`Đã chọn điểm đến: ${ep.endpointName || ep.endpointCode}`);
    }
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
        {/* Header trên đầu bản đồ */}
        <View style={styles.mapTopHeader}>
          <View style={styles.mapTitleLeft}>
            <View style={styles.brandIconCircle}>
              <Ionicons name="medical" size={16} color={colors.textInverse} />
            </View>
            <View>
              <AppText variant="label" style={styles.mapMainTitle}>
                MediAssist Rover AMR
              </AppText>
              <AppText variant="caption" style={styles.mapSubTitle}>
                Bệnh viện Đa khoa Quốc tế
              </AppText>
            </View>
            <StatusChip
              label={isPoseLive ? 'LIVE NAV2' : 'BE HYBRID'}
              tone={isPoseLive ? 'success' : 'warning'}
              icon="radio-outline"
              size="sm"
            />
          </View>

          <View style={styles.mapHeaderRight}>
            <StatusChip
              label={`Pin ${batteryPercent}%`}
              tone="neutral"
              icon={batteryPercent > 20 ? 'battery-charging' : 'battery-dead'}
              size="sm"
            />
            <StatusChip
              label={`Đích: ${selectedRoom.roomCode}`}
              tone="neutral"
              icon="navigate"
              size="sm"
            />
          </View>
        </View>

        {/* Khung Bản đồ Card Trắng */}
        <View style={styles.mapCard}>
          <BackendHospitalMap
            map={activeMap}
            metadata={mapMetadata}
            endpoints={endpoints}
            zones={zones}
            presentation={presentationDoc}
            token={authToken}
            selectedEndpointId={selectedRoom.roomCode}
            onSelectEndpoint={handleSelectEndpoint}
            robotPose={robotPose}
            isPoseLive={isPoseLive}
            plannedPath={plannedPath}
            guidance={guidance}
            onStopEscort={handleCancelEscort}
            isStoppingEscort={isStoppingEscort}
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
              <AppText variant="caption" style={styles.cardHeaderTitle}>
                ĐIỂM ĐẾN ĐÃ CHỌN
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

          {/* 4. CHỌN NHANH ĐIỂM ĐẾN (QUICK ROOM SELECTOR) */}
          <View style={styles.quickRoomsCard}>
            <AppText variant="caption" style={styles.quickRoomsLabel}>
              CHỌN NHANH PHÒNG KHÁM
            </AppText>
            <View style={styles.quickRoomsRow}>
              {destinations.map((item) => {
                const isSelected = item.id === selectedRoomId;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Chọn phòng ${item.name}`}
                    onPress={() => {
                      setSelectedRoomId(item.id);
                      setVoiceFeedback(`Đã chọn: ${item.name} (${item.roomCode})`);
                    }}
                    style={({ pressed }) => [
                      styles.roomChip,
                      isSelected ? styles.roomChipSelected : styles.roomChipUnselected,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Ionicons
                      name="business-outline"
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
                      {item.roomCode}
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
  mapTopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  mapTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapMainTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 20,
  },
  mapSubTitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  mapHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
