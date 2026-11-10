import React, { useState, useEffect, useRef } from 'react';
import {
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
import { ClinicDestination, DEFAULT_HOSPITAL_ROOMS, DEFAULT_MAP_ID } from './types';
import { QuickRoomSelector } from './components/QuickRoomSelector';
import { VoiceSosActionRow } from './components/VoiceSosActionRow';
import { EscortProgressBanner } from './components/EscortProgressBanner';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

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
      const ping = await robotApiService.pingServer();
      if (!alive) return;

      setApiStatus({
        connected: ping.ok,
        latencyMs: ping.latencyMs,
        lastCall: ping.ok ? `200 OK (${ping.latencyMs}ms)` : 'Mất kết nối local',
      });

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
      // Chạy tiếp tiến trình an toàn
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
  const handleVoicePress = async () => {
    setIsSendingVoice(true);
    setVoiceFeedback(`Đang tra cứu trợ lý giọng nói...`);

    try {
      await robotApiService.sendVoiceCommand('Chỉ đường đến ' + selectedRoom.name);
    } catch {
      // Ignored
    } finally {
      setIsSendingVoice(false);
      navigation.navigate('Assistant');
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

      {/* Mini Diagnostic Bar */}
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
        {/* Voice Feedback Banner */}
        {voiceFeedback && (
          <View style={styles.voiceFeedbackBanner}>
            <Ionicons name="mic-circle" size={18} color="#059669" />
            <AppText style={styles.voiceFeedbackText}>{voiceFeedback}</AppText>
          </View>
        )}

        {/* 2. CHẾ ĐỘ DẪN ĐƯỜNG ĐANG HOẠT ĐỘNG */}
        {isEscorting ? (
          <EscortProgressBanner
            currentStep={escortStep}
            roomName={selectedRoom.name}
            roomCode={selectedRoom.roomCode}
            onCancelEscort={handleCancelEscort}
          />
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

              <IndoorHospitalMap
                targetRoom={selectedRoom.roomCode}
                targetSubText={selectedRoom.name}
                robotCode={DEFAULT_ROBOT_CODE}
                robotBusy={isEscorting}
                onSelectTarget={(code) => {
                  const match = destinations.find(
                    (d) => d.roomCode.toUpperCase() === code.toUpperCase(),
                  );
                  if (match) setSelectedRoomId(match.id);
                }}
              />
            </View>

            {/* 4. CHỌN ĐIỂM ĐẾN NHANH (QUICK ROOM SELECTOR) */}
            <QuickRoomSelector
              rooms={destinations}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
              onStartEscort={handleRequestEscort}
              loadingEscort={loadingEscort}
            />

            {/* 5. BỘ ĐÔI TÁC VỤ CHÍNH: VOICE & SOS */}
            <VoiceSosActionRow
              onPressVoice={handleVoicePress}
              onPressSos={handleEmergencySos}
              isSendingVoice={isSendingVoice}
              isTriggeringSos={isTriggeringSos}
            />
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
    paddingBottom: 70,
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
});
