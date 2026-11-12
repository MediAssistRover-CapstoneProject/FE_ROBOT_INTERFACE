import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../app/navigation';
import { AppText } from '../../components/ui';
import { AudioWaveform } from '../../components/AudioWaveform';
import { robotApiService } from '../../services/api';
import { DeviceIncidentStatusResponse } from '../../services/api/types';
import { generateUuid } from '../../services/api/config';

type Props = NativeStackScreenProps<RootStackParamList, 'Emergency'>;

export type SosCallState =
  | 'INITIALIZING'
  | 'SENDING'
  | 'SENT_WAITING'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'FALSE_ALARM'
  | 'FAILED';

export function SosCallScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { mapId, xM, yM, roomCode, roomName } = route.params || {};

  const [callSeconds, setCallSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  // 1. Quản lý vòng đời SOS thật với Backend
  const [sosState, setSosState] = useState<SosCallState>('INITIALIZING');
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);

  // Stable operationKey cho toàn bộ phiên SOS (tái sử dụng khi bấm Thử lại)
  const operationKeyRef = useRef<string>(generateUuid());
  const hasTriggeredRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Tọa độ định vị thực tế
  const hasValidCoords =
    typeof xM === 'number' && !isNaN(xM) && typeof yM === 'number' && !isNaN(yM);

  // Telemetry Console Inspector
  const [showApiConsole, setShowApiConsole] = useState(false);
  const [apiLogs, setApiLogs] = useState<{
    lastCall: string;
    lastResult: string;
    status: string;
    latencyMs: number;
  }>({
    lastCall: 'POST /api/v1/pi/incidents/sos',
    lastResult: 'Chuẩn bị gửi tín hiệu cấp cứu SOS...',
    status: 'READY',
    latencyMs: 0,
  });

  // 2. Hàm gửi SOS tới BE với envelope EMERGENCY_SOS và operationKey ổn định
  const sendSosRequest = async () => {
    setIsRetrying(true);
    setErrorMessage(null);
    setSosState('SENDING');
    const start = Date.now();

    const desc = roomCode
      ? `Bệnh nhân gọi cấp cứu SOS tại sảnh (${roomCode})`
      : 'Bệnh nhân yêu cầu trợ giúp y tế khẩn cấp tại trạm Robot';

    try {
      const res = await robotApiService.triggerSos(
        desc,
        'CRITICAL',
        hasValidCoords ? xM : undefined,
        hasValidCoords ? yM : undefined,
        hasValidCoords && mapId ? mapId : undefined,
        operationKeyRef.current,
      );

      const latency = Date.now() - start;
      const assignedId = res?.incident?.incidentId;

      if (!assignedId) {
        throw new Error('Máy chủ không trả về mã sự cố incidentId hợp lệ');
      }

      setIncidentId(assignedId);
      setSosState('SENT_WAITING');
      setApiLogs({
        lastCall: 'POST /api/v1/pi/incidents/sos',
        lastResult: JSON.stringify(res),
        status: '200 OK',
        latencyMs: latency,
      });
    } catch (err: unknown) {
      const latency = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      setSosState('FAILED');
      setErrorMessage(msg);
      setApiLogs({
        lastCall: 'POST /api/v1/pi/incidents/sos',
        lastResult: `Lỗi gửi SOS: ${msg}`,
        status: 'FAILED',
        latencyMs: latency,
      });
    } finally {
      setIsRetrying(false);
    }
  };

  // 3. Tự động gửi SOS một lần duy nhất khi mount
  useEffect(() => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    sendSosRequest();
  }, []);

  // 4. Timer đếm giây cuộc gọi
  useEffect(() => {
    const timer = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 5. Polling kiểm tra trạng thái Incident thật từ GET /api/v1/pi/incidents/{incidentId}
  useEffect(() => {
    if (!incidentId) return;
    if (
      sosState === 'RESOLVED' ||
      sosState === 'CLOSED' ||
      sosState === 'FALSE_ALARM'
    ) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      const start = Date.now();
      try {
        const statusRes: DeviceIncidentStatusResponse =
          await robotApiService.getIncidentStatus(incidentId);

        setApiLogs({
          lastCall: `GET /api/v1/pi/incidents/${incidentId.slice(0, 8)}...`,
          lastResult: JSON.stringify(statusRes),
          status: '200 OK',
          latencyMs: Date.now() - start,
        });

        const s = statusRes.status;
        if (s === 'OPEN' || s === 'REPORTED') {
          setSosState('SENT_WAITING');
        } else if (s === 'ACKNOWLEDGED') {
          setSosState('ACKNOWLEDGED');
        } else if (s === 'IN_PROGRESS') {
          setSosState('IN_PROGRESS');
        } else if (s === 'RESOLVED') {
          setSosState('RESOLVED');
        } else if (s === 'CLOSED') {
          setSosState('CLOSED');
        } else if (s === 'FALSE_ALARM') {
          setSosState('FALSE_ALARM');
        }
      } catch (err: unknown) {
        setApiLogs((prev) => ({
          ...prev,
          lastCall: `GET /api/v1/pi/incidents/${incidentId.slice(0, 8)}...`,
          lastResult: `Polling error: ${err instanceof Error ? err.message : String(err)}`,
          status: 'POLL_ERR',
        }));
      }
    }, 2500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [incidentId, sosState]);

  // Thoát màn hình SOS - KHÔNG gửi heartbeat IDLE theo tài liệu bàn giao
  const handleEndCall = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    navigation.goBack();
  };

  const formatTimer = (totalSecs: number) => {
    const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Chi tiết hiển thị tương ứng trạng thái thực tế
  const getDisplayDetails = () => {
    switch (sosState) {
      case 'INITIALIZING':
      case 'SENDING':
        return {
          title: 'Đang kết nối trung tâm cấp cứu...',
          subtitle: 'Phát tín hiệu SOS đến trạm điều dưỡng trực',
          badgeText: 'Đang gửi tín hiệu...',
          badgeColor: '#F59E0B',
          isWorking: true,
          statusText: 'Đang phát tín hiệu SOS...',
        };
      case 'SENT_WAITING':
        return {
          title: 'Đã gửi SOS · Chờ nhân viên tiếp nhận',
          subtitle: 'Tín hiệu đã tới máy chủ. Đang chờ nhân viên trực bấm nhận.',
          badgeText: 'Đã gửi SOS (Chờ tiếp nhận)',
          badgeColor: '#38BDF8',
          isWorking: true,
          statusText: 'Đang chờ nhân viên y tế tiếp nhận máy...',
        };
      case 'ACKNOWLEDGED':
        return {
          title: 'Nhân viên y tế đã tiếp nhận',
          subtitle: 'Điều dưỡng trực đã nhận tín hiệu · Đang chuẩn bị hỗ trợ',
          badgeText: 'Đã tiếp nhận (200 OK)',
          badgeColor: '#10B981',
          isWorking: false,
          statusText: 'Nhân viên y tế đã tiếp nhận hỗ trợ',
        };
      case 'IN_PROGRESS':
        return {
          title: 'Đang xử lý sự cố tại hiện trường',
          subtitle: 'Đội cấp cứu đang xử lý sự cố cứu hộ tại vị trí robot',
          badgeText: 'Đang xử lý',
          badgeColor: '#10B981',
          isWorking: false,
          statusText: 'Nhân viên đang trực tiếp xử lý',
        };
      case 'RESOLVED':
        return {
          title: 'Sự cố đã được xử lý hoàn tất',
          subtitle: 'Quy trình cứu hộ đã hoàn thành an toàn',
          badgeText: 'Đã hoàn tất',
          badgeColor: '#10B981',
          isWorking: false,
          statusText: 'Đã xử lý xong',
        };
      case 'CLOSED':
        return {
          title: 'Hồ sơ sự cố đã đóng',
          subtitle: 'Sự cố SOS đã kết thúc',
          badgeText: 'Đã đóng',
          badgeColor: '#64748B',
          isWorking: false,
          statusText: 'Hồ sơ đã đóng',
        };
      case 'FALSE_ALARM':
        return {
          title: 'Báo động giả đã được hủy',
          subtitle: 'Nhân viên trực đã xác nhận sự cố báo động nhầm và đóng hồ sơ',
          badgeText: 'Báo động giả',
          badgeColor: '#94A3B8',
          isWorking: false,
          statusText: 'Báo động giả đã hủy',
        };
      case 'FAILED':
        return {
          title: 'Gửi tín hiệu SOS thất bại',
          subtitle: errorMessage || 'Không thể kết nối đến máy chủ cấp cứu',
          badgeText: 'Gửi lỗi (Thử lại)',
          badgeColor: '#EF4444',
          isWorking: false,
          statusText: 'Lỗi gửi tín hiệu cấp cứu',
        };
    }
  };

  const display = getDisplayDetails();
  const isCallConnected =
    sosState === 'ACKNOWLEDGED' || sosState === 'IN_PROGRESS';

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 12 }]}>
      {/* 1. Top Header Row & Live Console Pill */}
      <View style={styles.topHeader}>
        <View style={styles.sosBadge}>
          <View style={styles.redDot} />
          <AppText style={styles.sosBadgeText}>SOS KHẨN CẤP · ROBOT AMR</AppText>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowApiConsole(!showApiConsole)}
          style={styles.apiStatusPill}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: display.badgeColor },
            ]}
          />
          <AppText style={styles.apiStatusPillText}>{display.badgeText}</AppText>
          <Ionicons name={showApiConsole ? 'chevron-up' : 'chevron-down'} size={12} color="#94A3B8" />
        </Pressable>
      </View>

      {/* 2. Collapsible API Telemetry Inspector */}
      {showApiConsole && (
        <View style={styles.apiConsoleBox}>
          <View style={styles.apiConsoleHeader}>
            <Ionicons name="radio-outline" size={14} color="#EF4444" />
            <AppText style={styles.apiConsoleTitle}>LIVE INCIDENTS SOS TELEMETRY</AppText>
          </View>
          <View style={styles.apiRow}>
            <AppText style={styles.apiLabel}>MÃ SỰ CỐ:</AppText>
            <AppText style={styles.apiValue}>{incidentId || 'Chưa nhận'}</AppText>
          </View>
          <View style={styles.apiRow}>
            <AppText style={styles.apiLabel}>OP KEY:</AppText>
            <AppText style={styles.apiValue}>{operationKeyRef.current}</AppText>
          </View>
          <View style={styles.apiRow}>
            <AppText style={styles.apiLabel}>ENDPOINT:</AppText>
            <AppText style={styles.apiEndpoint}>{apiLogs.lastCall}</AppText>
          </View>
          <View style={styles.apiRow}>
            <AppText style={styles.apiLabel}>TRẠNG THÁI:</AppText>
            <AppText style={styles.apiStatusVal}>
              {apiLogs.status} ({apiLogs.latencyMs}ms)
            </AppText>
          </View>
          <View style={styles.apiRow}>
            <AppText style={styles.apiLabel}>PHẢN HỒI:</AppText>
            <AppText style={styles.apiRes} numberOfLines={2}>
              {apiLogs.lastResult}
            </AppText>
          </View>
        </View>
      )}

      {/* 3. Main Center Content */}
      <View style={styles.centerContainer}>
        {/* Concentric Rings */}
        <View
          style={[
            styles.outerRing,
            isCallConnected && { borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)' },
            sosState === 'FAILED' && { borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.15)' },
          ]}
        >
          <View
            style={[
              styles.middleRing,
              isCallConnected && { borderColor: '#34D399', backgroundColor: 'rgba(52, 211, 153, 0.2)' },
              sosState === 'FAILED' && { borderColor: '#DC2626', backgroundColor: 'rgba(220, 38, 38, 0.25)' },
            ]}
          >
            <View style={styles.avatarCircle}>
              {display.isWorking ? (
                <ActivityIndicator size="large" color="#EF4444" />
              ) : (
                <Ionicons
                  name={isCallConnected ? 'medkit' : sosState === 'FAILED' ? 'alert-circle' : 'person'}
                  size={52}
                  color={isCallConnected ? '#059669' : sosState === 'FAILED' ? '#EF4444' : '#0F4C81'}
                />
              )}
            </View>
          </View>
        </View>

        {/* Dynamic Title & Subtitle */}
        <AppText style={styles.staffName}>{display.title}</AppText>
        <AppText style={styles.staffRole}>{display.subtitle}</AppText>

        {/* Calling Status with Wave or Error Retry */}
        {sosState === 'FAILED' ? (
          <View style={styles.failedContainer}>
            <Pressable
              accessibilityRole="button"
              onPress={sendSosRequest}
              disabled={isRetrying}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <AppText style={styles.retryButtonText}>Thử lại ngay</AppText>
                </>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.statusBox}>
            <AppText
              style={[
                styles.callingStatusText,
                isCallConnected && { color: '#34D399' },
              ]}
            >
              {display.statusText}
            </AppText>
            <View style={styles.waveWrap}>
              <AudioWaveform
                color={isCallConnected ? '#10B981' : '#F59E0B'}
                count={18}
                height={18}
              />
            </View>
          </View>
        )}

        {/* Real-time Tọa độ định vị */}
        <View style={styles.locationNotice}>
          <Ionicons name="navigate-circle" size={16} color="#38BDF8" />
          <AppText style={styles.locationNoticeText}>
            {hasValidCoords
              ? `Tọa độ Robot: X: ${xM.toFixed(2)}m · Y: ${yM.toFixed(2)}m${roomName ? ` · ${roomName}` : ''}`
              : 'Chưa có tọa độ định vị chính xác'}
          </AppText>
        </View>

        {/* Card thông báo khi đã tiếp nhận */}
        {isCallConnected && (
          <View style={styles.nurseArrivingCard}>
            <Ionicons name="checkmark-circle" size={20} color="#10B981" />
            <View style={{ flex: 1 }}>
              <AppText style={styles.nurseArrivingTitle}>
                NHÂN VIÊN Y TẾ ĐÃ TIẾP NHẬN SỰ CỐ
              </AppText>
              <AppText style={styles.nurseArrivingSub}>
                Bệnh nhân vui lòng giữ nguyên vị trí cạnh robot. Trợ giúp y tế đang được triển khai.
              </AppText>
            </View>
          </View>
        )}
      </View>

      {/* 4. Bottom Control Section */}
      <View style={styles.bottomSection}>
        <View style={styles.timerRow}>
          <View style={styles.waitingTimer}>
            <View
              style={[
                styles.orangeDot,
                isCallConnected && { backgroundColor: '#10B981' },
                sosState === 'FAILED' && { backgroundColor: '#EF4444' },
              ]}
            />
            <AppText
              style={[
                styles.waitingTimerText,
                isCallConnected && { color: '#34D399' },
                sosState === 'FAILED' && { color: '#EF4444' },
              ]}
            >
              {isCallConnected ? 'Đã tiếp nhận :' : 'Thời gian chờ :'} {formatTimer(callSeconds)}
            </AppText>
          </View>
          <AppText style={styles.hintCloseText}>Nhấn nút đỏ để kết thúc</AppText>
        </View>

        {/* Call Action Buttons */}
        <View style={styles.callActionsRow}>
          {/* Mute Button */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsMuted((v) => !v)}
            style={({ pressed }) => [
              styles.secondaryCallButton,
              isMuted && styles.buttonActive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons
              name={isMuted ? 'mic-off' : 'mic'}
              size={24}
              color={isMuted ? '#EF4444' : '#38BDF8'}
            />
          </Pressable>

          {/* Hang up End Call Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kết thúc cuộc gọi khẩn cấp"
            onPress={handleEndCall}
            style={({ pressed }) => [
              styles.endCallButton,
              pressed && { transform: [{ scale: 0.95 }], backgroundColor: '#DC2626' },
            ]}
          >
            <Ionicons name="call" size={32} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>

          {/* Speaker Button */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsSpeakerOn((v) => !v)}
            style={({ pressed }) => [
              styles.secondaryCallButton,
              isSpeakerOn && styles.buttonActive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons
              name={isSpeakerOn ? 'volume-high' : 'volume-mute'}
              size={24}
              color="#38BDF8"
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#071526',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  sosBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  sosBadgeText: {
    color: '#FECACA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  apiStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F253E',
    borderWidth: 1,
    borderColor: '#1E3A5F',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  apiStatusPillText: {
    color: '#E0F2FE',
    fontSize: 10,
    fontWeight: '600',
  },
  apiConsoleBox: {
    backgroundColor: '#0A1B2D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    padding: 10,
    marginVertical: 6,
    gap: 4,
  },
  apiConsoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  apiConsoleTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#F87171',
    letterSpacing: 0.5,
  },
  apiRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  apiLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    width: 80,
  },
  apiValue: {
    fontSize: 9,
    color: '#94A3B8',
    flex: 1,
    fontFamily: 'monospace',
  },
  apiEndpoint: {
    fontSize: 9,
    fontWeight: '700',
    color: '#38BDF8',
    flex: 1,
    fontFamily: 'monospace',
  },
  apiStatusVal: {
    fontSize: 9,
    fontWeight: '700',
    color: '#34D399',
    flex: 1,
  },
  apiRes: {
    fontSize: 9,
    color: '#E2E8F0',
    flex: 1,
    fontFamily: 'monospace',
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 8,
  },
  outerRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    marginBottom: 8,
  },
  middleRing: {
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 2,
    borderColor: '#F87171',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  avatarCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  staffName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  staffRole: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  statusBox: {
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  callingStatusText: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '700',
  },
  waveWrap: {
    marginTop: 4,
  },
  failedContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  locationNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: 'rgba(30, 58, 95, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  locationNoticeText: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '500',
  },
  nurseArrivingCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: '#059669',
    borderRadius: 14,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    width: '100%',
  },
  nurseArrivingTitle: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  nurseArrivingSub: {
    color: '#A7F3D0',
    fontSize: 10,
    marginTop: 1,
  },
  bottomSection: {
    gap: 16,
  },
  timerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  waitingTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orangeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  waitingTimerText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
  hintCloseText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '500',
  },
  callActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  secondaryCallButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#132840',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  buttonActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#38BDF8',
  },
  endCallButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
});
