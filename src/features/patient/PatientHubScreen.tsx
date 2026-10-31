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
import { AudioWaveform } from '../../components/AudioWaveform';
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
  queueNumber: string;
  estimatedWait: string;
  aheadCount: number;
}

// Bảng danh mục khoa phòng bệnh viện chuẩn (Hybrid Fallback khi Local DB rỗng)
const DEFAULT_HOSPITAL_ROOMS: ClinicDestination[] = [
  {
    id: 'room-102',
    roomCode: 'P. 102',
    name: 'Phòng Nội tổng hợp',
    category: 'clinic',
    doctor: 'BS. Nguyễn Thị Lan',
    location: 'Tầng 1 · Khu A · Phòng 102',
    eta: '~2 phút',
    distance: '~85m',
    queueNumber: 'B047',
    estimatedWait: 'Còn ~15 phút',
    aheadCount: 3,
  },
  {
    id: 'room-105',
    roomCode: 'P. 105',
    name: 'Phòng Khám Tim mạch',
    category: 'clinic',
    doctor: 'BS. CKII. Trần Văn Hùng',
    location: 'Tầng 1 · Khu A · Phòng 105',
    eta: '~3 phút',
    distance: '~120m',
    queueNumber: 'TM018',
    estimatedWait: 'Còn ~8 phút',
    aheadCount: 1,
  },
  {
    id: 'room-201',
    roomCode: 'P. 201',
    name: 'Xét nghiệm Máu & Sinh hóa',
    category: 'lab',
    doctor: 'KTV. Hoàng Minh Tuấn',
    location: 'Tầng 2 · Khu B · Phòng 201',
    eta: '~4 phút',
    distance: '~160m',
    queueNumber: 'XN102',
    estimatedWait: 'Còn ~5 phút',
    aheadCount: 2,
  },
  {
    id: 'room-108',
    roomCode: 'P. 108',
    name: 'Chẩn đoán hình ảnh (X-Quang, CT)',
    category: 'lab',
    doctor: 'BS. Lê Thị Mai',
    location: 'Tầng 1 · Khu C · Phòng 108',
    eta: '~3 phút',
    distance: '~110m',
    queueNumber: 'CDH09',
    estimatedWait: 'Còn ~12 phút',
    aheadCount: 4,
  },
  {
    id: 'room-pharm',
    roomCode: 'Nhà thuốc',
    name: 'Nhà thuốc Bệnh viện (Quầy 1-4)',
    category: 'pharmacy',
    doctor: 'Dược sĩ trực',
    location: 'Tầng trệt · Khu Trung tâm',
    eta: '~1.5 phút',
    distance: '~60m',
    queueNumber: 'D089',
    estimatedWait: 'Còn ~3 phút',
    aheadCount: 1,
  },
  {
    id: 'room-service',
    roomCode: 'Thu ngân',
    name: 'Quầy Thu viện phí & BHYT',
    category: 'service',
    doctor: 'Quầy thanh toán số 2',
    location: 'Tầng trệt · Sảnh đón tiếp',
    eta: '~1 phút',
    distance: '~40m',
    queueNumber: 'TN035',
    estimatedWait: 'Còn ~2 phút',
    aheadCount: 0,
  },
];

const DEFAULT_MAP_ID = 'dee53b44-a8ef-446a-947e-c42aa14ce9c2';

export function PatientHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [currentTime, setCurrentTime] = useState('19:49');
  const [currentDate, setCurrentDate] = useState('THỨ 4, 19/08/2026');

  // Danh mục phòng khám & Lựa chọn điểm đến
  const [destinations, setDestinations] = useState<ClinicDestination[]>(DEFAULT_HOSPITAL_ROOMS);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('room-102');
  const [activeCategory, setActiveCategory] = useState<'all' | 'clinic' | 'lab' | 'service'>('all');

  // Trạng thái Robot Escort (Dẫn đường)
  const [isEscorting, setIsEscorting] = useState<boolean>(false);
  const [escortStep, setEscortStep] = useState<number>(0);
  const [loadingEscort, setLoadingEscort] = useState<boolean>(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // Trạng thái Trợ lý giọng nói & Voice Commands
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [isSendingVoice, setIsSendingVoice] = useState<boolean>(false);

  // Trạng thái khẩn cấp SOS
  const [isTriggeringSos, setIsTriggeringSos] = useState<boolean>(false);

  // Live Local Backend API Connection Status & Inspector Console
  const [showApiConsole, setShowApiConsole] = useState<boolean>(false);
  const [apiStatus, setApiStatus] = useState<{
    connected: boolean;
    latencyMs: number;
    loading: boolean;
    lastCall?: string;
    lastResult?: string;
    serverUrl: string;
    robotCode: string;
    mapId: string;
  }>({
    connected: false,
    latencyMs: 0,
    loading: false,
    serverUrl: API_BASE_URL,
    robotCode: DEFAULT_ROBOT_CODE,
    mapId: DEFAULT_MAP_ID,
  });

  const escortIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Real-time Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);

      const days = ['CHỦ NHẬT', 'THỨ 2', 'THỨ 3', 'THỨ 4', 'THỨ 5', 'THỨ 6', 'THỨ 7'];
      const dayName = days[now.getDay()];
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      setCurrentDate(`${dayName}, ${day}/${month}/${year}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Public Rooms & Zones from Local Backend API on mount (Hybrid Mode)
  useEffect(() => {
    let alive = true;

    async function initCatalogAndPing() {
      // 1. Ping Server
      const ping = await robotApiService.pingServer();
      if (!alive) return;

      setApiStatus((prev) => ({
        ...prev,
        connected: ping.ok,
        latencyMs: ping.latencyMs,
        lastCall: 'GET /api/v1/public/zones',
        lastResult: ping.ok
          ? `200 OK (${ping.latencyMs}ms) · Server hoạt động`
          : ping.error || 'Mất kết nối máy chủ local (http://localhost:8080)',
      }));

      // 2. Fetch Public Rooms from Local Backend
      try {
        const roomsRes = await robotApiService.getPublicRooms(0, 50);
        if (alive && roomsRes && Array.isArray(roomsRes.content) && roomsRes.content.length > 0) {
          // Map backend rooms into ClinicDestination format
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
              eta: `~${2 + index} phút`,
              distance: `~${50 + index * 20}m`,
              queueNumber: `B0${40 + index}`,
              estimatedWait: `Còn ~${5 + index * 5} phút`,
              aheadCount: index + 1,
            };
          });
          if (mapped.length > 0 && mapped[0]) {
            setDestinations(mapped);
            setSelectedRoomId(mapped[0].id);
            setApiStatus((prev) => ({
              ...prev,
              lastCall: 'GET /api/v1/public/rooms',
              lastResult: `200 OK · Đã tải ${mapped.length} phòng khám từ máy chủ local`,
            }));
          }
        } else {
          // Live table is currently empty -> Smooth fallback
          setApiStatus((prev) => ({
            ...prev,
            lastCall: 'GET /api/v1/public/rooms',
            lastResult: '200 OK (0 items) · Chuyển sang Dữ liệu phòng khám Bệnh viện TW (Hybrid Mode)',
          }));
        }
      } catch (err) {
        // Safe hybrid fallback without interruption
        setApiStatus((prev) => ({
          ...prev,
          lastCall: 'GET /api/v1/public/rooms',
          lastResult: `Local Fallback: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    }

    initCatalogAndPing();
    return () => {
      alive = false;
      if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
    };
  }, []);

  // Selected room details (Luôn đảm bảo có giá trị phòng khám chuẩn)
  const fallbackRoom = DEFAULT_HOSPITAL_ROOMS[0] as ClinicDestination;
  const selectedRoom: ClinicDestination =
    destinations.find((d) => d.id === selectedRoomId) || fallbackRoom;

  // Filtered rooms
  const filteredRooms = destinations.filter((item) => {
    if (activeCategory === 'all') return true;
    if (activeCategory === 'clinic') return item.category === 'clinic';
    if (activeCategory === 'lab') return item.category === 'lab';
    if (activeCategory === 'service') return item.category === 'pharmacy' || item.category === 'service';
    return true;
  });

  // Escort Request (POST /api/v1/pi/requests/escort)
  const handleRequestEscort = async () => {
    setLoadingEscort(true);
    const reqId = `escort-${Date.now()}`;
    setActiveRequestId(reqId);

    try {
      // Send live Escort request to Local Backend
      const res = await robotApiService.requestEscort({
        mapId: DEFAULT_MAP_ID,
        destinationEndpointId: '370a77bb-02fd-4008-92f1-d11253a693ab',
        destinationRoomId: selectedRoom.id.includes('-') && selectedRoom.id.length === 36 ? selectedRoom.id : undefined,
        targetMode: 'ENDPOINT',
        escortMode: 'GUIDED',
        walkingSpeedMps: 0.25,
        confirmationTimeoutSec: 60,
        patientReference: selectedRoom.queueNumber,
        escortNote: `Bệnh nhân yêu cầu dẫn đường đến ${selectedRoom.name} (${selectedRoom.roomCode})`,
        priority: 80,
      });

      // Send busy telemetry heartbeat
      await robotApiService.sendHeartbeat('BUSY', 85, DEFAULT_MAP_ID);
      await robotApiService.sendLocation(14.2, 5.8, 0, DEFAULT_MAP_ID);

      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/requests/escort',
        lastResult: res ? JSON.stringify(res) : '200 OK · Yêu cầu dẫn đường đã được ghi nhận',
      }));
    } catch (err) {
      // Hybrid mode: If token is mock or secret is unrotated (401/409), log diagnostics and run local escort navigation
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/requests/escort',
        lastResult: `Hybrid Fallback: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setLoadingEscort(false);
      setIsEscorting(true);
      setEscortStep(1);

      // Start escort progression simulation
      if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
      escortIntervalRef.current = setInterval(() => {
        setEscortStep((prev) => {
          if (prev >= 4) {
            if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
            Alert.alert(
              'Đã đến nơi',
              `Robot đã dẫn bạn đến an toàn trước cửa ${selectedRoom.name} (${selectedRoom.roomCode}). Chúc bạn khám bệnh thuận lợi!`,
              [{ text: 'Hoàn thành', onPress: () => handleCancelEscort() }]
            );
            return 4;
          }
          return prev + 1;
        });
      }, 4000);
    }
  };

  // Cancel Escort Request (POST /api/v1/pi/requests/{requestId}/cancel)
  const handleCancelEscort = async () => {
    if (escortIntervalRef.current) clearInterval(escortIntervalRef.current);
    setIsEscorting(false);
    setEscortStep(0);

    try {
      if (activeRequestId) {
        await robotApiService.cancelRequest(activeRequestId, 'Bệnh nhân dừng yêu cầu dẫn đường');
      }
      await robotApiService.sendHeartbeat('IDLE', 84, DEFAULT_MAP_ID);
      setApiStatus((prev) => ({
        ...prev,
        lastCall: `POST /api/v1/pi/requests/${activeRequestId || 'escort-01'}/cancel`,
        lastResult: '200 OK · Đã hủy dẫn đường và chuyển robot về IDLE',
      }));
    } catch (err) {
      setApiStatus((prev) => ({
        ...prev,
        lastCall: 'POST /api/v1/pi/requests/cancel',
        lastResult: `Hybrid Cancel: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setActiveRequestId(null);
    }
  };

  // Voice Interaction (POST /api/v1/pi/voice/commands)
  const handleVoiceCommand = async (commandText: string, targetRoomMatch?: string) => {
    setIsSendingVoice(true);
    setVoiceFeedback(`Đang xử lý giọng nói: "${commandText}"...`);

    try {
      const res = await robotApiService.sendVoiceCommand(commandText);
      setApiStatus((prev) => ({
        ...prev,
        lastCall: 'POST /api/v1/pi/voice/commands',
        lastResult: JSON.stringify(res || { status: 'VOICE_COMMAND_ACK' }),
      }));
    } catch (err) {
      setApiStatus((prev) => ({
        ...prev,
        lastCall: 'POST /api/v1/pi/voice/commands',
        lastResult: `Hybrid Voice: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setIsSendingVoice(false);
      if (targetRoomMatch) {
        const found = destinations.find((d) => d.id === targetRoomMatch);
        if (found) {
          setSelectedRoomId(found.id);
          setVoiceFeedback(`🤖 MediRover: Đã hiểu! Đang chọn "${found.name}" cho bạn.`);
        }
      } else {
        setVoiceFeedback(`🤖 MediRover: Đã nhận lệnh "${commandText}". Vui lòng xem bản đồ bên dưới!`);
      }

      // Hide feedback after 5 seconds
      setTimeout(() => {
        setVoiceFeedback(null);
      }, 5000);
    }
  };

  // SOS Incident Trigger (POST /api/v1/pi/incidents/sos)
  const handleEmergencySos = async () => {
    setIsTriggeringSos(true);
    try {
      const res = await robotApiService.triggerSos(
        `Bệnh nhân nhấn nút Khẩn cấp tại PatientHubScreen (${selectedRoom.roomCode})`,
        'CRITICAL',
        14.2,
        5.8,
        DEFAULT_MAP_ID
      );
      setApiStatus((prev) => ({
        ...prev,
        lastCall: 'POST /api/v1/pi/incidents/sos',
        lastResult: JSON.stringify(res || { status: 'SOS_TRIGGERED' }),
      }));
    } catch (err) {
      setApiStatus((prev) => ({
        ...prev,
        lastCall: 'POST /api/v1/pi/incidents/sos',
        lastResult: `Hybrid SOS: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setIsTriggeringSos(false);
      navigation.navigate('Emergency');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 1. Header Bệnh viện & Hybrid API Connection Pill */}
      <View style={styles.hospitalHeader}>
        <View style={styles.headerLeft}>
          <AppText style={styles.hospitalOrg}>BỆNH VIỆN ĐA KHOA TRUNG ƯƠNG</AppText>
          <AppText style={styles.hospitalAppTitle}>MediAssistRover · Tiếp đón</AppText>

          {/* Connection Pill (Local API vs Hybrid) */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowApiConsole(!showApiConsole)}
            style={styles.connectionPill}
          >
            <View
              style={[
                styles.connectionDot,
                { backgroundColor: apiStatus.connected ? '#10B981' : '#F59E0B' },
              ]}
            />
            <AppText style={styles.connectionPillText}>
              {apiStatus.connected
                ? `Local Backend (${apiStatus.latencyMs}ms)`
                : 'Chế độ Hybrid Bệnh viện'}
            </AppText>
            <Ionicons
              name={showApiConsole ? 'chevron-up' : 'chevron-down'}
              size={12}
              color="#93C5FD"
            />
          </Pressable>
        </View>

        <View style={styles.headerRight}>
          <AppText style={styles.timeText}>{currentTime}</AppText>
          <AppText style={styles.dateText}>{currentDate}</AppText>
        </View>
      </View>

      {/* Collapsible API Inspector Console (Dành cho kiểm tra thực tế & đánh giá kỹ thuật) */}
      {showApiConsole && (
        <View style={styles.apiConsoleBox}>
          <View style={styles.apiConsoleHeader}>
            <Ionicons name="terminal-outline" size={14} color="#38BDF8" />
            <AppText style={styles.apiConsoleTitle}>NHẬT KÝ CALL API (HYBRID BACKEND CONTROLLER)</AppText>
            <Pressable onPress={() => setShowApiConsole(false)}>
              <Ionicons name="close" size={16} color="#94A3B8" />
            </Pressable>
          </View>

          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>MÁY CHỦ:</AppText>
            <AppText style={styles.apiConsoleVal}>{apiStatus.serverUrl}</AppText>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>THIẾT BỊ:</AppText>
            <AppText style={styles.apiConsoleVal}>
              {apiStatus.robotCode} · Map ID: {apiStatus.mapId.slice(0, 8)}...
            </AppText>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>GỌI GẦN NHẤT:</AppText>
            <AppText style={styles.apiConsoleEndpoint}>{apiStatus.lastCall || 'Chưa thực hiện'}</AppText>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>PHẢN HỒI:</AppText>
            <AppText style={styles.apiConsoleRes} numberOfLines={2}>
              {apiStatus.lastResult || 'Sẵn sàng'}
            </AppText>
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Voice Feedback Banner (Nếu bệnh nhân tương tác qua giọng nói) */}
        {voiceFeedback && (
          <View style={styles.voiceFeedbackToast}>
            <Ionicons name="mic-circle" size={20} color="#059669" />
            <AppText style={styles.voiceFeedbackText}>{voiceFeedback}</AppText>
          </View>
        )}

        {/* 2. CHỌN ĐIỂM ĐẾN KHÁM BỆNH (Tra cứu qua API /api/v1/public/rooms) */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionTitleWrap}>
            <Ionicons name="compass-outline" size={16} color="#0066CC" />
            <AppText style={styles.sectionTitle}>DANH MỤC PHÒNG KHÁM & DỊCH VỤ</AppText>
          </View>
          <AppText style={styles.sectionSubBadge}>API /public/rooms</AppText>
        </View>

        {/* Category Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesRow}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveCategory('all')}
            style={[styles.categoryChip, activeCategory === 'all' && styles.categoryChipActive]}
          >
            <AppText
              style={[
                styles.categoryChipText,
                activeCategory === 'all' && styles.categoryChipTextActive,
              ]}
            >
              Tất cả ({destinations.length})
            </AppText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveCategory('clinic')}
            style={[styles.categoryChip, activeCategory === 'clinic' && styles.categoryChipActive]}
          >
            <Ionicons
              name="medkit-outline"
              size={13}
              color={activeCategory === 'clinic' ? '#FFFFFF' : '#0066CC'}
            />
            <AppText
              style={[
                styles.categoryChipText,
                activeCategory === 'clinic' && styles.categoryChipTextActive,
              ]}
            >
              Phòng khám
            </AppText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveCategory('lab')}
            style={[styles.categoryChip, activeCategory === 'lab' && styles.categoryChipActive]}
          >
            <Ionicons
              name="flask-outline"
              size={13}
              color={activeCategory === 'lab' ? '#FFFFFF' : '#0066CC'}
            />
            <AppText
              style={[
                styles.categoryChipText,
                activeCategory === 'lab' && styles.categoryChipTextActive,
              ]}
            >
              Xét nghiệm
            </AppText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveCategory('service')}
            style={[styles.categoryChip, activeCategory === 'service' && styles.categoryChipActive]}
          >
            <Ionicons
              name="card-outline"
              size={13}
              color={activeCategory === 'service' ? '#FFFFFF' : '#0066CC'}
            />
            <AppText
              style={[
                styles.categoryChipText,
                activeCategory === 'service' && styles.categoryChipTextActive,
              ]}
            >
              Dược / Thu ngân
            </AppText>
          </Pressable>
        </ScrollView>

        {/* Destination Cards Horizontal Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomsCarousel}
        >
          {filteredRooms.map((room) => {
            const isSelected = room.id === selectedRoom.id;
            return (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                onPress={() => {
                  setSelectedRoomId(room.id);
                  if (isEscorting) {
                    Alert.alert(
                      'Đổi điểm đến',
                      `Bạn đã chuyển điểm đến sang ${room.name}. Robot sẽ thiết lập lại lộ trình dẫn đường.`,
                      [{ text: 'Đồng ý' }]
                    );
                    setEscortStep(1);
                  }
                }}
                style={[styles.roomCard, isSelected && styles.roomCardSelected]}
              >
                <View style={styles.roomCardTop}>
                  <View
                    style={[
                      styles.roomCodeBadge,
                      isSelected && styles.roomCodeBadgeSelected,
                    ]}
                  >
                    <AppText
                      style={[
                        styles.roomCodeText,
                        isSelected && styles.roomCodeTextSelected,
                      ]}
                    >
                      {room.roomCode}
                    </AppText>
                  </View>
                  <AppText style={styles.roomEtaText}>{room.eta}</AppText>
                </View>

                <AppText style={styles.roomCardTitle} numberOfLines={1}>
                  {room.name}
                </AppText>
                <AppText style={styles.roomCardDoctor} numberOfLines={1}>
                  {room.doctor}
                </AppText>

                <View style={styles.roomCardFooter}>
                  <Ionicons name="location-outline" size={12} color="#64748B" />
                  <AppText style={styles.roomCardLocation} numberOfLines={1}>
                    {room.location}
                  </AppText>
                </View>

                {isSelected && (
                  <View style={styles.selectedCheckPill}>
                    <Ionicons name="checkmark-circle" size={12} color="#0066CC" />
                    <AppText style={styles.selectedCheckText}>Đang chọn</AppText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 3. Thẻ Đang dẫn đường đến (Interactive Escort & Navigation Card) */}
        <View style={styles.navDestinationCard}>
          <View style={styles.navHeaderRow}>
            <View
              style={[
                styles.robotAvatarBox,
                isEscorting && { backgroundColor: '#059669', borderColor: '#A7F3D0' },
              ]}
            >
              <Ionicons
                name={isEscorting ? 'walk' : 'hardware-chip'}
                size={24}
                color="#FFFFFF"
              />
            </View>

            <View style={styles.navDestInfo}>
              <View style={styles.eyebrowRow}>
                <AppText
                  style={[
                    styles.navEyebrow,
                    isEscorting && { color: '#059669' },
                  ]}
                >
                  {isEscorting ? 'ROBOT ĐANG DẪN ĐƯỜNG' : 'ĐIỂM ĐẾN ĐÃ CHỌN'}
                </AppText>
                {isEscorting && (
                  <View style={styles.escortSpeedBadge}>
                    <View style={styles.pulsingGreenDot} />
                    <AppText style={styles.escortSpeedText}>0.25 m/s</AppText>
                  </View>
                )}
              </View>

              <AppText style={styles.navDestinationTitle}>{selectedRoom.name}</AppText>
              <AppText style={styles.navDestinationSub}>
                {selectedRoom.location} · {selectedRoom.doctor}
              </AppText>
            </View>
          </View>

          {/* Metric 2 cột: Ước tính & Khoảng cách */}
          <View style={styles.metricsRow}>
            <View style={styles.metricPill}>
              <View style={styles.metricIconWrap}>
                <Ionicons name="time-outline" size={16} color="#0066CC" />
              </View>
              <View>
                <AppText style={styles.metricLabel}>ƯỚC TÍNH</AppText>
                <AppText style={styles.metricValue}>
                  {isEscorting ? `~${Math.max(1, 4 - escortStep)} phút` : selectedRoom.eta}
                </AppText>
              </View>
            </View>

            <View style={styles.metricPill}>
              <View style={styles.metricIconWrap}>
                <Ionicons name="navigate-outline" size={16} color="#0066CC" />
              </View>
              <View>
                <AppText style={styles.metricLabel}>KHOẢNG CÁCH</AppText>
                <AppText style={styles.metricValue}>
                  {isEscorting
                    ? `~${Math.max(15, 85 - escortStep * 20)}m`
                    : selectedRoom.distance}
                </AppText>
              </View>
            </View>
          </View>

          {/* Escort Progression Steps Bar (Khi đang di chuyển) */}
          {isEscorting && (
            <View style={styles.escortProgressBarWrap}>
              <View style={styles.escortStepHeader}>
                <AppText style={styles.escortStatusText}>
                  {escortStep === 1 && '1. Robot bắt đầu xuất phát từ Sảnh chính...'}
                  {escortStep === 2 && '2. Đang qua ngã rẽ Hành lang Khu A...'}
                  {escortStep === 3 && '3. Đang tiến gần đến cửa phòng khám...'}
                  {escortStep >= 4 && '4. Đã đến nơi đích an toàn!'}
                </AppText>
                <AppText style={styles.escortPercentText}>
                  {Math.min(100, escortStep * 25)}%
                </AppText>
              </View>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, escortStep * 25)}%` },
                  ]}
                />
              </View>
              <AppText style={styles.escortSafetyNotice}>
                ⚠️ Quý khách vui lòng đi theo sau robot ở cự ly 1 - 2 mét.
              </AppText>
            </View>
          )}

          {/* Action Buttons: Yêu cầu dẫn đường (Escort) & Chỉ đường */}
          <View style={styles.actionButtonsRow}>
            {!isEscorting ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleRequestEscort}
                  disabled={loadingEscort}
                  style={({ pressed }) => [
                    styles.btnPrimaryEscort,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                  ]}
                >
                  {loadingEscort ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="walk" size={18} color="#FFFFFF" />
                      <AppText style={styles.btnPrimaryEscortText}>
                        Yêu cầu Robot dẫn đường (Escort) →
                      </AppText>
                    </>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('Destinations', { mode: 'directions' })}
                  style={styles.btnSecondaryDirections}
                >
                  <Ionicons name="map-outline" size={16} color="#0066CC" />
                  <AppText style={styles.btnSecondaryDirectionsText}>Xem lộ trình</AppText>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Alert.alert(
                    'Dừng dẫn đường?',
                    'Bạn có muốn dừng yêu cầu robot dẫn đường và chuyển robot về trạng thái chờ?',
                    [
                      { text: 'Tiếp tục đi', style: 'cancel' },
                      { text: 'Dừng lại', style: 'destructive', onPress: handleCancelEscort },
                    ]
                  );
                }}
                style={styles.btnCancelEscort}
              >
                <Ionicons name="stop-circle-outline" size={18} color="#DC2626" />
                <AppText style={styles.btnCancelEscortText}>
                  Hủy / Dừng dẫn đường (Cancel Escort)
                </AppText>
              </Pressable>
            )}
          </View>
        </View>

        {/* 4. Sơ đồ định vị trong bệnh viện (Cập nhật phòng đích theo thời gian thực) */}
        <View style={styles.mapCardContainer}>
          <View style={styles.mapHeaderRow}>
            <AppText style={styles.mapCardTitle}>SƠ ĐỒ ĐỊNH VỊ KHU KHÁM BỆNH</AppText>
            <AppText style={styles.mapTargetBadge}>
              Đích: {selectedRoom.roomCode}
            </AppText>
          </View>
          <IndoorHospitalMap
            targetRoom={selectedRoom.roomCode}
            targetSubText={selectedRoom.name.split(' ')[1] || 'Đích đến'}
          />
        </View>

        {/* 5. Thẻ Số thứ tự khám & Hàng đợi (Queue Card) */}
        <View style={styles.queueCard}>
          <View style={styles.queueMainRow}>
            <View style={styles.queueLeftCol}>
              <AppText style={styles.queueLabel}>SỐ THỨ TỰ CỦA BẠN</AppText>
              <AppText style={styles.queueBigNumber}>{selectedRoom.queueNumber}</AppText>
              <AppText style={styles.doctorText}>
                {selectedRoom.doctor} · {selectedRoom.roomCode}
              </AppText>
            </View>

            <View style={styles.queueRightCol}>
              <AppText style={styles.queueLabel}>GIỜ DỰ KIẾN</AppText>
              <AppText style={styles.appointmentTime}>09:30</AppText>
              <AppText style={styles.timeRemaining}>{selectedRoom.estimatedWait}</AppText>
              <AppText style={styles.currentServing}>Đang khám: B044</AppText>
            </View>
          </View>

          {/* Hàng đợi tiến độ */}
          <View style={styles.queueProgressRow}>
            <View style={styles.dotsGroup}>
              <View style={[styles.queueDot, styles.queueDotDone]}>
                <Ionicons name="checkmark" size={10} color="#FFFFFF" />
              </View>
              <View style={[styles.queueDot, styles.queueDotDone]}>
                <Ionicons name="checkmark" size={10} color="#FFFFFF" />
              </View>
              <View style={[styles.queueDot, styles.queueDotDone]}>
                <Ionicons name="checkmark" size={10} color="#FFFFFF" />
              </View>
              <View style={[styles.queueDot, styles.queueDotCurrent]}>
                <View style={styles.currentDotInner} />
              </View>
              <View style={[styles.queueDot, styles.queueDotPending]}>
                <Ionicons name="refresh-outline" size={10} color="#0284C7" />
              </View>
            </View>
            <AppText style={styles.aheadCountText}>
              Còn {selectedRoom.aheadCount} người trước bạn
            </AppText>
          </View>
        </View>

        {/* 6. Thanh Trợ lý giọng nói & Quick Voice Prompts (API /api/v1/pi/voice/commands) */}
        <View style={styles.voiceSectionWrap}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Assistant')}
            style={({ pressed }) => [
              styles.voiceBanner,
              pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
            ]}
          >
            <View style={styles.micCircle}>
              {isSendingVoice ? (
                <ActivityIndicator size="small" color="#009669" />
              ) : (
                <Ionicons name="mic" size={20} color="#009669" />
              )}
            </View>
            <View style={styles.voiceTextWrap}>
              <AppText style={styles.voiceTitle}>Trợ lý giọng nói MediRover</AppText>
              <AppText style={styles.voicePrompt} numberOfLines={1}>
                Chạm để nói hoặc nhấn câu lệnh mẫu bên dưới
              </AppText>
            </View>
            <AudioWaveform color="#FFFFFF" count={12} height={24} />
          </Pressable>

          {/* Quick Voice Command Chips (Mô phỏng STT & gọi API /api/v1/pi/voice/commands) */}
          <View style={styles.voiceSuggestionsRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                handleVoiceCommand('Dẫn tôi đến Phòng Tim mạch', 'room-105')
              }
              style={styles.voiceChip}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={12} color="#059669" />
              <AppText style={styles.voiceChipText}>"Dẫn tôi đến P. Tim mạch"</AppText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() =>
                handleVoiceCommand('Chỉ đường đến Nhà thuốc bệnh viện', 'room-pharm')
              }
              style={styles.voiceChip}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={12} color="#059669" />
              <AppText style={styles.voiceChipText}>"Đến Nhà thuốc"</AppText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() =>
                handleVoiceCommand('Tôi muốn làm xét nghiệm máu', 'room-201')
              }
              style={styles.voiceChip}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={12} color="#059669" />
              <AppText style={styles.voiceChipText}>"P. Xét nghiệm máu"</AppText>
            </Pressable>
          </View>
        </View>

        {/* 7. Hướng dẫn y tế */}
        <View style={styles.noticeCard}>
          <Ionicons name="information-circle" size={18} color="#D97706" style={styles.noticeIcon} />
          <AppText style={styles.noticeText}>
            <AppText style={styles.noticeHighlight}>Hướng dẫn khám bệnh: </AppText>
            Vui lòng chuẩn bị CCCD gắn chip và thẻ BHYT trước khi vào phòng khám. Khi robot dẫn
            đường, hãy luôn quan sát phía trước.
          </AppText>
        </View>

        {/* 8. Nút Khẩn cấp - Gọi hỗ trợ ngay (SOS - API /api/v1/pi/incidents/sos) */}
        <Pressable
          accessibilityRole="button"
          onPress={handleEmergencySos}
          disabled={isTriggeringSos}
          style={({ pressed }) => [
            styles.sosButton,
            pressed && { backgroundColor: '#B91C1C', transform: [{ scale: 0.99 }] },
          ]}
        >
          <View style={styles.sosIconCircle}>
            {isTriggeringSos ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <Ionicons name="megaphone" size={20} color="#DC2626" />
            )}
          </View>
          <View style={styles.sosTextWrap}>
            <AppText style={styles.sosTitle}>Khẩn cấp - Gọi Điều dưỡng (SOS)</AppText>
            <AppText style={styles.sosSubtitle}>
              Báo động tức thì vị trí robot đến phòng Điều dưỡng trực
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#FFFFFF" style={{ opacity: 0.8 }} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  hospitalHeader: {
    backgroundColor: colors.headerNavy,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
  },
  hospitalOrg: {
    color: '#93C5FD',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  hospitalAppTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  connectionPillText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#E0F2FE',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  timeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  dateText: {
    color: '#93C5FD',
    fontSize: 10,
    fontWeight: '600',
  },
  // API Console
  apiConsoleBox: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 4,
  },
  apiConsoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  apiConsoleTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.5,
  },
  apiConsoleRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  apiConsoleLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    width: 90,
  },
  apiConsoleVal: {
    fontSize: 9,
    color: '#E2E8F0',
    flex: 1,
    fontFamily: 'monospace',
  },
  apiConsoleEndpoint: {
    fontSize: 9,
    fontWeight: '700',
    color: '#34D399',
    flex: 1,
    fontFamily: 'monospace',
  },
  apiConsoleRes: {
    fontSize: 9,
    color: '#94A3B8',
    flex: 1,
    fontFamily: 'monospace',
  },
  scrollContent: {
    padding: 14,
    gap: 12,
    paddingBottom: 72,
  },
  voiceFeedbackToast: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceFeedbackText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
    flex: 1,
  },
  // Section Headers
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0066CC',
    letterSpacing: 0.5,
  },
  sectionSubBadge: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoriesRow: {
    gap: 6,
    paddingBottom: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  categoryChipActive: {
    backgroundColor: '#0066CC',
    borderColor: '#0066CC',
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  roomsCarousel: {
    gap: 10,
    paddingVertical: 2,
  },
  roomCard: {
    width: 170,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    gap: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  roomCardSelected: {
    borderColor: '#0066CC',
    backgroundColor: '#F0F7FF',
  },
  roomCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  roomCodeBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roomCodeBadgeSelected: {
    backgroundColor: '#0066CC',
  },
  roomCodeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
  },
  roomCodeTextSelected: {
    color: '#FFFFFF',
  },
  roomEtaText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  roomCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  roomCardDoctor: {
    fontSize: 10,
    color: '#64748B',
  },
  roomCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  roomCardLocation: {
    fontSize: 9,
    color: '#64748B',
    flex: 1,
  },
  selectedCheckPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  selectedCheckText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0066CC',
  },
  // Destination Card
  navDestinationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  navHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  robotAvatarBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0066CC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E0F2FE',
  },
  navDestInfo: {
    flex: 1,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0284C7',
    letterSpacing: 0.6,
  },
  escortSpeedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pulsingGreenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  escortSpeedText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#059669',
  },
  navDestinationTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  navDestinationSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F7FF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#D0E4FA',
  },
  metricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0066CC',
  },
  // Escort Progress
  escortProgressBarWrap: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  escortStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  escortStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    flex: 1,
  },
  escortPercentText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803D',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#DCFCE7',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#16A34A',
    borderRadius: 3,
  },
  escortSafetyNotice: {
    fontSize: 10,
    color: '#B45309',
    fontWeight: '600',
  },
  // Action Buttons
  actionButtonsRow: {
    gap: 8,
  },
  btnPrimaryEscort: {
    backgroundColor: '#0066CC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  btnPrimaryEscortText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  btnSecondaryDirections: {
    backgroundColor: '#F0F7FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFE2FE',
  },
  btnSecondaryDirectionsText: {
    color: '#0066CC',
    fontSize: 12,
    fontWeight: '700',
  },
  btnCancelEscort: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
  },
  btnCancelEscortText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '800',
  },
  // Map Container
  mapCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  mapHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  mapCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0066CC',
    letterSpacing: 0.5,
  },
  mapTargetBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  // Queue Card
  queueCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  queueMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  queueLeftCol: {
    flex: 1,
  },
  queueRightCol: {
    alignItems: 'flex-end',
  },
  queueLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  queueBigNumber: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0052CC',
    letterSpacing: -1,
    lineHeight: 42,
  },
  doctorText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
    marginTop: 2,
  },
  appointmentTime: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  timeRemaining: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  currentServing: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  queueProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  dotsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueDotDone: {
    backgroundColor: '#0066CC',
  },
  queueDotCurrent: {
    backgroundColor: '#BAE6FD',
  },
  currentDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0066CC',
  },
  queueDotPending: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  aheadCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  // Voice Section
  voiceSectionWrap: {
    gap: 8,
  },
  voiceBanner: {
    backgroundColor: colors.voiceGreen,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#009669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  micCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceTextWrap: {
    flex: 1,
  },
  voiceTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  voicePrompt: {
    color: '#D1FAE5',
    fontSize: 11,
    fontWeight: '500',
  },
  voiceSuggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  voiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  voiceChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#065F46',
  },
  // Notice
  noticeCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeIcon: {
    marginTop: 1,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
  },
  noticeHighlight: {
    fontWeight: '700',
    color: '#78350F',
  },
  // SOS
  sosButton: {
    backgroundColor: colors.danger,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  sosIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosTextWrap: {
    flex: 1,
  },
  sosTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  sosSubtitle: {
    color: '#FEE2E2',
    fontSize: 11,
  },
});
