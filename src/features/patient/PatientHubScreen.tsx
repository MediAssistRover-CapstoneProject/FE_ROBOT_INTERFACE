import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { colors } from '../../theme';
import { robotApiService } from '../../services/api';
import { DEFAULT_ROBOT_CODE } from '../../services/api/config';
import {
  robotMapService,
  DEFAULT_HOSPITAL_MAP,
  DEFAULT_MAP_METADATA,
  DEFAULT_HOSPITAL_ZONES,
  DEFAULT_HOSPITAL_ENDPOINTS,
} from '../../services/api/robotMapService';
import { ClinicDestination, DEFAULT_HOSPITAL_ROOMS, DEFAULT_MAP_ID } from './types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function PatientHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // 1. Dữ liệu Bản đồ Backend (Đồng bộ 100% với Staff App UI app)
  const [activeMap, setActiveMap] = useState<MapResponse>(DEFAULT_HOSPITAL_MAP);
  const [mapMetadata, setMapMetadata] = useState<Record<string, any>>(DEFAULT_MAP_METADATA);
  const [zones, setZones] = useState<ZoneDto[]>(DEFAULT_HOSPITAL_ZONES);
  const [endpoints, setEndpoints] = useState<EndpointResponse[]>(DEFAULT_HOSPITAL_ENDPOINTS);
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
  const [destinations, setDestinations] = useState<ClinicDestination[]>(DEFAULT_HOSPITAL_ROOMS);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('room-capcuu');

  // 4. Trạng thái Dẫn đường (Escort) & Quỹ đạo Nav2
  const [isEscorting, setIsEscorting] = useState<boolean>(false);
  const [escortStep, setEscortStep] = useState<number>(0);
  const [loadingEscort, setLoadingEscort] = useState<boolean>(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // 5. Trợ lý giọng nói & Báo động SOS
  const [isSendingVoice, setIsSendingVoice] = useState<boolean>(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [isTriggeringSos, setIsTriggeringSos] = useState<boolean>(false);

  const escortIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
        setAuthToken(pkg.token);
      } catch (err) {
        console.warn('Lỗi khi tải map backend:', err);
      }
    }

    initMapData();

    // Lặp polling telemetry robot mỗi 2 giây
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
      } catch {}
    };

    pollTelemetry();
    const timer = setInterval(pollTelemetry, 2000);

    return () => {
      alive = false;
      clearInterval(timer);
      if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
    };
  }, []);

  const fallbackRoom = DEFAULT_HOSPITAL_ROOMS[0] as ClinicDestination;
  const selectedRoom: ClinicDestination =
    destinations.find((d) => d.id === selectedRoomId) || fallbackRoom;

  // Quỹ đạo Nav2 phát sáng khi đang dẫn đường đến điểm đích
  const plannedPath: MapPlanPoint[] | null = useMemo(() => {
    if (!isEscorting || !robotPose) return null;
    const matchEp =
      endpoints.find((ep) => ep.endpointCode.toUpperCase() === selectedRoom.roomCode.toUpperCase()) ||
      endpoints[0];
    if (!matchEp || !Number.isFinite(Number(matchEp.xM))) return null;

    const midX = (robotPose.xM + Number(matchEp.xM)) / 2;
    const midY = (robotPose.yM + Number(matchEp.yM)) / 2 + 0.35;
    return [
      { xM: robotPose.xM, yM: robotPose.yM },
      { xM: midX, yM: midY },
      { xM: Number(matchEp.xM), yM: Number(matchEp.yM) },
    ];
  }, [endpoints, isEscorting, robotPose, selectedRoom.roomCode]);

  // Xử lý yêu cầu Robot dẫn đường (POST /api/v1/pi/requests/escort)
  const handleRequestEscort = async () => {
    setLoadingEscort(true);
    const reqId = `escort-${Date.now()}`;
    setActiveRequestId(reqId);
    setVoiceFeedback(`Robot đang bắt đầu dẫn bạn đến ${selectedRoom.name}...`);

    try {
      await robotApiService.requestEscort({
        mapId: activeMap.mapId || DEFAULT_MAP_ID,
        destinationEndpointId: '370a77bb-02fd-4008-92f1-d11253a693ab',
        destinationRoomId: selectedRoom.id.includes('-') && selectedRoom.id.length === 36 ? selectedRoom.id : undefined,
        targetMode: 'ENDPOINT',
        escortMode: 'GUIDED',
        walkingSpeedMps: 0.25,
        confirmationTimeoutSec: 60,
        escortNote: `Bệnh nhân yêu cầu dẫn đường đến ${selectedRoom.name}`,
        priority: 80,
      });

      await robotApiService.sendHeartbeat('BUSY', batteryPercent * 100, activeMap.mapId);
    } catch {} finally {
      setLoadingEscort(false);
      setIsEscorting(true);
      setEscortStep(1);

      if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
      escortIntervalRef.current = setInterval(() => {
        setEscortStep((prev) => {
          if (prev >= 4) {
            if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
            Alert.alert(
              'Đã đến nơi an toàn!',
              `Robot đã dẫn bạn đến trước cửa ${selectedRoom.name} (${selectedRoom.roomCode}). Chúc bạn khám bệnh thuận lợi!`,
              [{ text: 'Hoàn tất', onPress: () => handleCancelEscort() }]
            );
            return 4;
          }
          return prev + 1;
        });
      }, 4000);
    }
  };

  // Dừng dẫn đường
  const handleCancelEscort = async () => {
    if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
    setIsEscorting(false);
    setEscortStep(0);
    setVoiceFeedback(null);

    try {
      if (activeRequestId) {
        await robotApiService.cancelRequest(activeRequestId, 'Bệnh nhân dừng yêu cầu');
      }
      await robotApiService.sendHeartbeat('IDLE', batteryPercent * 100, activeMap.mapId);
    } catch {} finally {
      setActiveRequestId(null);
    }
  };

  // Bấm nút Hỏi Trợ lý giọng nói (Voice)
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

  // Bấm nút Cấp cứu khẩn cấp (SOS)
  const handleEmergencySos = async () => {
    setIsTriggeringSos(true);
    setVoiceFeedback('ĐÃ PHÁT TÍN HIỆU CẤP CỨU SOS ĐẾN TRẠM ĐIỀU DƯỠNG!');
    try {
      await robotApiService.triggerSos(
        `Bệnh nhân gọi cấp cứu SOS tại sảnh (${selectedRoom.roomCode})`,
        'CRITICAL',
        robotPose?.xM || 0.15,
        robotPose?.yM || -0.26,
        activeMap.mapId || DEFAULT_MAP_ID
      );
    } catch {} finally {
      setIsTriggeringSos(false);
      navigation.navigate('Emergency');
    }
  };

  // Khi bấm trực tiếp vào một Endpoint trên bản đồ
  const handleSelectEndpoint = (ep: EndpointResponse) => {
    const match = destinations.find(
      (d) => d.roomCode.toUpperCase() === ep.endpointCode.toUpperCase()
    );
    if (match) {
      setSelectedRoomId(match.id);
      setVoiceFeedback(`Đã chọn điểm đến: ${match.name} (${match.roomCode})`);
    } else {
      setVoiceFeedback(`Đã chọn điểm đến: ${ep.endpointName || ep.endpointCode}`);
    }
  };

  // ==========================================
  // RENDER GIAO DIỆN NẰM NGANG (LANDSCAPE: MAP 2/3 - CONTROL 1/3)
  // ==========================================
  if (isLandscape) {
    return (
      <View
        style={[
          styles.landscapeRoot,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: Math.max(insets.left, 12),
            paddingRight: Math.max(insets.right, 12),
          },
        ]}
      >
        {/* ======================================================== */}
        {/* CỘT TRÁI (2/3 CHIỀU NGANG): BẢN ĐỒ SLAM ROBOT CHUẨN STAFF */}
        {/* ======================================================== */}
        <View style={styles.landscapeMapColumn}>
          {/* Header thanh mảnh trên đầu bản đồ */}
          <View style={styles.mapTopHeader}>
            <View style={styles.mapTitleLeft}>
              <Ionicons name="hardware-chip-outline" size={16} color="#38BDF8" />
              <AppText style={styles.mapMainTitle}>MediAssist Rover AMR</AppText>
              <View style={styles.mapLiveBadge}>
                <View style={[styles.statusDot, { backgroundColor: isPoseLive ? '#10B981' : '#F59E0B' }]} />
                <AppText style={styles.mapLiveBadgeText}>
                  {isPoseLive ? 'LIVE NAV2' : 'BE HYBRID'}
                </AppText>
              </View>
            </View>

            <View style={styles.mapHeaderRight}>
              <View style={styles.targetPill}>
                <Ionicons name="pin" size={12} color="#0284C7" />
                <AppText style={styles.targetPillText}>Đích: {selectedRoom.roomCode}</AppText>
              </View>
            </View>
          </View>

          {/* Canvas Bản đồ chuẩn OTTO Fleet Manager */}
          <View style={styles.mapWrapper}>
            <BackendHospitalMap
              map={activeMap}
              metadata={mapMetadata}
              endpoints={endpoints}
              zones={zones}
              token={authToken}
              selectedEndpointId={selectedRoom.roomCode}
              onSelectEndpoint={handleSelectEndpoint}
              robotPose={robotPose}
              isPoseLive={isPoseLive}
              plannedPath={plannedPath}
            />
          </View>
        </View>

        {/* ======================================================== */}
        {/* CỘT PHẢI (1/3 CHIỀU NGANG): NÚT SOS, VOICE & HIỂN THỊ CHỮ */}
        {/* ======================================================== */}
        <View style={styles.landscapeControlColumn}>
          <ScrollView
            style={styles.controlScroll}
            contentContainerStyle={styles.controlScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 1. Header trạng thái Robot mini */}
            <View style={styles.miniStatusBar}>
              <View style={styles.miniRobotInfo}>
                <Ionicons name="navigate-circle" size={15} color="#38BDF8" />
                <AppText style={styles.miniRobotCode}>{DEFAULT_ROBOT_CODE}</AppText>
                <View style={styles.statusPillSmall}>
                  <AppText style={styles.statusPillSmallText}>
                    {isEscorting ? 'DẪN ĐƯỜNG' : robotStatus}
                  </AppText>
                </View>
              </View>

              <View style={styles.batteryPillSmall}>
                <Ionicons name="battery-charging" size={13} color="#10B981" />
                <AppText style={styles.batteryPillSmallText}>{batteryPercent}%</AppText>
              </View>
            </View>

            {/* 2. BỘ ĐÔI NÚT HÀNH ĐỘNG: SOS & VOICE */}
            <View style={styles.actionButtonsStack}>
              {/* NÚT CẤP CỨU SOS */}
              <Pressable
                accessibilityRole="button"
                onPress={handleEmergencySos}
                disabled={isTriggeringSos}
                style={({ pressed }) => [
                  styles.sosButtonBig,
                  pressed && { backgroundColor: '#B91C1C', transform: [{ scale: 0.98 }] },
                ]}
              >
                <View style={styles.sosIconCircleBig}>
                  {isTriggeringSos ? (
                    <ActivityIndicator size="small" color="#DC2626" />
                  ) : (
                    <Ionicons name="megaphone" size={20} color="#DC2626" />
                  )}
                </View>
                <View style={styles.actionTextCol}>
                  <AppText style={styles.sosTitleBig}>CẤP CỨU SOS</AppText>
                  <AppText style={styles.sosSubBig}>Gọi Điều dưỡng ngay</AppText>
                </View>
              </Pressable>

              {/* NÚT HỎI TRỢ LÝ (VOICE) */}
              <Pressable
                accessibilityRole="button"
                onPress={handleVoicePress}
                disabled={isSendingVoice}
                style={({ pressed }) => [
                  styles.voiceButtonBig,
                  pressed && { backgroundColor: '#047857', transform: [{ scale: 0.98 }] },
                ]}
              >
                <View style={styles.voiceIconCircleBig}>
                  {isSendingVoice ? (
                    <ActivityIndicator size="small" color="#059669" />
                  ) : (
                    <Ionicons name="mic" size={20} color="#059669" />
                  )}
                </View>
                <View style={styles.actionTextCol}>
                  <AppText style={styles.voiceTitleBig}>Hỏi Trợ lý (Voice)</AppText>
                  <AppText style={styles.voiceSubBig}>Nói để tìm đường</AppText>
                </View>
              </Pressable>
            </View>

            {/* 3. KHU VỰC HIỂN THỊ CHỮ (TEXT DISPLAY & THÔNG TIN HƯỚNG DẪN) */}
            <View style={styles.textDisplayCard}>
              <View style={styles.textDisplayHeader}>
                <Ionicons name="information-circle" size={15} color="#0284C7" />
                <AppText style={styles.textDisplayHeaderTitle}>THÔNG TIN & ĐIỂM ĐẾN</AppText>
              </View>

              {/* Dòng hiển thị phản hồi giọng nói hoặc hướng dẫn */}
              {voiceFeedback ? (
                <View style={styles.feedbackBanner}>
                  <Ionicons name="sparkles" size={13} color="#D97706" />
                  <AppText style={styles.feedbackBannerText}>{voiceFeedback}</AppText>
                </View>
              ) : null}

              {/* Thẻ phòng đã chọn */}
              <View style={styles.destinationBox}>
                <AppText style={styles.destinationNameText}>{selectedRoom.name}</AppText>
                <AppText style={styles.destinationDetailText}>
                  {selectedRoom.location} • {selectedRoom.distance} • {selectedRoom.eta}
                </AppText>
              </View>

              {/* Nút kích hoạt dẫn đường hoặc hủy dẫn đường */}
              {isEscorting ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleCancelEscort}
                  style={styles.cancelEscortBtn}
                >
                  <Ionicons name="stop-circle" size={16} color="#FFFFFF" />
                  <AppText style={styles.cancelEscortBtnText}>Hủy dẫn đường (Bước {escortStep}/4)</AppText>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleRequestEscort}
                  disabled={loadingEscort}
                  style={styles.startEscortBtn}
                >
                  {loadingEscort ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="walk" size={16} color="#FFFFFF" />
                      <AppText style={styles.startEscortBtnText}>Bắt đầu Dẫn đường</AppText>
                    </>
                  )}
                </Pressable>
              )}
            </View>

            {/* 4. CHỌN NHANH ĐIỂM ĐẾN (QUICK ROOM SELECTOR) */}
            <View style={styles.quickRoomsSection}>
              <AppText style={styles.quickRoomsLabel}>CHỌN NHANH ĐIỂM ĐẾN</AppText>
              <View style={styles.quickRoomsRow}>
                {destinations.slice(0, 6).map((item) => {
                  const isSelected = item.id === selectedRoomId;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setSelectedRoomId(item.id);
                        setVoiceFeedback(`Đã chọn: ${item.name} (${item.roomCode})`);
                      }}
                      style={[
                        styles.roomChip,
                        isSelected && styles.roomChipSelected,
                      ]}
                    >
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

  // ==========================================
  // RENDER DỰ PHÒNG KHI ĐIỆN THOẠI ĐẶT ĐỨNG (PORTRAIT)
  // ==========================================
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 1. Header Tinh gọn */}
      <View style={styles.portraitHeader}>
        <View style={styles.titleRow}>
          <Ionicons name="hardware-chip-outline" size={18} color="#38BDF8" />
          <AppText style={styles.robotTitle}>MediAssist Rover</AppText>
          <View style={styles.robotCodeBadge}>
            <AppText style={styles.robotCodeText}>{DEFAULT_ROBOT_CODE}</AppText>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.batteryPillSmall}>
            <Ionicons name="battery-charging" size={13} color="#10B981" />
            <AppText style={styles.batteryPillSmallText}>{batteryPercent}%</AppText>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.portraitScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner thông báo xoay ngang */}
        <View style={styles.rotateNoticeBanner}>
          <Ionicons name="phone-landscape-outline" size={16} color="#0284C7" />
          <AppText style={styles.rotateNoticeText}>
            Xoay ngang điện thoại để trải nghiệm giao diện Robot chuyên dụng (Map 2/3 - Nút 1/3)
          </AppText>
        </View>

        {/* Bản đồ SLAM */}
        <View style={styles.portraitMapWrapper}>
          <BackendHospitalMap
            map={activeMap}
            metadata={mapMetadata}
            endpoints={endpoints}
            zones={zones}
            token={authToken}
            selectedEndpointId={selectedRoom.roomCode}
            onSelectEndpoint={handleSelectEndpoint}
            robotPose={robotPose}
            isPoseLive={isPoseLive}
            plannedPath={plannedPath}
          />
        </View>

        {/* Bộ đôi Voice & SOS */}
        <View style={styles.portraitActionRow}>
          <Pressable
            onPress={handleVoicePress}
            style={[styles.voiceButtonBig, { flex: 1 }]}
          >
            <View style={styles.voiceIconCircleBig}>
              <Ionicons name="mic" size={18} color="#059669" />
            </View>
            <View style={styles.actionTextCol}>
              <AppText style={styles.voiceTitleBig}>Hỏi Trợ lý</AppText>
              <AppText style={styles.voiceSubBig}>Nói để tìm đường</AppText>
            </View>
          </Pressable>

          <Pressable
            onPress={handleEmergencySos}
            style={[styles.sosButtonBig, { flex: 1 }]}
          >
            <View style={styles.sosIconCircleBig}>
              <Ionicons name="megaphone" size={18} color="#DC2626" />
            </View>
            <View style={styles.actionTextCol}>
              <AppText style={styles.sosTitleBig}>CẤP CỨU SOS</AppText>
              <AppText style={styles.sosSubBig}>Gọi Điều dưỡng</AppText>
            </View>
          </Pressable>
        </View>

        {/* Thẻ hiển thị chữ */}
        <View style={[styles.textDisplayCard, { marginHorizontal: 12, marginTop: 12 }]}>
          <AppText style={styles.destinationNameText}>{selectedRoom.name}</AppText>
          <AppText style={styles.destinationDetailText}>
            {selectedRoom.location} • {selectedRoom.distance}
          </AppText>

          <Pressable
            onPress={isEscorting ? handleCancelEscort : handleRequestEscort}
            style={[styles.startEscortBtn, isEscorting && styles.cancelEscortBtn]}
          >
            <Ionicons name={isEscorting ? 'stop-circle' : 'walk'} size={16} color="#FFFFFF" />
            <AppText style={styles.startEscortBtnText}>
              {isEscorting ? 'Hủy dẫn đường' : 'Bắt đầu Dẫn đường'}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ==========================================
  // STYLES GIAO DIỆN NẰM NGANG (LANDSCAPE)
  // ==========================================
  landscapeRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0F172A',
  },
  // Cột trái: 2/3 chiều ngang
  landscapeMapColumn: {
    flex: 2,
    height: '100%',
    paddingRight: 8,
    justifyContent: 'flex-start',
  },
  mapTopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 4,
  },
  mapTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapMainTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  mapLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mapLiveBadgeText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '800',
  },
  mapHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  targetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(2, 132, 199, 0.2)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#0284C7',
  },
  targetPillText: {
    color: '#E0F2FE',
    fontSize: 9.5,
    fontWeight: '700',
  },
  mapWrapper: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
  },

  // Cột phải: 1/3 chiều ngang
  landscapeControlColumn: {
    flex: 1,
    height: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  controlScroll: {
    flex: 1,
  },
  controlScrollContent: {
    padding: 10,
    gap: 10,
  },

  // Mini status bar
  miniStatusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  miniRobotInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  miniRobotCode: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  statusPillSmall: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  statusPillSmallText: {
    color: '#10B981',
    fontSize: 8.5,
    fontWeight: '700',
  },
  batteryPillSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  batteryPillSmallText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '700',
  },

  // Nút hành động SOS và Voice
  actionButtonsStack: {
    gap: 8,
  },
  sosButtonBig: {
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  sosIconCircleBig: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextCol: {
    flex: 1,
  },
  sosTitleBig: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  sosSubBig: {
    color: '#FEE2E2',
    fontSize: 9.5,
    fontWeight: '500',
  },
  voiceButtonBig: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  voiceIconCircleBig: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceTitleBig: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  voiceSubBig: {
    color: '#D1FAE5',
    fontSize: 9.5,
    fontWeight: '500',
  },

  // Khu vực hiển thị chữ & thông tin hướng dẫn
  textDisplayCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 7,
  },
  textDisplayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  textDisplayHeaderTitle: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.3)',
  },
  feedbackBannerText: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '600',
    flex: 1,
  },
  destinationBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    padding: 8,
    borderRadius: 8,
  },
  destinationNameText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  destinationDetailText: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  startEscortBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  startEscortBtnText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  cancelEscortBtn: {
    backgroundColor: '#EA580C',
    borderRadius: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cancelEscortBtnText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },

  // Chọn nhanh phòng
  quickRoomsSection: {
    gap: 5,
  },
  quickRoomsLabel: {
    color: '#64748B',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  quickRoomsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  roomChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  roomChipSelected: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
  },
  roomChipText: {
    color: '#CBD5E1',
    fontSize: 9.5,
    fontWeight: '600',
  },
  roomChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // ==========================================
  // STYLES GIAO DIỆN ĐỨNG (PORTRAIT FALLBACK)
  // ==========================================
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  portraitHeader: {
    backgroundColor: colors.headerNavy,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  robotTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  robotCodeBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  robotCodeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scrollContainer: {
    flex: 1,
  },
  portraitScrollContent: {
    paddingBottom: 24,
  },
  rotateNoticeBanner: {
    margin: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(2, 132, 199, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(2, 132, 199, 0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rotateNoticeText: {
    color: '#0369A1',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  portraitMapWrapper: {
    marginHorizontal: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  portraitActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 10,
    marginTop: 12,
  },
});
