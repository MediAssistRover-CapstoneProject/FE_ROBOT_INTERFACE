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
import { robotApiService } from '../../services/api';
import { DeviceIncidentStatusResponse } from '../../services/api/types';
import { generateUuid } from '../../services/api/config';
import { colors, radii, spacing, typography } from '../../theme';

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

  // 2. Gửi SOS tới BE với envelope EMERGENCY_SOS và operationKey ổn định
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

  // 4. Timer đếm giây mở màn hình SOS
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

  // Chi tiết hiển thị tương ứng trạng thái thực tế
  const getDisplayDetails = () => {
    switch (sosState) {
      case 'INITIALIZING':
      case 'SENDING':
        return {
          title: 'Đang kết nối trung tâm cấp cứu...',
          subtitle: 'Phát tín hiệu SOS đến trạm điều dưỡng trực',
          badgeText: 'Đang gửi tín hiệu...',
          badgeColor: colors.warningText,
          isWorking: true,
          statusText: 'Đang phát tín hiệu SOS...',
        };
      case 'SENT_WAITING':
        return {
          title: 'Đã gửi SOS · Chờ nhân viên tiếp nhận',
          subtitle: 'Tín hiệu đã tới máy chủ. Đang chờ nhân viên trực bấm nhận.',
          badgeText: 'Đã gửi SOS (Chờ tiếp nhận)',
          badgeColor: colors.mapRoute,
          isWorking: true,
          statusText: 'Đang chờ nhân viên y tế tiếp nhận máy...',
        };
      case 'ACKNOWLEDGED':
        return {
          title: 'Nhân viên y tế đã tiếp nhận',
          subtitle: 'Điều dưỡng trực đã nhận tín hiệu · Đang chuẩn bị hỗ trợ',
          badgeText: 'Đã tiếp nhận (200 OK)',
          badgeColor: colors.successText,
          isWorking: false,
          statusText: 'Nhân viên y tế đã tiếp nhận hỗ trợ',
        };
      case 'IN_PROGRESS':
        return {
          title: 'Đang xử lý sự cố tại hiện trường',
          subtitle: 'Đội cấp cứu đang xử lý sự cố cứu hộ tại vị trí robot',
          badgeText: 'Đang xử lý',
          badgeColor: colors.successText,
          isWorking: false,
          statusText: 'Nhân viên đang trực tiếp xử lý',
        };
      case 'RESOLVED':
        return {
          title: 'Sự cố đã được xử lý hoàn tất',
          subtitle: 'Quy trình cứu hộ đã hoàn thành an toàn',
          badgeText: 'Đã hoàn tất',
          badgeColor: colors.successText,
          isWorking: false,
          statusText: 'Đã xử lý xong',
        };
      case 'CLOSED':
        return {
          title: 'Hồ sơ sự cố đã đóng',
          subtitle: 'Sự cố SOS đã kết thúc',
          badgeText: 'Đã đóng',
          badgeColor: colors.textMuted,
          isWorking: false,
          statusText: 'Hồ sơ đã đóng',
        };
      case 'FALSE_ALARM':
        return {
          title: 'Báo động giả đã được hủy',
          subtitle: 'Nhân viên trực đã xác nhận sự cố báo động nhầm và đóng hồ sơ',
          badgeText: 'Báo động giả',
          badgeColor: colors.textSecondary,
          isWorking: false,
          statusText: 'Báo động giả đã hủy',
        };
      case 'FAILED':
        return {
          title: 'Gửi tín hiệu SOS thất bại',
          subtitle: errorMessage || 'Không thể kết nối đến máy chủ cấp cứu',
          badgeText: 'Gửi lỗi (Thử lại)',
          badgeColor: colors.danger,
          isWorking: false,
          statusText: 'Lỗi gửi tín hiệu cấp cứu',
        };
    }
  };

  const display = getDisplayDetails();
  const isAcknowledged =
    sosState === 'ACKNOWLEDGED' || sosState === 'IN_PROGRESS';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      {/* 1. Top Header Row */}
      <View style={styles.topHeader}>
        <View style={styles.sosBadge}>
          <View style={styles.redDot} />
          <AppText style={styles.sosBadgeText}>HỖ TRỢ KHẨN CẤP · ROBOT AMR</AppText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Xem chi tiết kết nối API"
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
          <Ionicons name={showApiConsole ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textInverseSecondary} />
        </Pressable>
      </View>

      {/* 2. Collapsible API Telemetry Inspector */}
      {showApiConsole && (
        <View style={styles.apiConsoleBox}>
          <View style={styles.apiConsoleHeader}>
            <Ionicons name="radio-outline" size={14} color={colors.danger} />
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

      {/* 3. Main Center Content Card */}
      <View style={styles.centerContainer}>
        {/* Concentric Rings Visual */}
        <View
          style={[
            styles.outerRing,
            isAcknowledged && styles.outerRingSuccess,
            sosState === 'FAILED' && styles.outerRingFailed,
          ]}
        >
          <View
            style={[
              styles.middleRing,
              isAcknowledged && styles.middleRingSuccess,
              sosState === 'FAILED' && styles.middleRingFailed,
            ]}
          >
            <View style={styles.avatarCircle}>
              {display.isWorking ? (
                <ActivityIndicator size="large" color={colors.danger} />
              ) : (
                <Ionicons
                  name={isAcknowledged ? 'medkit' : sosState === 'FAILED' ? 'alert-circle' : 'megaphone'}
                  size={46}
                  color={isAcknowledged ? colors.successText : sosState === 'FAILED' ? colors.danger : colors.textPrimary}
                />
              )}
            </View>
          </View>
        </View>

        {/* Dynamic Title & Subtitle */}
        <AppText variant="title" style={styles.statusTitle}>
          {display.title}
        </AppText>
        <AppText variant="body" style={styles.statusSubtitle}>
          {display.subtitle}
        </AppText>

        {/* Action Status Wave or Error Retry */}
        {sosState === 'FAILED' ? (
          <View style={styles.failedContainer}>
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
          </View>
        ) : (
          <View style={styles.statusBox}>
            <AppText
              style={[
                styles.callingStatusText,
                isAcknowledged && { color: '#34D399' },
              ]}
            >
              {display.statusText}
            </AppText>
            <View style={styles.waveWrap}>
              <AudioWaveform
                color={isAcknowledged ? colors.successText : colors.warningText}
                count={18}
                height={16}
              />
            </View>
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

        {/* Card thông báo tiếp nhận */}
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
      </View>

      {/* 4. Bottom Control Section */}
      <View style={styles.bottomSection}>
        <View style={styles.timerRow}>
          <View style={styles.timerBadge}>
            <View
              style={[
                styles.timerDot,
                isAcknowledged && { backgroundColor: '#10B981' },
                sosState === 'FAILED' && { backgroundColor: colors.danger },
              ]}
            />
            <AppText style={styles.timerText}>
              Thời gian mở màn hình SOS : {formatTimer(callSeconds)}
            </AppText>
          </View>
        </View>

        {/* End Call / Exit Button */}
        <View style={styles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đóng màn hình SOS khẩn cấp"
            onPress={handleEndCall}
            style={({ pressed }) => [
              styles.endCallButton,
              pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
            ]}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xs,
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
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  outerRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: colors.darkRaised,
    backgroundColor: 'rgba(45, 45, 49, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
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
    width: 104,
    height: 104,
    borderRadius: 52,
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
    width: 78,
    height: 78,
    borderRadius: 39,
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
    maxWidth: 420,
  },
  failedContainer: {
    marginTop: spacing.xs,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    minHeight: 52,
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
    gap: spacing.md,
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
  },
  endCallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    minHeight: 56,
    paddingHorizontal: spacing.xxl,
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
