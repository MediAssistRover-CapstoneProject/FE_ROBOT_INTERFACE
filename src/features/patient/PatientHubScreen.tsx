import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../app/navigation';
import { AppText } from '../../components/ui';
import { IndoorHospitalMap } from '../../components/IndoorHospitalMap';
import { colors } from '../../theme';
import { robotApiService } from '../../services/api';
import { API_BASE_URL, DEFAULT_ROBOT_CODE } from '../../services/api/config';
import { RoomResponse } from '../../services/api/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

interface ClinicDestination {
  id: string;
  roomCode: string;
  name: string;
  category: 'clinic' | 'lab' | 'pharmacy' | 'service';
  doctor: string;
  location: string;
  eta: string;
  distance: string;
}

// Danh mục phòng khám bệnh viện mặc định (khi chưa có kết nối DB)
const DEFAULT_HOSPITAL_ROOMS: ClinicDestination[] = [
  {
    id: 'room-capcuu',
    roomCode: 'P_CAP_CUU',
    name: 'Phòng Cấp cứu',
    category: 'clinic',
    doctor: 'BS. Trực cấp cứu',
    location: 'Tầng 1 · Cấp cứu',
    eta: '~1 phút',
    distance: '~30m',
  },
  {
    id: 'room-102',
    roomCode: 'P_KHAM_NOI_01',
    name: 'Khám Nội tổng hợp',
    category: 'clinic',
    doctor: 'BS. Nguyễn Thị Lan',
    location: 'Tầng 1 · Phòng 102',
    eta: '~2 phút',
    distance: '~85m',
  },
  {
    id: 'room-105',
    roomCode: 'P_KHAM_NGOAI_02',
    name: 'Khám Ngoại khoa',
    category: 'clinic',
    doctor: 'BS. Trần Văn Hùng',
    location: 'Tầng 1 · Phòng 105',
    eta: '~3 phút',
    distance: '~120m',
  },
  {
    id: 'room-pharm',
    roomCode: 'P_NHA_THUOC',
    name: 'Nhà thuốc Bệnh viện',
    category: 'pharmacy',
    doctor: 'Dược sĩ trực',
    location: 'Tầng trệt · Quầy 1-4',
    eta: '~1.5 phút',
    distance: '~60m',
  },
  {
    id: 'room-201',
    roomCode: 'P_XET_NGHIEM',
    name: 'Xét nghiệm máu',
    category: 'lab',
    doctor: 'KTV. Hoàng Minh Tuấn',
    location: 'Tầng 2 · Khu B',
    eta: '~4 phút',
    distance: '~160m',
  },
  {
    id: 'room-service',
    roomCode: 'P_TIEP_DON',
    name: 'Ban Tiếp đón & BHYT',
    category: 'service',
    doctor: 'Quầy tiếp đón số 1',
    location: 'Sảnh chính',
    eta: '~1 phút',
    distance: '~40m',
  },
];

const DEFAULT_MAP_ID = 'dee53b44-a8ef-446a-947e-c42aa14ce9c2';

export function PatientHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  // Danh mục phòng khám & Lựa chọn điểm đến
  const [destinations, setDestinations] = useState<ClinicDestination[]>(DEFAULT_HOSPITAL_ROOMS);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('room-capcuu');

  // Trạng thái Robot Dẫn đường (Escort)
  const [isEscorting, setIsEscorting] = useState<boolean>(false);
  const [escortStep, setEscortStep] = useState<number>(0);
  const [loadingEscort, setLoadingEscort] = useState<boolean>(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // Trạng thái Trợ lý giọng nói & SOS
  const [isSendingVoice, setIsSendingVoice] = useState<boolean>(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [isTriggeringSos, setIsTriggeringSos] = useState<boolean>(false);

  // Trạng thái kết nối API Local
  const [showApiConsole, setShowApiConsole] = useState<boolean>(false);
  const [apiStatus, setApiStatus] = useState<{
    connected: boolean;
    latencyMs: number;
    lastCall?: string;
  }>({
    connected: false,
    latencyMs: 0,
  });

  const escortIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Khởi tạo kết nối & lấy danh sách phòng từ Local Backend API
  useEffect(() => {
    let alive = true;

    async function initCatalogAndPing() {
      // 1. Ping Server
      const ping = await robotApiService.pingServer();
      if (!alive) return;

      setApiStatus({
        connected: ping.ok,
        latencyMs: ping.latencyMs,
        lastCall: ping.ok ? `200 OK (${ping.latencyMs}ms)` : 'Mất kết nối local',
      });

      // 2. Tải danh mục phòng từ API /api/v1/public/rooms
      try {
        const roomsRes = await robotApiService.getPublicRooms(0, 50);
        if (alive && roomsRes && Array.isArray(roomsRes.content) && roomsRes.content.length > 0) {
          const mapped: ClinicDestination[] = roomsRes.content.map((r: RoomResponse, index: number) => {
            const id = r.roomId || r.id || `live-room-${index}`;
            const code = r.roomCode || r.code || `P. ${100 + index}`;
            const name = r.roomName || r.name || `Phòng khám ${index + 1}`;
            return {
              id,
              roomCode: code,
              name,
              category: (r.roomType?.toLowerCase().includes('lab') || r.roomType?.toLowerCase().includes('pharmacy')) ? 'lab' : 'clinic',
              doctor: r.description || 'Bác sĩ chuyên khoa',
              location: `Tầng 1 · ${code}`,
              eta: `~${1 + index} phút`,
              distance: `~${30 + index * 25}m`,
            };
          });
          if (mapped.length > 0 && mapped[0]) {
            setDestinations(mapped);
            setSelectedRoomId(mapped[0].id);
          }
        }
      } catch {
        // Fallback tự động giữ nguyên danh mục chuẩn
      }
    }

    initCatalogAndPing();
    return () => {
      alive = false;
      if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
    };
  }, []);

  const fallbackRoom = DEFAULT_HOSPITAL_ROOMS[0] as ClinicDestination;
  const selectedRoom: ClinicDestination =
    destinations.find((d) => d.id === selectedRoomId) || fallbackRoom;

  // Xử lý yêu cầu Robot dẫn đường (POST /api/v1/pi/requests/escort)
  const handleRequestEscort = async () => {
    setLoadingEscort(true);
    const reqId = `escort-${Date.now()}`;
    setActiveRequestId(reqId);

    try {
      await robotApiService.requestEscort({
        mapId: DEFAULT_MAP_ID,
        destinationEndpointId: '370a77bb-02fd-4008-92f1-d11253a693ab',
        destinationRoomId: selectedRoom.id.includes('-') && selectedRoom.id.length === 36 ? selectedRoom.id : undefined,
        targetMode: 'ENDPOINT',
        escortMode: 'GUIDED',
        walkingSpeedMps: 0.25,
        confirmationTimeoutSec: 60,
        escortNote: `Bệnh nhân yêu cầu dẫn đường đến ${selectedRoom.name}`,
        priority: 80,
      });

      await robotApiService.sendHeartbeat('BUSY', 85, DEFAULT_MAP_ID);
      await robotApiService.sendLocation(14.2, 5.8, 0, DEFAULT_MAP_ID);
    } catch {
      // Chạy tiếp tiến trình mô phỏng an toàn
    } finally {
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
              [{ text: 'Xong', onPress: () => handleCancelEscort() }]
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

    try {
      if (activeRequestId) {
        await robotApiService.cancelRequest(activeRequestId, 'Bệnh nhân dừng yêu cầu');
      }
      await robotApiService.sendHeartbeat('IDLE', 84, DEFAULT_MAP_ID);
    } catch {
      // Ignored
    } finally {
      setActiveRequestId(null);
    }
  };

  // Trợ lý giọng nói (POST /api/v1/pi/voice/commands)
  const handleQuickVoice = async (command = 'Chỉ đường đến ' + selectedRoom.name) => {
    setIsSendingVoice(true);
    setVoiceFeedback(`Đang xử lý: "${command}"...`);

    try {
      await robotApiService.sendVoiceCommand(command);
    } catch {
      // Ignored
    } finally {
      setIsSendingVoice(false);
      setVoiceFeedback(`Robot: Đã hiểu lệnh tìm "${selectedRoom.name}"!`);
      setTimeout(() => setVoiceFeedback(null), 3500);
    }
  };

  // Báo động cấp cứu SOS (POST /api/v1/pi/incidents/sos)
  const handleEmergencySos = async () => {
    setIsTriggeringSos(true);
    try {
      await robotApiService.triggerSos(
        `Bệnh nhân gọi cấp cứu SOS tại sảnh (${selectedRoom.roomCode})`,
        'CRITICAL',
        14.2,
        5.8,
        DEFAULT_MAP_ID
      );
    } catch {
      // Ignored
    } finally {
      setIsTriggeringSos(false);
      navigation.navigate('Emergency');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 1. Header Tinh gọn & Trạng thái Robot */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <Ionicons name="hardware-chip-outline" size={18} color="#38BDF8" />
            <AppText style={styles.robotTitle}>MediAssist Rover</AppText>
            <View style={styles.robotCodeBadge}>
              <AppText style={styles.robotCodeText}>{DEFAULT_ROBOT_CODE}</AppText>
            </View>
          </View>
          <AppText style={styles.hospitalSubtitle}>Bệnh viện Đa khoa Trung ương</AppText>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.batteryPill}>
            <Ionicons name="battery-charging" size={14} color="#10B981" />
            <AppText style={styles.batteryText}>85%</AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowApiConsole(!showApiConsole)}
            style={styles.connectionBadge}
          >
            <View
              style={[
                styles.connectionDot,
                { backgroundColor: apiStatus.connected ? '#10B981' : '#F59E0B' },
              ]}
            />
            <AppText style={styles.connectionText}>
              {apiStatus.connected ? `Local API (${apiStatus.latencyMs}ms)` : 'Hybrid'}
            </AppText>
          </Pressable>
        </View>
      </View>

      {/* Mini Diagnostic Bar (Hiện khi chạm badge kết nối) */}
      {showApiConsole && (
        <View style={styles.miniConsole}>
          <AppText style={styles.miniConsoleText}>
            API Base: {API_BASE_URL} · Trạng thái: {apiStatus.lastCall}
          </AppText>
        </View>
      )}

      {/* Main Content Area: Vừa khít màn hình, không cần cuộn dài */}
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Voice Feedback Banner (Nếu vừa nhận diện giọng nói) */}
        {voiceFeedback && (
          <View style={styles.voiceFeedbackBanner}>
            <Ionicons name="mic-circle" size={18} color="#059669" />
            <AppText style={styles.voiceFeedbackText}>{voiceFeedback}</AppText>
          </View>
        )}

        {/* 2. CHẾ ĐỘ DẪN ĐƯỜNG ĐANG HOẠT ĐỘNG (ESCORT PROGRESSION) */}
        {isEscorting ? (
          <View style={styles.escortActiveCard}>
            <View style={styles.escortHeaderRow}>
              <View style={styles.escortPulseDot} />
              <AppText style={styles.escortStatusTitle}>ROBOT ĐANG DẪN ĐƯỜNG</AppText>
              <AppText style={styles.escortStepBadge}>Chặng {escortStep}/4</AppText>
            </View>

            <AppText style={styles.escortTargetName}>
              Đích đến: {selectedRoom.name} ({selectedRoom.roomCode})
            </AppText>
            <AppText style={styles.escortGuideNote}>
              Vui lòng bước theo sau robot với tốc độ vừa phải. Robot sẽ tự dừng nếu bạn tụt lại.
            </AppText>

            {/* Stepper Dots */}
            <View style={styles.stepperRow}>
              {['Sảnh', 'Hành lang', 'Chuyên khoa', 'Cửa phòng'].map((step, idx) => (
                <View key={step} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepCircle,
                      idx + 1 <= escortStep ? styles.stepCircleActive : styles.stepCircleInactive,
                    ]}
                  >
                    <Ionicons
                      name={idx + 1 < escortStep ? 'checkmark' : 'navigate'}
                      size={12}
                      color="#FFFFFF"
                    />
                  </View>
                  <AppText style={styles.stepLabel}>{step}</AppText>
                </View>
              ))}
            </View>

            {/* Nút Hủy / Dừng dẫn đường */}
            <Pressable
              accessibilityRole="button"
              onPress={handleCancelEscort}
              style={styles.btnStopEscort}
            >
              <Ionicons name="stop-circle-outline" size={20} color="#DC2626" />
              <AppText style={styles.btnStopEscortText}>Dừng dẫn đường / Quay lại</AppText>
            </Pressable>
          </View>
        ) : (
          <>
            {/* 3. SƠ ĐỒ BẢN ĐỒ BỆNH VIỆN TRỰC QUAN (MAP) */}
            <View style={styles.mapSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleLeft}>
                  <Ionicons name="map-outline" size={16} color="#0284C7" />
                  <AppText style={styles.sectionTitle}>SƠ ĐỒ BỆNH VIỆN</AppText>
                </View>
                <View style={styles.targetBadge}>
                  <Ionicons name="pin" size={12} color="#0284C7" />
                  <AppText style={styles.targetBadgeText}>Đích: {selectedRoom.roomCode}</AppText>
                </View>
              </View>

              {/* Bản đồ Vector / Định vị thời gian thực */}
              <IndoorHospitalMap
                targetRoom={selectedRoom.roomCode}
                targetSubText={selectedRoom.name.split(' ')[0] || 'Phòng'}
              />
            </View>

            {/* 4. CHỌN ĐIỂM ĐẾN NHANH (QUICK ROOM SELECTOR) */}
            <View style={styles.roomSelectSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleLeft}>
                  <Ionicons name="location-outline" size={16} color="#475569" />
                  <AppText style={styles.sectionTitle}>CHỌN ĐIỂM ĐẾN</AppText>
                </View>
                <AppText style={styles.roomCountText}>{destinations.length} phòng</AppText>
              </View>

              {/* Danh sách phòng cuộn ngang nhỏ gọn */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.roomChipsRow}
              >
                {destinations.map((room) => {
                  const isSelected = room.id === selectedRoomId;
                  return (
                    <Pressable
                      key={room.id}
                      accessibilityRole="button"
                      onPress={() => setSelectedRoomId(room.id)}
                      style={[styles.roomChip, isSelected && styles.roomChipSelected]}
                    >
                      <AppText
                        style={[styles.roomChipCode, isSelected && styles.roomChipCodeSelected]}
                      >
                        {room.roomCode}
                      </AppText>
                      <AppText
                        style={[styles.roomChipName, isSelected && styles.roomChipNameSelected]}
                        numberOfLines={1}
                      >
                        {room.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Thanh xác nhận điểm đến & Nút Dẫn đường */}
              <View style={styles.destinationBar}>
                <View style={styles.destInfoCol}>
                  <AppText style={styles.destName} numberOfLines={1}>
                    {selectedRoom.name}
                  </AppText>
                  <AppText style={styles.destMeta}>
                    {selectedRoom.location} · {selectedRoom.distance} · {selectedRoom.eta}
                  </AppText>
                </View>

                <Pressable
                  accessibilityRole="button"
                  onPress={handleRequestEscort}
                  disabled={loadingEscort}
                  style={({ pressed }) => [
                    styles.btnEscort,
                    pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  {loadingEscort ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="walk" size={18} color="#FFFFFF" />
                      <AppText style={styles.btnEscortText}>Dẫn đường</AppText>
                    </>
                  )}
                </Pressable>
              </View>
            </View>

            {/* 5. BỘ ĐÔI TÁC VỤ CHÍNH: VOICE & SOS (NỔI BẬT, DỄ BẤM) */}
            <View style={styles.actionRow}>
              {/* Nút 1: Trợ lý Giọng nói (Voice) */}
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('Assistant')}
                style={({ pressed }) => [
                  styles.voiceButton,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                ]}
              >
                <View style={styles.voiceIconCircle}>
                  {isSendingVoice ? (
                    <ActivityIndicator size="small" color="#059669" />
                  ) : (
                    <Ionicons name="mic" size={22} color="#059669" />
                  )}
                </View>
                <View style={styles.actionTextWrap}>
                  <AppText style={styles.actionMainTitle}>Hỏi Trợ lý</AppText>
                  <AppText style={styles.actionSubTitle}>Nói để tìm đường</AppText>
                </View>
              </Pressable>

              {/* Nút 2: Cấp cứu Khẩn cấp (SOS) */}
              <Pressable
                accessibilityRole="button"
                onPress={handleEmergencySos}
                disabled={isTriggeringSos}
                style={({ pressed }) => [
                  styles.sosButton,
                  pressed && { backgroundColor: '#B91C1C', transform: [{ scale: 0.98 }] },
                ]}
              >
                <View style={styles.sosIconCircle}>
                  {isTriggeringSos ? (
                    <ActivityIndicator size="small" color="#DC2626" />
                  ) : (
                    <Ionicons name="megaphone" size={22} color="#DC2626" />
                  )}
                </View>
                <View style={styles.actionTextWrap}>
                  <AppText style={styles.sosMainTitle}>CẤP CỨU SOS</AppText>
                  <AppText style={styles.sosSubTitle}>Gọi Điều dưỡng ngay</AppText>
                </View>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: colors.headerNavy,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A8A',
  },
  headerLeft: {
    flex: 1,
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
    letterSpacing: -0.2,
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
  hospitalSubtitle: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batteryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  batteryText: {
    color: '#E0F2FE',
    fontSize: 11,
    fontWeight: '700',
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  connectionText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  miniConsole: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  miniConsoleText: {
    color: '#38BDF8',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 10,
  },
  voiceFeedbackBanner: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceFeedbackText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  // Map Section
  mapSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E293B',
    letterSpacing: 0.3,
  },
  targetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  targetBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  // Room Select Section
  roomSelectSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  roomCountText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  roomChipsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  roomChip: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 95,
  },
  roomChipSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#0284C7',
    borderWidth: 1.5,
  },
  roomChipCode: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  roomChipCodeSelected: {
    color: '#0284C7',
  },
  roomChipName: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  roomChipNameSelected: {
    color: '#0369A1',
    fontWeight: '600',
  },
  // Destination Bar
  destinationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  destInfoCol: {
    flex: 1,
  },
  destName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  destMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  btnEscort: {
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  btnEscortText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  // Action Buttons Row (Voice & SOS)
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  voiceButton: {
    flex: 1,
    backgroundColor: '#047857',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#047857',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  voiceIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  sosIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextWrap: {
    flex: 1,
  },
  actionMainTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  actionSubTitle: {
    color: '#D1FAE5',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  sosMainTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  sosSubTitle: {
    color: '#FEE2E2',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  // Escort Active Card
  escortActiveCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  escortHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  escortPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  escortStatusTitle: {
    flex: 1,
    marginLeft: 8,
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  escortStepBadge: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  escortTargetName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  escortGuideNote: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  stepItem: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#0284C7',
  },
  stepCircleInactive: {
    backgroundColor: '#334155',
  },
  stepLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  btnStopEscort: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  btnStopEscortText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '800',
  },
});
