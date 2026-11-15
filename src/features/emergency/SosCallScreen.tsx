import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../app/navigation';
import { AppText, StatusChip } from '../../components/ui';
import { AudioWaveform } from '../../components/AudioWaveform';
import { apiClient, robotApiService } from '../../services/api';
import { DeviceIncidentStatusResponse, SosRoutingStatus } from '../../services/api/types';
import { generateUuid } from '../../services/api/config';
import { colors, radii, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Emergency'>;

export type MedicalIncidentState =
  | 'INITIALIZING'
  | 'SENDING'
  | 'SENT_WAITING'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'FALSE_ALARM'
  | 'FAILED';

export type MediaCallState =
  | 'WAITING_STAFF'
  | 'CONNECTING_MEDIA'
  | 'CONNECTED'
  | 'MEDIA_ERROR'
  | 'ENDED';

export function SosCallScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { mapId, xM, yM, roomCode, roomName } = route.params || {};

  const [callSeconds, setCallSeconds] = useState(0);

  // 1. Quản lý trạng thái Sự cố (Incident Lifecycle) và trạng thái Cuộc gọi (Media Lifecycle) riêng biệt
  const [incidentState, setIncidentState] = useState<MedicalIncidentState>('INITIALIZING');
  const [callState, setCallState] = useState<MediaCallState>('WAITING_STAFF');
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [mediaSessionId, setMediaSessionId] = useState<string | null>(null);
  const [sosRoutingStatus, setSosRoutingStatus] = useState<SosRoutingStatus | null>(null);
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

  // 2. Gửi SOS tới BE với envelope EMERGENCY_SOS và operationKey ổn định
  const sendSosRequest = async () => {
    setIsRetrying(true);
    setErrorMessage(null);
    setIncidentState('SENDING');
    setCallState('WAITING_STAFF');
    const start = Date.now();

    const desc = roomCode
      ? `Bệnh nhân gọi cấp cứu SOS tại sảnh (${roomCode})`
      : 'Bệnh nhân yêu cầu trợ giúp y tế khẩn cấp tại trạm Robot';

    console.log('[SOS] Gửi POST /api/v1/pi/incidents/sos', {
      baseUrl: apiClient.getBaseUrl(),
      operationKey: operationKeyRef.current,
      hasValidCoords,
      mapId: hasValidCoords && mapId ? mapId : undefined,
    });

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
      setSosRoutingStatus(res?.incident?.sosRoutingStatus ?? null);
      setIncidentState('SENT_WAITING');
      setCallState('WAITING_STAFF');
      setApiLogs({
        lastCall: 'POST /api/v1/pi/incidents/sos',
        lastResult: JSON.stringify(res),
        status: '200 OK',
        latencyMs: latency,
      });
      console.log('[SOS] Thành công:', {
        incidentId: assignedId,
        sosRoutingStatus: res?.incident?.sosRoutingStatus ?? null,
        latencyMs: latency,
      });
    } catch (err: unknown) {
      const latency = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[SOS] Gửi thất bại:', msg);
      setIncidentState('FAILED');
      setCallState('MEDIA_ERROR');
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

  // 4. Timer đếm giây mở màn hình SOS
  useEffect(() => {
    const timer = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 5. Polling kiểm tra trạng thái Incident thật và kiểm tra trạng thái Media Session từ BE
  useEffect(() => {
    if (!incidentId) return;
    if (
      incidentState === 'RESOLVED' ||
      incidentState === 'CLOSED' ||
      incidentState === 'FALSE_ALARM'
    ) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setCallState('ENDED');
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      const start = Date.now();
      try {
        // a) Kiểm tra trạng thái sự cố y tế
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
          setIncidentState('SENT_WAITING');
        } else if (s === 'ACKNOWLEDGED') {
          setIncidentState('ACKNOWLEDGED');
        } else if (s === 'IN_PROGRESS') {
          setIncidentState('IN_PROGRESS');
        } else if (s === 'RESOLVED') {
          setIncidentState('RESOLVED');
          setCallState('ENDED');
        } else if (s === 'CLOSED') {
          setIncidentState('CLOSED');
          setCallState('ENDED');
        } else if (s === 'FALSE_ALARM') {
          setIncidentState('FALSE_ALARM');
          setCallState('ENDED');
        }

        // b) Kiểm tra trạng thái cuộc gọi đàm thoại (Media Session trên Pi / LiveKit)
        try {
          const mediaRes = await robotApiService.getDeviceMediaSession();
          if (mediaRes?.session) {
            setMediaSessionId(mediaRes.session.sessionId);
            const mState = mediaRes.session.state;
            if (mState === 'ACTIVE') {
              setCallState('CONNECTED');
            } else if (mState === 'RINGING') {
              setCallState('CONNECTING_MEDIA');
            } else if (mState === 'ENDED') {
              setCallState('ENDED');
            }
          } else {
            // Chưa có phiên media session riêng
            if (s === 'ACKNOWLEDGED' || s === 'IN_PROGRESS') {
              // Nhân viên y tế đã ACK sự cố, đang chuẩn bị kết nối đàm thoại
              setCallState((prev) => (prev === 'CONNECTED' ? 'CONNECTED' : 'CONNECTING_MEDIA'));
            } else if (['RESOLVED', 'CLOSED', 'FALSE_ALARM'].includes(s)) {
              setCallState('ENDED');
            } else {
              setCallState('WAITING_STAFF');
            }
          }
        } catch {
          // Media session check silent catch
        }
      } catch (err: unknown) {
        const pollErrMsg = err instanceof Error ? err.message : String(err);
        console.warn('[SOS] Polling lỗi:', pollErrMsg);
        setApiLogs((prev) => ({
          ...prev,
          lastCall: `GET /api/v1/pi/incidents/${incidentId.slice(0, 8)}...`,
          lastResult: `Polling error: ${pollErrMsg}`,
          status: 'POLL_ERR',
        }));
      }
    }, 2500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [incidentId, incidentState]);

  // Thoát màn hình SOS - KHÔNG gửi heartbeat IDLE theo quy tắc an toàn
  const handleEndCall = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    navigation.goBack();
  };

  const formatTimer = (totalSecs: number) => {
    const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Chi tiết hiển thị tương ứng trạng thái Sự cố y tế
  const getIncidentDetails = () => {
    switch (incidentState) {
      case 'INITIALIZING':
      case 'SENDING':
        return {
          title: 'Đang kết nối trung tâm cấp cứu...',
          subtitle: 'Phát tín hiệu SOS đến trạm điều dưỡng trực',
          badgeText: 'Đang gửi tín hiệu...',
          badgeColor: colors.warningText,
          isWorking: true,
        };
      case 'SENT_WAITING':
        return {
          title: 'Đã gửi SOS · Chờ nhân viên tiếp nhận',
          subtitle: 'Tín hiệu đã tới máy chủ. Đang chờ nhân viên trực bấm nhận.',
          badgeText: 'SỰ CỐ: Chờ tiếp nhận',
          badgeColor: colors.mapRoute,
          isWorking: true,
        };
      case 'ACKNOWLEDGED':
        return {
          title: 'Nhân viên y tế đã tiếp nhận sự cố',
          subtitle: 'Điều dưỡng trực đã nhận tín hiệu (ACK) · Đang chuẩn bị hỗ trợ',
          badgeText: 'SỰ CỐ: Đã tiếp nhận (ACK)',
          badgeColor: colors.successText,
          isWorking: false,
        };
      case 'IN_PROGRESS':
        return {
          title: 'Đang xử lý sự cố tại hiện trường',
          subtitle: 'Đội cấp cứu đang xử lý sự cố cứu hộ tại vị trí robot',
          badgeText: 'SỰ CỐ: Đang xử lý',
          badgeColor: colors.successText,
          isWorking: false,
        };
      case 'RESOLVED':
        return {
          title: 'Sự cố đã được xử lý hoàn tất',
          subtitle: 'Quy trình cứu hộ đã hoàn thành an toàn',
          badgeText: 'SỰ CỐ: Đã hoàn tất',
          badgeColor: colors.successText,
          isWorking: false,
        };
      case 'CLOSED':
        return {
          title: 'Hồ sơ sự cố đã đóng',
          subtitle: 'Sự cố SOS đã kết thúc',
          badgeText: 'SỰ CỐ: Đã đóng',
          badgeColor: colors.textMuted,
          isWorking: false,
        };
      case 'FALSE_ALARM':
        return {
          title: 'Báo động giả đã được hủy',
          subtitle: 'Nhân viên trực đã xác nhận sự cố báo động nhầm và đóng hồ sơ',
          badgeText: 'SỰ CỐ: Báo động giả',
          badgeColor: colors.textSecondary,
          isWorking: false,
        };
      case 'FAILED':
        return {
          title: 'Gửi tín hiệu SOS thất bại',
          subtitle: errorMessage || 'Không thể kết nối đến máy chủ cấp cứu',
          badgeText: 'SỰ CỐ: Gửi lỗi',
          badgeColor: colors.danger,
          isWorking: false,
        };
    }
  };

  // Chi tiết hiển thị tương ứng trạng thái Cuộc gọi đàm thoại LiveKit
  const getCallDetails = () => {
    switch (callState) {
      case 'WAITING_STAFF':
        return {
          badgeText: 'CUỘC GỌI: Chờ nhân viên mở máy',
          badgeColor: colors.textSecondary,
          statusText: 'Đang chờ điều dưỡng trực mở kênh đàm thoại...',
          showWave: false,
        };
      case 'CONNECTING_MEDIA':
        return {
          badgeText: 'CUỘC GỌI: Đang kết nối media...',
          badgeColor: colors.warningText,
          statusText: 'Đang thiết lập cầu nối LiveKit & âm thanh trên Robot (Pi)...',
          showWave: true,
        };
      case 'CONNECTED':
        return {
          badgeText: 'CUỘC GỌI: Đang đàm thoại 2 chiều',
          badgeColor: '#10B981',
          statusText: 'Đàm thoại 2 chiều đang hoạt động (Mic & Loa trên Pi)',
          showWave: true,
        };
      case 'MEDIA_ERROR':
        return {
          badgeText: 'CUỘC GỌI: Lỗi kết nối',
          badgeColor: colors.danger,
          statusText: 'Lỗi thiết lập đàm thoại âm thanh',
          showWave: false,
        };
      case 'ENDED':
        return {
          badgeText: 'CUỘC GỌI: Đã kết thúc',
          badgeColor: colors.textMuted,
          statusText: 'Phiên đàm thoại hai chiều đã kết thúc',
          showWave: false,
        };
    }
  };

  const getSosRoutingWarning = (routingStatus: SosRoutingStatus | null): string | null => {
    switch (routingStatus) {
      case 'NO_ACTIVE_SHIFT':
        return 'Backend chưa thấy nhân viên trực SOS check-in trong ca (NO_ACTIVE_SHIFT). Hãy cho staff_sos check-in đúng phòng trực SOS.';
      case 'NO_MONITORING_ROOM':
        return 'Hệ thống chưa cấu hình phòng trực SOS (NO_MONITORING_ROOM / sos.monitoring-room-id).';
      case 'ROOM_UNAVAILABLE':
        return 'Phòng trực SOS đang tạm ngưng hoặc không khớp bệnh viện (ROOM_UNAVAILABLE).';
      case 'AMBIGUOUS_SHIFT':
        return 'Có nhiều hơn 1 nhân viên đang trực phòng SOS cùng lúc (AMBIGUOUS_SHIFT). Cần giữ đúng 1 người trong ca trực.';
      default:
        return null;
    }
  };

  const incidentInfo = getIncidentDetails();
  const callInfo = getCallDetails();
  const routingWarning = getSosRoutingWarning(sosRoutingStatus);
  const isAcknowledged =
    incidentState === 'ACKNOWLEDGED' || incidentState === 'IN_PROGRESS';

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      {/* 1. Top Header Row: Nút Quay lại + Trạng thái Sự cố & Cuộc gọi */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeftGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={handleEndCall}
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
            <AppText style={styles.backButtonText}>Quay lại</AppText>
          </Pressable>

          <View style={styles.sosBadge}>
            <View style={styles.redDot} />
            <AppText style={styles.sosBadgeText}>HỖ TRỢ KHẨN CẤP · ROBOT AMR</AppText>
          </View>
        </View>

        <View style={styles.dualStatusHeaderRow}>
          {/* Badge 1: Trạng thái sự cố */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Xem chi tiết kết nối API sự cố"
            onPress={() => setShowApiConsole(!showApiConsole)}
            style={styles.apiStatusPill}
          >
            <View style={[styles.statusDot, { backgroundColor: incidentInfo.badgeColor }]} />
            <AppText style={styles.apiStatusPillText}>{incidentInfo.badgeText}</AppText>
            <Ionicons name={showApiConsole ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textInverseSecondary} />
          </Pressable>

          {/* Badge 2: Trạng thái cuộc gọi đàm thoại */}
          <View style={[styles.apiStatusPill, { borderColor: callInfo.badgeColor }]}>
            <View style={[styles.statusDot, { backgroundColor: callInfo.badgeColor }]} />
            <AppText style={styles.apiStatusPillText}>{callInfo.badgeText}</AppText>
          </View>
        </View>
      </View>

      {/* 2. Scrollable Middle Section (tránh bị cắt nội dung trên màn hình ngang) */}
      <ScrollView
        style={styles.centerScroll}
        contentContainerStyle={styles.centerContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Collapsible API Telemetry Inspector */}
        {showApiConsole && (
          <View style={styles.apiConsoleBox}>
            <View style={styles.apiConsoleHeader}>
              <Ionicons name="radio-outline" size={14} color={colors.danger} />
              <AppText style={styles.apiConsoleTitle}>LIVE INCIDENTS & MEDIA TELEMETRY</AppText>
            </View>
            <View style={styles.apiRow}>
              <AppText style={styles.apiLabel}>BASE URL:</AppText>
              <AppText style={styles.apiEndpoint} numberOfLines={1}>
                {apiClient.getBaseUrl()}
              </AppText>
            </View>
            <View style={styles.apiRow}>
              <AppText style={styles.apiLabel}>ROUTING SOS:</AppText>
              <AppText style={styles.apiValue}>{sosRoutingStatus || 'Chưa rõ'}</AppText>
            </View>
            <View style={styles.apiRow}>
              <AppText style={styles.apiLabel}>MÃ SỰ CỐ:</AppText>
              <AppText style={styles.apiValue}>{incidentId || 'Chưa nhận'}</AppText>
            </View>
            <View style={styles.apiRow}>
              <AppText style={styles.apiLabel}>PHIÊN MEDIA:</AppText>
              <AppText style={styles.apiValue}>{mediaSessionId || 'Chờ LiveKit'}</AppText>
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
                {apiLogs.status} ({apiLogs.latencyMs}ms) · Call: {callState}
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

        {/* Concentric Rings Visual */}
        <View
          style={[
            styles.outerRing,
            isAcknowledged && styles.outerRingSuccess,
            incidentState === 'FAILED' && styles.outerRingFailed,
          ]}
        >
          <View
            style={[
              styles.middleRing,
              isAcknowledged && styles.middleRingSuccess,
              incidentState === 'FAILED' && styles.middleRingFailed,
            ]}
          >
            <View style={styles.avatarCircle}>
              {incidentInfo.isWorking ? (
                <ActivityIndicator size="large" color={colors.danger} />
              ) : (
                <Ionicons
                  name={isAcknowledged ? 'medkit' : incidentState === 'FAILED' ? 'alert-circle' : 'megaphone'}
                  size={42}
                  color={isAcknowledged ? colors.successText : incidentState === 'FAILED' ? colors.danger : colors.textPrimary}
                />
              )}
            </View>
          </View>
        </View>

        {/* Dynamic Title & Subtitle của Sự cố */}
        <AppText variant="title" style={styles.statusTitle}>
          {incidentInfo.title}
        </AppText>
        <AppText
          variant="body"
          style={[styles.statusSubtitle, incidentState === 'FAILED' && styles.statusSubtitleError]}
        >
          {incidentInfo.subtitle}
        </AppText>

        {/* Khối hiển thị trạng thái Cuộc gọi Đàm thoại 2 chiều riêng biệt */}
        {incidentState !== 'FAILED' && (
          <View style={styles.callStatusCard}>
            <View style={styles.callStatusHeader}>
              <Ionicons
                name={callState === 'CONNECTED' ? 'call' : 'headset'}
                size={18}
                color={callInfo.badgeColor}
              />
              <AppText style={[styles.callingStatusText, { color: callInfo.badgeColor }]}>
                {callInfo.statusText}
              </AppText>
            </View>

            {callInfo.showWave && (
              <View style={styles.waveWrap}>
                <AudioWaveform
                  color={callState === 'CONNECTED' ? '#10B981' : colors.warningText}
                  count={22}
                  height={18}
                />
              </View>
            )}
          </View>
        )}

        {/* Real-time Tọa độ định vị */}
        <View style={styles.locationNotice}>
          <Ionicons name="navigate-circle" size={18} color={colors.textInverseSecondary} />
          <AppText style={styles.locationNoticeText}>
            {hasValidCoords
              ? `Tọa độ Robot: X: ${xM.toFixed(2)}m · Y: ${yM.toFixed(2)}m${roomName ? ` · ${roomName}` : ''}`
              : 'Chưa có tọa độ định vị chính xác'}
          </AppText>
        </View>

        {/* Cảnh báo phân tuyến SOS từ BE nếu chưa có người trực hợp lệ */}
        {routingWarning && !isAcknowledged && incidentState !== 'FAILED' && (
          <View style={styles.routingWarningCard}>
            <Ionicons name="warning-outline" size={18} color={colors.warningText} />
            <AppText style={styles.routingWarningText}>{routingWarning}</AppText>
          </View>
        )}

        {/* Card thông báo tiếp nhận sự cố */}
        {isAcknowledged && (
          <View style={styles.acknowledgedCard}>
            <Ionicons name="checkmark-circle" size={22} color={colors.successText} />
            <View style={{ flex: 1 }}>
              <AppText style={styles.acknowledgedTitle}>
                NHÂN VIÊN Y TẾ ĐÃ TIẾP NHẬN SỰ CỐ
              </AppText>
              <AppText style={styles.acknowledgedSub}>
                Bệnh nhân vui lòng giữ nguyên vị trí cạnh robot. Trợ giúp y tế đang được triển khai.
              </AppText>
            </View>
          </View>
        )}

        {/* Card ghi rõ trách nhiệm phần cứng phía Pi */}
        <View style={styles.hardwareDisclaimerCard}>
          <Ionicons name="hardware-chip-outline" size={15} color={colors.textInverseSecondary} />
          <AppText style={styles.hardwareDisclaimerText}>
            Phần cứng đàm thoại (Microphone, Loa phát thanh và Camera LiveKit) chạy trực tiếp trên Raspberry Pi (media_bridge). Màn hình tablet hiển thị trạng thái và hỗ trợ tương tác tại chỗ cho bệnh nhân.
          </AppText>
        </View>
      </ScrollView>

      {/* 3. Bottom Control Section */}
      <View style={styles.bottomSection}>
        <View style={styles.timerRow}>
          <View style={styles.timerBadge}>
            <View
              style={[
                styles.timerDot,
                isAcknowledged && { backgroundColor: '#10B981' },
                incidentState === 'FAILED' && { backgroundColor: colors.danger },
              ]}
            />
            <AppText style={styles.timerText}>
              Thời gian mở màn hình SOS : {formatTimer(callSeconds)}
            </AppText>
          </View>
        </View>

        {/* End Call / Retry / Exit Buttons */}
        <View style={styles.actionsRow}>
          {incidentState === 'FAILED' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Thử lại gửi tín hiệu SOS"
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
                  <Ionicons name="refresh" size={20} color="#FFFFFF" />
                  <AppText style={styles.retryButtonText}>Thử lại ngay</AppText>
                </>
              )}
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đóng màn hình SOS khẩn cấp"
            onPress={handleEndCall}
            style={({ pressed }) => [
              styles.endCallButton,
              pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
            ]}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
            <AppText style={styles.endCallText}>Kết thúc · Đóng SOS</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.callBg,
    paddingHorizontal: spacing.lg,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.darkRaised,
    borderWidth: 1,
    borderColor: '#475569',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    minHeight: 36,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  sosBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(198, 40, 40, 0.2)',
    borderWidth: 1,
    borderColor: colors.danger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  sosBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  dualStatusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  apiStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.darkRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  apiStatusPillText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '600',
  },
  callStatusCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 480,
    marginTop: spacing.xs,
  },
  callStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  hardwareDisclaimerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    maxWidth: 520,
    marginTop: spacing.xs,
  },
  hardwareDisclaimerText: {
    flex: 1,
    color: colors.textInverseSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  apiConsoleBox: {
    backgroundColor: colors.hero,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderColor: colors.darkRaised,
    borderWidth: 1,
    gap: 4,
    marginVertical: spacing.sm,
  },
  apiConsoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkRaised,
  },
  apiConsoleTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  apiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  apiLabel: {
    color: colors.textInverseSecondary,
    fontSize: 10,
    fontWeight: '700',
    width: 85,
  },
  apiValue: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    flex: 1,
  },
  apiEndpoint: {
    color: colors.mapRoute,
    fontSize: 10,
    fontWeight: '600',
    flex: 1,
  },
  apiStatusVal: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '700',
  },
  apiRes: {
    color: colors.textInverseSecondary,
    fontSize: 10,
    flex: 1,
  },
  centerScroll: {
    flex: 1,
  },
  centerContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs + 2,
  },
  outerRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.darkRaised,
    backgroundColor: 'rgba(45, 45, 49, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRingSuccess: {
    borderColor: '#166534',
    backgroundColor: 'rgba(22, 101, 52, 0.2)',
  },
  outerRingFailed: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(198, 40, 40, 0.2)',
  },
  middleRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.darkRaised,
    backgroundColor: 'rgba(45, 45, 49, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  middleRingSuccess: {
    borderColor: '#24A148',
    backgroundColor: 'rgba(36, 161, 72, 0.3)',
  },
  middleRingFailed: {
    borderColor: '#991B1B',
    backgroundColor: 'rgba(153, 27, 27, 0.3)',
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    color: colors.textInverse,
    textAlign: 'center',
    fontWeight: '800',
  },
  statusSubtitle: {
    color: colors.textInverseSecondary,
    textAlign: 'center',
    maxWidth: 520,
  },
  statusSubtitleError: {
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
  },
  failedContainer: {
    marginTop: spacing.xs,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.mapRoute,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    minHeight: 46,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  callingStatusText: {
    color: colors.textInverseSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  waveWrap: {
    paddingHorizontal: spacing.xs,
  },
  locationNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.darkRaised,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    marginTop: spacing.xs,
  },
  locationNoticeText: {
    color: colors.textInverseSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  acknowledgedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(22, 101, 52, 0.25)',
    borderColor: '#166534',
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radii.lg,
    maxWidth: 520,
    marginTop: spacing.xs,
  },
  routingWarningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    maxWidth: 520,
    marginTop: spacing.xs,
  },
  routingWarningText: {
    flex: 1,
    color: colors.warningText,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  acknowledgedTitle: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  acknowledgedSub: {
    color: '#E0E7FF',
    fontSize: 12,
    marginTop: 2,
  },
  bottomSection: {
    gap: spacing.xs + 2,
    paddingTop: spacing.xs,
    alignItems: 'center',
  },
  timerRow: {
    alignItems: 'center',
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timerDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.warningText,
  },
  timerText: {
    color: colors.textInverseSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  endCallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    minHeight: 46,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    shadowColor: colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  endCallText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
