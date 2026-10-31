import React, { useState, useEffect } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/ui';
import { LogisticsStepper } from '../../components/LogisticsStepper';
import { robotApiService } from '../../services/api';

type QrStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

const JOB_ID = 'JOB-VT02-MED';

export function QrDeliveryMissionScreen() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<QrStage>(1); // Default to stage 1 to follow complete mission flow
  const [staffNotified, setStaffNotified] = useState(false);
  const [countdown, setCountdown] = useState(29);
  const [isCounting, setIsCounting] = useState(true);

  // Live Local Backend API Connection Status & Telemetry Console
  const [showApiConsole, setShowApiConsole] = useState(false);
  const [apiStatus, setApiStatus] = useState<{
    connected: boolean;
    latencyMs: number;
    loading: boolean;
    lastCall?: string;
    lastResult?: string;
  }>({
    connected: false,
    latencyMs: 0,
    loading: false,
    lastCall: 'GET /api/v1/public/zones',
    lastResult: 'Khởi tạo kết nối máy chủ Local...',
  });

  // Ping test on mount
  useEffect(() => {
    robotApiService.pingServer().then((res) => {
      setApiStatus((prev) => ({
        ...prev,
        connected: res.ok,
        latencyMs: res.latencyMs,
        lastResult: res.ok
          ? `200 OK (${res.latencyMs}ms) · Local Server sẵn sàng`
          : 'Chế độ Hybrid Bệnh viện',
      }));
    });
  }, []);

  // API Stage Transition Handler
  const transitionToStage = async (nextStage: QrStage) => {
    setStage(nextStage);
    setApiStatus((prev) => ({ ...prev, loading: true }));
    const start = Date.now();

    try {
      if (nextStage === 1) {
        // Bước 1: Nhận nhiệm vụ
        await robotApiService.reportJobStarted(JOB_ID);
        await robotApiService.reportStepStarted('step-qr-01-receive', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: `POST /api/v1/pi/jobs/${JOB_ID}/started`,
          lastResult: '200 OK · Bắt đầu thực thi nhiệm vụ vận chuyển thuốc #BN2047',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 2) {
        // Bước di chuyển đến nơi nhận (Nhà thuốc)
        await robotApiService.reportStepStarted('step-qr-02-transit-pharmacy', JOB_ID);
        await robotApiService.sendLocation(10.5, 3.2, 0);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-02-transit-pharmacy/started',
          lastResult: '200 OK · Đang di chuyển đến Nhà thuốc (tốc độ 0.8 m/s)',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 3) {
        // Đến nơi gửi (Nhà thuốc)
        await robotApiService.reportStepResult(
          'step-qr-02-transit-pharmacy',
          { arrivedAt: 'Nhà thuốc Bệnh viện' },
          JOB_ID
        );
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-02-transit-pharmacy/result',
          lastResult: '200 OK · Robot đã đến Nhà thuốc, chờ nạp thuốc',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 4) {
        // Mở thùng
        await robotApiService.reportStepStarted('step-qr-03-open-compartment', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-03-open-compartment/started',
          lastResult: '200 OK · Đang mở thùng bảo quản...',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 5) {
        // Thùng đã mở
        await robotApiService.reportStepResult(
          'step-qr-03-open-compartment',
          { compartmentStatus: 'OPEN' },
          JOB_ID
        );
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-03-open-compartment/result',
          lastResult: '200 OK · Thùng đã mở hoàn toàn, chờ đặt đơn thuốc',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 6) {
        // Đang kiểm tra vật phẩm
        await robotApiService.reportStepStarted('step-qr-04-verify-item', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-04-verify-item/started',
          lastResult: '200 OK · Cảm biến LiDAR/Trọng lượng nhận diện vật phẩm',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 7) {
        // Xác nhận vật phẩm đúng
        await robotApiService.reportStepResult(
          'step-qr-04-verify-item',
          { verifiedItem: 'MED-BN2047-0904', quantity: 1, correct: true },
          JOB_ID
        );
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-04-verify-item/result',
          lastResult: '200 OK · Đã xác nhận đúng Đơn thuốc #BN2047',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 8) {
        // Khóa thùng
        await robotApiService.reportStepStarted('step-qr-05-lock-compartment', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-05-lock-compartment/started',
          lastResult: '200 OK · Đang đóng và kích hoạt khóa điện tử...',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 9) {
        // Vận chuyển đến P. Tim mạch
        await robotApiService.reportStepResult(
          'step-qr-05-lock-compartment',
          { compartmentStatus: 'LOCKED_SECURE' },
          JOB_ID
        );
        await robotApiService.reportStepStarted('step-qr-06-transit-cardiology', JOB_ID);
        await robotApiService.sendLocation(16.8, 8.4, 0);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-06-transit-cardiology/started',
          lastResult: '200 OK · Đang vận chuyển thuốc sang P. Tim mạch (0.9 m/s)',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 10) {
        // Đến nơi - Chờ quét QR
        await robotApiService.reportStepResult(
          'step-qr-06-transit-cardiology',
          { arrivedLocation: 'Phòng Khám Tim mạch - Zone A' },
          JOB_ID
        );
        await robotApiService.reportStepStarted('step-qr-07-qr-verification', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-07-qr-verification/started',
          lastResult: '200 OK · Đã đến điểm giao, chờ quét mã QR xác thực BS. Lan',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 11) {
        // Xác minh QR thành công, mở thùng bàn giao
        await robotApiService.reportStepResult(
          'step-qr-07-qr-verification',
          { authMethod: 'QR_CODE', verifiedStaff: 'BS. Trần Thị Lan', role: 'Bác sĩ điều trị' },
          JOB_ID
        );
        await robotApiService.reportStepStarted('step-qr-08-item-retrieval', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-07-qr-verification/result',
          lastResult: '200 OK · Quét QR thành công! Thùng mở, chờ lấy thuốc',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 12) {
        // Cảnh báo 29s
        await robotApiService.reportStepError(
          'step-qr-08-item-takeout',
          'TIMEOUT_WARNING',
          { remainingSeconds: 29 },
          true,
          JOB_ID
        );
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-08-item-takeout/errors',
          lastResult: '200 OK · Cảnh báo: Thuốc chưa được lấy, đếm ngược 29s tự đóng',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 13) {
        // Đã lấy thuốc xong, đóng thùng
        await robotApiService.reportStepResult(
          'step-qr-08-item-retrieval',
          { itemRetrieved: true, emptyBoxConfirmed: true },
          JOB_ID
        );
        await robotApiService.reportStepStarted('step-qr-09-final-lock', JOB_ID);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: 'POST /api/v1/pi/job-steps/step-qr-09-final-lock/started',
          lastResult: '200 OK · Cảm biến xác nhận thùng trống, đang khóa an toàn',
          latencyMs: Date.now() - start,
        }));
      } else if (nextStage === 14) {
        // Hoàn tất toàn bộ Job
        await robotApiService.reportStepResult(
          'step-qr-09-final-lock',
          { compartmentStatus: 'LOCKED_EMPTY' },
          JOB_ID
        );
        await robotApiService.reportJobResult(JOB_ID, {
          status: 'COMPLETED',
          receiptNumber: 'REC-TH02-2026',
          deliveredTo: 'BS. Trần Thị Lan',
          totalDurationSec: 360,
          deliveredAt: new Date().toISOString(),
        });
        await robotApiService.sendHeartbeat('IDLE', 78);
        setApiStatus((prev) => ({
          ...prev,
          loading: false,
          lastCall: `POST /api/v1/pi/jobs/${JOB_ID}/result`,
          lastResult: '200 OK · Hoàn tất toàn bộ Job vận chuyển, tạo biên bản số điện tử',
          latencyMs: Date.now() - start,
        }));
      }
    } catch (err) {
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastResult: `Hybrid Mode: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
      }));
    }
  };

  // Countdown timer for stage 12 (Thùng sắp tự đóng)
  useEffect(() => {
    if (stage !== 12 || !isCounting) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          transitionToStage(13); // Auto close when countdown hits 0
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [stage, isCounting]);

  const handleNotifyStaff = () => {
    setStaffNotified(true);
    Alert.alert(
      'Đã thông báo Staff',
      'Đã gửi chuông báo và tin nhắn đến điện thoại của Dược sĩ trực tại Nhà thuốc.',
      [{ text: 'Đóng', style: 'default' }]
    );
  };

  const handleWrongItem = () => {
    Alert.alert(
      'Cảnh báo sai vật phẩm',
      'Mã vật phẩm không khớp với đơn thuốc #BN2047. Vui lòng lấy ra và đặt đúng đơn thuốc.',
      [{ text: 'Kiểm tra lại', style: 'default' }]
    );
  };

  const stepperLabels = [
    'Nhận\nnhiệm vụ',
    'Nhận\nvật phẩm',
    'Vận\nchuyển',
    'Đến\nnơi',
    'Bàn\ngiao',
    'Hoàn\nthành',
  ];

  // Determine current active step on the 6-step Stepper
  const getCurrentStep = (): number => {
    if (stage === 1) return 1;
    if (stage >= 2 && stage <= 8) return 2;
    if (stage === 9) return 3; // Đang vận chuyển
    if (stage === 10) return 4; // Đến nơi
    if (stage >= 11 && stage <= 13) return 5; // Bàn giao
    if (stage === 14) return 6; // Hoàn thành
    return 2;
  };

  // Warning step for step 5 when in stage 12 (Thùng sắp tự đóng)
  const getWarningStep = (): number | undefined => {
    if (stage === 12) return 5;
    return undefined;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 1. Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Ionicons name="hardware-chip" size={16} color="#0284C7" />
          <AppText style={styles.robotNameText}>MediRover #001</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowApiConsole(!showApiConsole)}
            style={styles.apiStatusPill}
          >
            <View
              style={[
                styles.onlineDot,
                { backgroundColor: apiStatus.connected ? '#10B981' : '#F59E0B' },
              ]}
            />
            <AppText style={styles.apiStatusPillText}>
              {apiStatus.connected
                ? `Local Backend (${apiStatus.latencyMs}ms)`
                : 'Chế độ Hybrid'}
            </AppText>
            <Ionicons
              name={showApiConsole ? 'chevron-up' : 'chevron-down'}
              size={12}
              color="#0284C7"
            />
          </Pressable>
        </View>
        <View style={styles.topBarRight}>
          <Ionicons name="battery-charging" size={16} color="#10B981" />
          <AppText style={styles.batteryText}>79%</AppText>
          <AppText style={styles.headerTimeText}>20:07</AppText>
        </View>
      </View>

      {/* Collapsible API Inspector Console */}
      {showApiConsole && (
        <View style={styles.apiConsoleBox}>
          <View style={styles.apiConsoleHeader}>
            <Ionicons name="terminal-outline" size={14} color="#38BDF8" />
            <AppText style={styles.apiConsoleTitle}>LOCAL BACKEND API CONSOLE • JOB PROTOCOL</AppText>
            <Pressable onPress={() => setShowApiConsole(false)}>
              <Ionicons name="close" size={16} color="#94A3B8" />
            </Pressable>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>MÁY CHỦ:</AppText>
            <AppText style={styles.apiConsoleVal}>Local Backend (http://localhost:8080)</AppText>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>MÃ NHIỆM VỤ:</AppText>
            <AppText style={styles.apiConsoleVal}>{JOB_ID}</AppText>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>ENDPOINT:</AppText>
            <AppText style={styles.apiConsoleEndpoint}>{apiStatus.lastCall}</AppText>
          </View>
          <View style={styles.apiConsoleRow}>
            <AppText style={styles.apiConsoleLabel}>KẾT QUẢ:</AppText>
            <AppText style={styles.apiConsoleRes} numberOfLines={2}>
              {apiStatus.lastResult}
            </AppText>
          </View>
        </View>
      )}

      {/* 2. Task Banner */}
      <View style={styles.taskBanner}>
        <View style={styles.taskBannerLeft}>
          <AppText style={styles.taskIdText}>#TH02</AppText>
          <View style={styles.priorityBadge}>
            <AppText style={styles.priorityText}>Ưu tiên cao</AppText>
          </View>
          <AppText style={styles.routeSummaryText}>Nhà thuốc → P. Tim mạch</AppText>
        </View>
        <AppText style={styles.timeTag}>20:05</AppText>
      </View>

      {/* 3. Status Tags */}
      <View style={styles.tagRow}>
        <View
          style={[
            styles.tagItem,
            stage === 14 || (stage >= 8 && stage <= 10)
              ? styles.tagItemLocked
              : stage === 13
              ? styles.tagItemTeal
              : (stage >= 11 && stage <= 12) || (stage >= 4 && stage <= 5)
              ? styles.tagItemOrange
              : styles.tagItemDefault,
          ]}
        >
          <Ionicons
            name={
              stage === 14 || (stage >= 8 && stage <= 10) || stage === 13
                ? 'lock-closed-outline'
                : (stage >= 11 && stage <= 12) || (stage >= 4 && stage <= 5)
                ? 'lock-open-outline'
                : 'cube-outline'
            }
            size={13}
            color={
              stage === 14 || (stage >= 8 && stage <= 10)
                ? '#059669'
                : stage === 13
                ? '#0D9488'
                : (stage >= 11 && stage <= 12) || (stage >= 4 && stage <= 5)
                ? '#D97706'
                : '#475569'
            }
          />
          <AppText
            style={[
              styles.tagText,
              stage === 14 || (stage >= 8 && stage <= 10)
                ? { color: '#059669' }
                : stage === 13
                ? { color: '#0F766E' }
                : (stage >= 11 && stage <= 12) || (stage >= 4 && stage <= 5)
                ? { color: '#B45309' }
                : undefined,
            ]}
          >
            {stage === 14
              ? 'Thùng đã khóa'
              : stage === 13
              ? 'Thùng: Đang đóng'
              : stage >= 11 && stage <= 12
              ? 'Thùng: Đang mở'
              : stage >= 8
              ? 'Thùng đã khóa'
              : stage >= 6
              ? 'Đã nạp vật phẩm'
              : stage >= 4
              ? 'Thùng: Đang mở'
              : 'Thùng: Trống'}
          </AppText>
        </View>

        <View style={[styles.tagItem, styles.tagItemHighlight]}>
          <Ionicons name="qr-code-outline" size={13} color="#0284C7" />
          <AppText style={[styles.tagText, { color: '#0284C7' }]}>Quét mã QR</AppText>
        </View>
        <AppText style={styles.zoneText}>Zone A - Tầng 1</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 4. Stepper 6 bước */}
        <LogisticsStepper
          currentStep={getCurrentStep()}
          warningStep={getWarningStep()}
          steps={stepperLabels}
        />

        {/* 5. GIAI ĐOẠN 1: NHIỆM VỤ ĐƯỢC GIAO */}
        {stage === 1 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxBlue}>
              <Ionicons name="clipboard-outline" size={40} color="#0066CC" />
            </View>
            <View style={styles.statusPillBlue}>
              <View style={[styles.dot, { backgroundColor: '#0284C7' }]} />
              <AppText style={[styles.statusPillText, { color: '#0284C7' }]}>
                ĐÃ NHẬN NHIỆM VỤ
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Nhiệm vụ được giao</AppText>

            <View style={styles.detailsCard}>
              <AppText style={styles.cardHeaderTitle}>CHI TIẾT NHIỆM VỤ</AppText>
              <View style={styles.grid2x3}>
                <View style={styles.gridCell}>
                  <AppText style={styles.cellLabel}>VẬT PHẨM</AppText>
                  <AppText style={styles.cellValue}>Đơn thuốc #BN2047</AppText>
                </View>
                <View style={styles.gridCell}>
                  <AppText style={styles.cellLabel}>MÃ VẬT PHẨM</AppText>
                  <AppText style={styles.cellValue}>MED-BN2047-0904</AppText>
                </View>
                <View style={styles.gridCell}>
                  <AppText style={styles.cellLabel}>SỐ LƯỢNG</AppText>
                  <AppText style={styles.cellValue}>1 đơn vị</AppText>
                </View>
                <View style={styles.gridCell}>
                  <AppText style={styles.cellLabel}>NƠI GỬI</AppText>
                  <AppText style={styles.cellValue}>Nhà thuốc</AppText>
                </View>
                <View style={styles.gridCell}>
                  <AppText style={styles.cellLabel}>NƠI NHẬN</AppText>
                  <AppText style={styles.cellValue}>P. Tim mạch</AppText>
                </View>
                <View style={styles.gridCell}>
                  <AppText style={styles.cellLabel}>NGƯỜI NHẬN</AppText>
                  <AppText style={styles.cellValue}>BS. Trần Thị Lan</AppText>
                </View>
              </View>
              <View style={styles.verifyQrBox}>
                <Ionicons name="phone-portrait-outline" size={18} color="#0066CC" />
                <View style={{ flex: 1 }}>
                  <AppText style={styles.verifyQrLabel}>PHƯƠNG THỨC XÁC MINH - ĐÃ THIẾT LẬP</AppText>
                  <AppText style={styles.verifyQrTitle}>Quét mã QR</AppText>
                </View>
              </View>
              <View style={styles.noteBox}>
                <AppText style={styles.noteLabel}>GHI CHÚ</AppText>
                <AppText style={styles.noteText}>Thuốc huyết áp — xác minh QR bắt buộc</AppText>
              </View>
            </View>

            <Pressable onPress={() => transitionToStage(2)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Bắt đầu di chuyển đến Nhà thuốc →</AppText>
            </Pressable>
          </View>
        )}

        {/* 6. GIAI ĐOẠN 2: ĐANG ĐẾN NHÀ THUỐC */}
        {stage === 2 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxBlue}>
              <Ionicons name="map-outline" size={40} color="#0066CC" />
            </View>
            <View style={styles.statusPillBlue}>
              <View style={[styles.dot, { backgroundColor: '#0284C7' }]} />
              <AppText style={[styles.statusPillText, { color: '#0284C7' }]}>
                ĐANG DI CHUYỂN ĐẾN NƠI GỬI
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang đến Nhà thuốc</AppText>

            <View style={styles.journeyCard}>
              <View style={styles.routePointsRow}>
                <View style={styles.pointItem}>
                  <View style={styles.pointIconWrap}>
                    <Ionicons name="hardware-chip" size={18} color="#0066CC" />
                  </View>
                  <AppText style={styles.pointRole}>NƠI ĐI</AppText>
                  <AppText style={styles.pointName}>Zone A</AppText>
                </View>
                <View style={styles.dashLineWrap}>
                  <View style={styles.dashLine} />
                  <View style={styles.distanceBadge}>
                    <AppText style={styles.distanceBadgeText}>22m · ~40s</AppText>
                  </View>
                </View>
                <View style={styles.pointItem}>
                  <View style={[styles.pointIconWrap, styles.destIconWrap]}>
                    <Ionicons name="business" size={18} color="#0F4C81" />
                  </View>
                  <AppText style={styles.pointRole}>ĐIỂM ĐẾN</AppText>
                  <AppText style={styles.pointName}>Nhà thuốc</AppText>
                </View>
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressLabelRow}>
                  <AppText style={styles.progressTitle}>TIẾN ĐỘ HÀNH TRÌNH</AppText>
                  <AppText style={styles.progressPercent}>45%</AppText>
                </View>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: '45%' }]} />
                </View>
              </View>

              <View style={styles.metricsGrid}>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>KHOẢNG CÁCH CÒN LẠI</AppText>
                  <AppText style={styles.metricTileValue}>9.8m</AppText>
                </View>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>DỰ KIẾN ĐẾN</AppText>
                  <AppText style={styles.metricTileValue}>~14s</AppText>
                </View>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>TỐC ĐỘ</AppText>
                  <AppText style={styles.metricTileValue}>0.8 m/s</AppText>
                </View>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>TRẠNG THÁI</AppText>
                  <AppText style={[styles.metricTileValue, { color: '#0284C7' }]}>Đang di chuyển</AppText>
                </View>
              </View>
            </View>

            <Pressable onPress={() => transitionToStage(3)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Robot đã đến Nhà thuốc →</AppText>
            </Pressable>
          </View>
        )}

        {/* 7. GIAI ĐOẠN 3: ROBOT ĐÃ ĐẾN NHÀ THUỐC */}
        {stage === 3 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxRedPin}>
              <Ionicons name="location" size={40} color="#DC2626" />
            </View>
            <View style={styles.statusPillTeal}>
              <View style={[styles.dot, { backgroundColor: '#0F766E' }]} />
              <AppText style={[styles.statusPillText, { color: '#0F766E' }]}>
                ĐÃ ĐẾN NƠI GỬI
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Robot đã đến Nhà thuốc</AppText>

            <View style={styles.pickupCard}>
              <View style={styles.pickupHeader}>
                <View style={styles.boxIconWrap}>
                  <Ionicons name="cube" size={28} color="#D97706" />
                </View>
                <View style={styles.pickupInfo}>
                  <AppText style={styles.pickupTitle}>Đơn thuốc #BN2047</AppText>
                  <AppText style={styles.pickupSubtitle}>Mã: MED-BN2047-0904 · SL: 1</AppText>
                </View>
              </View>
              <View style={styles.divider} />
              <AppText style={styles.waitingStaffText}>
                Robot đang đợi Staff đặt vật phẩm vào thùng.
              </AppText>
            </View>

            <Pressable
              onPress={handleNotifyStaff}
              style={[styles.notifyStaffBtn, staffNotified && styles.notifyStaffBtnDone]}
            >
              <Ionicons
                name={staffNotified ? 'checkmark-circle' : 'megaphone-outline'}
                size={18}
                color="#0066CC"
              />
              <AppText style={styles.notifyStaffText}>
                {staffNotified ? 'Đã thông báo Staff thành công' : 'Thông báo Staff'}
              </AppText>
            </Pressable>

            <Pressable onPress={() => transitionToStage(4)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Tiến hành mở thùng nạp thuốc →</AppText>
            </Pressable>
          </View>
        )}

        {/* 8. GIAI ĐOẠN 4: ĐANG MỞ THÙNG... */}
        {stage === 4 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxOrange}>
              <Ionicons name="settings-outline" size={42} color="#D97706" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                ĐANG MỞ THÙNG
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang mở thùng...</AppText>
            <View style={styles.dotsRow}>
              <View style={[styles.animDot, { backgroundColor: '#D97706' }]} />
              <View style={[styles.animDot, { backgroundColor: '#D97706', opacity: 0.8 }]} />
              <View style={[styles.animDot, { backgroundColor: '#D97706', opacity: 0.6 }]} />
            </View>
            <AppText style={styles.subNote}>Tự động chuyển khi thùng đã mở</AppText>

            <Pressable onPress={() => transitionToStage(5)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Thùng đã mở hoàn toàn →</AppText>
            </Pressable>
          </View>
        )}

        {/* 9. GIAI ĐOẠN 5: ĐẶT VẬT PHẨM VÀO THÙNG */}
        {stage === 5 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxOrange}>
              <Ionicons name="mail-open-outline" size={42} color="#D97706" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                THÙNG ĐANG MỞ · CHỜ ĐẶT VẬT PHẨM
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đặt vật phẩm vào thùng</AppText>

            <View style={styles.itemDetailsCardOrange}>
              <View style={styles.grid2x2}>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>VẬT PHẨM</AppText>
                  <AppText style={styles.cellValue}>Đơn thuốc #BN2047</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>MÃ</AppText>
                  <AppText style={styles.cellValue}>MED-BN2047-0904</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>SỐ LƯỢNG</AppText>
                  <AppText style={styles.cellValue}>1 đơn vị</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>CẢM BIẾN</AppText>
                  <AppText style={[styles.cellValue, { color: '#D97706' }]}>⏳ Đang chờ...</AppText>
                </View>
              </View>
            </View>

            <View style={styles.sensorHintRow}>
              <View style={[styles.dot, { backgroundColor: '#F59E0B' }]} />
              <AppText style={styles.sensorHintText}>Cảm biến tự động phát hiện vật phẩm</AppText>
            </View>

            <Pressable onPress={() => transitionToStage(6)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Cảm biến phát hiện → Kiểm tra vật phẩm</AppText>
            </Pressable>
          </View>
        )}

        {/* 10. GIAI ĐOẠN 6 (Ảnh 5 mới): ĐANG XÁC NHẬN VẬT PHẨM + NÚT CHỌN */}
        {stage === 6 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxBlue}>
              <Ionicons name="search-outline" size={42} color="#0066CC" />
            </View>
            <View style={styles.statusPillBlue}>
              <View style={[styles.dot, { backgroundColor: '#0284C7' }]} />
              <AppText style={[styles.statusPillText, { color: '#0284C7' }]}>
                ĐANG KIỂM TRA VẬT PHẨM
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang xác nhận vật phẩm</AppText>

            {/* Checklist Card */}
            <View style={styles.checklistCard}>
              <View style={styles.checkItem}>
                <Ionicons name="checkmark-circle" size={22} color="#10B981" />
                <AppText style={styles.checkItemSuccessText}>
                  Cảm biến phát hiện vật phẩm
                </AppText>
              </View>
              <View style={styles.checkItem}>
                <Ionicons name="hourglass-outline" size={20} color="#D97706" />
                <AppText style={styles.checkItemPendingText}>
                  Đang kiểm tra mã vật phẩm...
                </AppText>
              </View>
              <View style={styles.checkItem}>
                <Ionicons name="hourglass-outline" size={20} color="#D97706" />
                <AppText style={styles.checkItemPendingText}>
                  Đang xác nhận số lượng...
                </AppText>
              </View>
            </View>

            {/* 2 Nút: Vật phẩm đúng / Sai vật phẩm */}
            <View style={styles.twoButtonsRow}>
              <Pressable
                onPress={() => transitionToStage(7)}
                style={styles.greenHalfBtn}
              >
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <AppText style={styles.greenHalfBtnText}>Vật phẩm đúng</AppText>
              </Pressable>

              <Pressable
                onPress={handleWrongItem}
                style={styles.redHalfBtn}
              >
                <Ionicons name="close" size={18} color="#DC2626" />
                <AppText style={styles.redHalfBtnText}>Sai vật phẩm</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {/* 11. GIAI ĐOẠN 7 (Ảnh 4 mới): VẬT PHẨM ĐÃ ĐƯỢC NHẬN */}
        {stage === 7 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxGreen}>
              <Ionicons name="checkmark-circle" size={46} color="#10B981" />
            </View>
            <View style={styles.statusPillGreen}>
              <View style={[styles.dot, { backgroundColor: '#10B981' }]} />
              <AppText style={[styles.statusPillText, { color: '#047857' }]}>
                ĐÃ NHẬN VẬT PHẨM
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Vật phẩm đã được nhận</AppText>

            <View style={styles.itemDetailsCardGreen}>
              <View style={styles.grid2x2}>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>VẬT PHẨM</AppText>
                  <AppText style={styles.cellValue}>Đơn thuốc #BN2047</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>THỜI GIAN NHẬN</AppText>
                  <AppText style={styles.cellValue}>20:07</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>CẢM BIẾN</AppText>
                  <AppText style={[styles.cellValue, { color: '#10B981' }]}>
                    ✓ Xác nhận có vật...
                  </AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>BƯỚC TIẾP</AppText>
                  <AppText style={[styles.cellValue, { color: '#0F172A' }]}>
                    Đóng và khóa thùng
                  </AppText>
                </View>
              </View>
            </View>

            <Pressable onPress={() => transitionToStage(8)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Tiến hành đóng và khóa thùng →</AppText>
            </Pressable>
          </View>
        )}

        {/* 12. GIAI ĐOẠN 8 (Ảnh 3 mới): ĐANG KHÓA THÙNG... */}
        {stage === 8 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxTeal}>
              <Ionicons name="settings-outline" size={42} color="#0D9488" />
            </View>
            <View style={styles.statusPillTeal}>
              <View style={[styles.dot, { backgroundColor: '#0D9488' }]} />
              <AppText style={[styles.statusPillText, { color: '#0F766E' }]}>
                ĐANG ĐÓNG VÀ KHÓA THÙNG
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang khóa thùng...</AppText>
            <View style={styles.dotsRow}>
              <View style={[styles.animDot, { backgroundColor: '#0D9488' }]} />
              <View style={[styles.animDot, { backgroundColor: '#0D9488', opacity: 0.8 }]} />
              <View style={[styles.animDot, { backgroundColor: '#0D9488', opacity: 0.6 }]} />
            </View>

            <Pressable onPress={() => transitionToStage(9)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Bắt đầu vận chuyển đến P. Tim mạch →</AppText>
            </Pressable>
          </View>
        )}

        {/* 13. GIAI ĐOẠN 9 (Ảnh 2 mới): ĐANG ĐẾN P. TIM MẠCH (XE ĐỎ VẬN CHUYỂN) */}
        {stage === 9 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxRedCar}>
              <Ionicons name="car-sport" size={46} color="#DC2626" />
            </View>
            <View style={styles.statusPillBlue}>
              <View style={[styles.dot, { backgroundColor: '#0284C7' }]} />
              <AppText style={[styles.statusPillText, { color: '#0284C7' }]}>
                ĐANG VẬN CHUYỂN
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang đến P. Tim mạch</AppText>

            {/* Red Car Transit Card */}
            <View style={styles.transitCard}>
              <View style={styles.transitHeaderRow}>
                <View style={styles.lockBoxWrap}>
                  <Ionicons name="lock-closed" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.lockBoxTitle}>Thùng đang khóa</AppText>
                  <AppText style={styles.lockBoxSubtitle}>Vật phẩm được bảo vệ</AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText style={styles.distanceRemainingBig}>49m</AppText>
                  <AppText style={styles.percentSmall}>44%</AppText>
                </View>
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: '44%' }]} />
                </View>
              </View>

              <View style={styles.metricsGrid}>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>DỰ KIẾN ĐẾN</AppText>
                  <AppText style={styles.metricTileValue}>~74s</AppText>
                </View>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>TỐC ĐỘ</AppText>
                  <AppText style={styles.metricTileValue}>0.9 m/s</AppText>
                </View>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>MỨC ƯU TIÊN</AppText>
                  <AppText style={[styles.metricTileValue, { color: '#DC2626' }]}>
                    Ưu tiên cao
                  </AppText>
                </View>
                <View style={styles.metricTile}>
                  <AppText style={styles.metricTileLabel}>TRẠNG THÁI</AppText>
                  <AppText style={[styles.metricTileValue, { color: '#0284C7' }]}>
                    Đang giao
                  </AppText>
                </View>
              </View>
            </View>

            <Pressable onPress={() => transitionToStage(10)} style={styles.actionBtnBlue}>
              <AppText style={styles.actionBtnText}>Robot đã đến P. Tim mạch →</AppText>
            </Pressable>
          </View>
        )}

        {/* 14. GIAI ĐOẠN 10 (Ảnh 1 mới): ROBOT ĐÃ ĐẾN P. TIM MẠCH - CHỜ QUÉT QR */}
        {stage === 10 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxHospital}>
              <Ionicons name="business" size={42} color="#0F4C81" />
            </View>
            <View style={styles.statusPillTeal}>
              <View style={[styles.dot, { backgroundColor: '#0F766E' }]} />
              <AppText style={[styles.statusPillText, { color: '#0F766E' }]}>
                ĐÃ ĐẾN ĐIỂM GIAO
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Robot đã đến P. Tim mạch</AppText>
            <AppText style={styles.heroSubtitle}>
              Đang chờ người nhận · Thùng vẫn khóa
            </AppText>

            {/* Recipient & Locked Box Card */}
            <View style={styles.arrivalCard}>
              <View style={styles.infoCardRow}>
                <View style={styles.infoCell}>
                  <AppText style={styles.cellLabel}>NGƯỜI NHẬN</AppText>
                  <AppText style={styles.cellValue}>BS. Trần Thị Lan</AppText>
                </View>
                <View style={styles.infoCell}>
                  <AppText style={styles.cellLabel}>THÙNG</AppText>
                  <AppText style={[styles.cellValue, { color: '#059669' }]}>
                    🔒 Đang khóa
                  </AppText>
                </View>
              </View>

              <View style={styles.authMethodPill}>
                <Ionicons name="phone-portrait-outline" size={18} color="#0066CC" />
                <View>
                  <AppText style={styles.authMethodLabel}>
                    PHƯƠNG THỨC XÁC MINH BẮT BUỘC
                  </AppText>
                  <AppText style={styles.authMethodValue}>Quét mã QR</AppText>
                </View>
              </View>
            </View>

            {/* Warning Box */}
            <View style={styles.warningBox}>
              <Ionicons name="warning-outline" size={18} color="#D97706" />
              <AppText style={styles.warningText}>
                Thùng chỉ được mở sau khi xác minh đúng phương thức.
              </AppText>
            </View>

            {/* Chuyển tiếp: Quét mã QR thành công */}
            <Pressable onPress={() => transitionToStage(11)} style={styles.actionBtnBlue}>
              <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>Xác minh QR thành công → Mở thùng</AppText>
            </Pressable>

            <Pressable
              onPress={() => transitionToStage(1)}
              style={styles.secondaryActionBtn}
            >
              <AppText style={styles.secondaryActionBtnText}>Bắt đầu lại chu trình</AppText>
            </Pressable>
          </View>
        )}

        {/* 15. GIAI ĐOẠN 11 (Ảnh 1 mới): VUI LÒNG LẤY VẬT PHẨM */}
        {stage === 11 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxHands}>
              <Ionicons name="hand-left-outline" size={38} color="#D97706" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                ĐANG CHỜ NGƯỜI NHẬN LẤY VẬT PHẨM
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Vui lòng lấy vật phẩm</AppText>

            {/* Card vật tư & cảm biến */}
            <View style={styles.handoverCard}>
              <AppText style={styles.handoverItemTitle}>Vật tư y tế thông thường</AppText>
              <View style={styles.handoverSensorRow}>
                <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
                <AppText style={styles.handoverSensorText}>
                  Cảm biến: Vật phẩm vẫn còn trong thùng
                </AppText>
              </View>
              <AppText style={styles.autoCloseNote}>
                Thùng tự đóng nếu không lấy trong 30s
              </AppText>
            </View>

            {/* 2 Nút thao tác: ✓ Đã lấy vật phẩm / Chưa lấy được */}
            <View style={styles.twoButtonsRow}>
              <Pressable
                onPress={() => transitionToStage(13)}
                style={styles.greenActionBtn}
              >
                <AppText style={styles.greenActionBtnText}>✓ Đã lấy vật phẩm</AppText>
              </Pressable>

              <Pressable
                onPress={() => {
                  setCountdown(29);
                  setIsCounting(true);
                  transitionToStage(12);
                }}
                style={styles.beigeActionBtn}
              >
                <AppText style={styles.beigeActionBtnText}>Chưa lấy được</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {/* 16. GIAI ĐOẠN 12 (Ảnh 2 mới): THÙNG SẮP TỰ ĐÓNG (CẢNH BÁO 29S) */}
        {stage === 12 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxWarning}>
              <Ionicons name="warning" size={42} color="#DC2626" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                VẬT PHẨM CHƯA ĐƯỢC LẤY
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Thùng sắp tự đóng</AppText>
            <AppText style={styles.countdownBigNumber}>{countdown}s</AppText>

            {/* Card thông báo đếm ngược */}
            <View style={styles.warningCard}>
              <AppText style={styles.warningCardNotice}>
                Cảm biến xác nhận vật phẩm vẫn còn trong thùng. Robot sẽ đóng khóa thùng khi hết giờ.
              </AppText>
              {/* Progress Bar đếm ngược */}
              <View style={styles.countdownProgressTrack}>
                <View
                  style={[
                    styles.countdownProgressFill,
                    { width: `${Math.max(5, (countdown / 30) * 100)}%` },
                  ]}
                />
              </View>
            </View>

            {/* 2 Nút: Đã lấy vật phẩm / Đóng thùng và báo Staff */}
            <View style={styles.fullButtonsColumn}>
              <Pressable
                onPress={() => transitionToStage(13)}
                style={styles.fullGreenBtn}
              >
                <AppText style={styles.greenActionBtnText}>✓ Đã lấy vật phẩm</AppText>
              </Pressable>

              <Pressable
                onPress={() => {
                  Alert.alert(
                    'Đã gửi cảnh báo Staff',
                    'Đã ghi nhận sự cố chưa lấy vật phẩm tại P. Tim mạch và thông báo đến Điều dưỡng phụ trách.',
                    [{ text: 'Đóng thùng ngay', onPress: () => transitionToStage(13) }]
                  );
                }}
                style={styles.fullRedOutlineBtn}
              >
                <AppText style={styles.redOutlineBtnText}>Đóng thùng và báo Staff</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {/* 17. GIAI ĐOẠN 13 (Ảnh 3 mới): ĐANG ĐÓNG THÙNG... */}
        {stage === 13 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxTeal}>
              <Ionicons name="settings-outline" size={42} color="#0D9488" />
            </View>
            <View style={styles.statusPillTeal}>
              <View style={[styles.dot, { backgroundColor: '#0D9488' }]} />
              <AppText style={[styles.statusPillText, { color: '#0F766E' }]}>
                ĐANG ĐÓNG VÀ KHÓA THÙNG
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang đóng thùng...</AppText>
            <View style={styles.dotsRow}>
              <View style={[styles.animDot, { backgroundColor: '#0D9488' }]} />
              <View style={[styles.animDot, { backgroundColor: '#0D9488', opacity: 0.8 }]} />
              <View style={[styles.animDot, { backgroundColor: '#0D9488', opacity: 0.6 }]} />
            </View>
            <AppText style={styles.subNoteTeal}>Tự động chuyển sang 'Đã bàn giao'</AppText>

            <Pressable onPress={() => transitionToStage(14)} style={[styles.actionBtnBlue, { marginTop: 12 }]}>
              <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>Xác nhận hoàn tất bàn giao →</AppText>
            </Pressable>
          </View>
        )}

        {/* 18. GIAI ĐOẠN 14: HOÀN TẤT NHIỆM VỤ / ĐÃ BÀN GIAO */}
        {stage === 14 && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxGreen}>
              <Ionicons name="checkmark-circle" size={46} color="#10B981" />
            </View>
            <View style={styles.statusPillGreen}>
              <View style={[styles.dot, { backgroundColor: '#10B981' }]} />
              <AppText style={[styles.statusPillText, { color: '#047857' }]}>
                NHIỆM VỤ HOÀN THÀNH
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đã bàn giao thành công</AppText>
            <AppText style={styles.heroSubtitle}>
              Biên bản bàn giao số điện tử đã được lưu vào hệ thống bệnh viện
            </AppText>

            <View style={styles.completedReceiptCard}>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>MÃ NHIỆM VỤ</AppText>
                <AppText style={styles.receiptValueBold}>#TH02</AppText>
              </View>
              <View style={styles.receiptDivider} />
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>VẬT PHẨM</AppText>
                <AppText style={styles.receiptValue}>Đơn thuốc #BN2047</AppText>
              </View>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>ĐIỂM GIAO</AppText>
                <AppText style={styles.receiptValue}>P. Tim mạch (BS. Trần Thị Lan)</AppText>
              </View>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>XÁC THỰC</AppText>
                <AppText style={[styles.receiptValue, { color: '#0284C7' }]}>
                  ✓ Quét mã QR thành công
                </AppText>
              </View>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>CẢM BIẾN</AppText>
                <AppText style={[styles.receiptValue, { color: '#10B981' }]}>
                  ✓ Thùng trống, đã khóa an toàn
                </AppText>
              </View>
            </View>

            <Pressable onPress={() => transitionToStage(1)} style={styles.actionBtnBlue}>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>Bắt đầu chu trình nhiệm vụ mới</AppText>
            </Pressable>
          </View>
        )}

        {/* 19. THANH ĐIỀU KHIỂN CHỌN XEM NHANH TOÀN BỘ 14 GIAI ĐOẠN */}
        <View style={styles.controlBox}>
          <AppText style={styles.controlTitle}>CHỌN XEM NHANH TOÀN BỘ 14 GIAI ĐOẠN VẬN CHUYỂN QR:</AppText>
          <View style={styles.stepTabsRow}>
            {([1, 2, 3, 4, 5] as QrStage[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => transitionToStage(s)}
                style={[styles.stepTab, stage === s && styles.stepTabActive]}
              >
                <AppText style={[styles.stepTabLabel, stage === s && styles.stepTabLabelActive]}>
                  {['1. Nhận', '2. Đi', '3. Đến trạm', '4. Mở', '5. Nạp'][s - 1]}
                </AppText>
              </Pressable>
            ))}
          </View>

          <View style={[styles.stepTabsRow, { marginTop: 4 }]}>
            {([6, 7, 8, 9, 10] as QrStage[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => transitionToStage(s)}
                style={[styles.stepTab, stage === s && styles.stepTabActive]}
              >
                <AppText style={[styles.stepTabLabel, stage === s && styles.stepTabLabelActive]}>
                  {['6. Kiểm tra', '7. Đã nhận', '8. Khóa', '9. Xe chạy', '10. Đến đích'][s - 6]}
                </AppText>
              </Pressable>
            ))}
          </View>

          <View style={[styles.stepTabsRow, { marginTop: 4 }]}>
            {([11, 12, 13, 14] as QrStage[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  if (s === 12) {
                    setCountdown(29);
                    setIsCounting(true);
                  }
                  transitionToStage(s);
                }}
                style={[styles.stepTab, stage === s && styles.stepTabActive]}
              >
                <AppText style={[styles.stepTabLabel, stage === s && styles.stepTabLabelActive]}>
                  {['11. Lấy thuốc', '12. Cảnh báo 29s', '13. Đóng thùng', '14. Hoàn tất'][s - 11]}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  robotNameText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  apiStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  apiStatusPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0066CC',
  },
  apiConsoleBox: {
    backgroundColor: '#0F172A',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 3,
  },
  apiConsoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  apiConsoleTitle: {
    fontSize: 9,
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
    width: 80,
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
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  onlineText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#059669',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batteryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  headerTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  taskBanner: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  taskBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  taskIdText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  priorityBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#DC2626',
  },
  routeSummaryText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  timeTag: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagItemDefault: {
    backgroundColor: '#F1F5F9',
  },
  tagItemOrange: {
    backgroundColor: '#FEF3C7',
  },
  tagItemLocked: {
    backgroundColor: '#ECFDF5',
  },
  tagItemTeal: {
    backgroundColor: '#CCFBF1',
  },
  tagItemHighlight: {
    backgroundColor: '#E0F2FE',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  zoneText: {
    fontSize: 10,
    color: '#94A3B8',
    marginLeft: 'auto',
    fontWeight: '500',
  },
  scrollContent: {
    padding: 14,
    gap: 12,
    paddingBottom: 40,
  },
  stateContainer: {
    alignItems: 'center',
    marginVertical: 4,
    gap: 8,
  },
  heroIconBoxBlue: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginVertical: 4,
  },
  heroIconBoxGreen: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginVertical: 4,
  },
  heroIconBoxTeal: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99F6E4',
    marginVertical: 4,
  },
  heroIconBoxHands: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFEDD5',
    marginVertical: 4,
  },
  heroIconBoxWarning: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
    marginVertical: 4,
  },
  heroIconBoxRedCar: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginVertical: 4,
  },
  heroIconBoxHospital: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginVertical: 4,
  },
  heroIconBoxRedPin: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginVertical: 4,
  },
  heroIconBoxOrange: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginVertical: 4,
  },
  statusPillBlue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillTeal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillGreen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillOrange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  animDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  subNote: {
    fontSize: 12,
    color: '#D97706',
    fontWeight: '500',
  },
  // Details Card
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeaderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  grid2x3: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridCell: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cellLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  cellValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  verifyQrBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0F7FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D0E4FA',
    padding: 12,
  },
  verifyQrLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#0066CC',
    letterSpacing: 0.5,
  },
  verifyQrTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#00478F',
  },
  noteBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  noteLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  noteText: {
    fontSize: 12,
    color: '#334155',
    marginTop: 2,
    fontWeight: '500',
  },
  // Journey Card
  journeyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    gap: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  routePointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pointItem: {
    alignItems: 'center',
    width: 90,
  },
  pointIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  destIconWrap: {
    backgroundColor: '#EFF6FF',
  },
  pointRole: {
    fontSize: 8,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  pointName: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  dashLineWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginHorizontal: 8,
  },
  dashLine: {
    width: '100%',
    height: 2,
    backgroundColor: '#0284C7',
    borderRadius: 1,
  },
  distanceBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  distanceBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0284C7',
  },
  progressSection: {
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  progressPercent: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0284C7',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0284C7',
    borderRadius: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricTile: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricTileLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  metricTileValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 4,
  },
  // Pickup Card
  pickupCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    width: '100%',
    gap: 12,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  pickupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  boxIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pickupInfo: {
    flex: 1,
  },
  pickupTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  pickupSubtitle: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#D1FAE5',
  },
  waitingStaffText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
    lineHeight: 18,
  },
  notifyStaffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    width: '100%',
  },
  notifyStaffBtnDone: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  notifyStaffText: {
    color: '#0066CC',
    fontSize: 13,
    fontWeight: '700',
  },
  // Item details card orange
  itemDetailsCardOrange: {
    backgroundColor: '#FFFDFB',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FED7AA',
    width: '100%',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  itemDetailsCardGreen: {
    backgroundColor: '#F0FDF4',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    width: '100%',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  grid2x2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell2x2: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sensorHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  sensorHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
  },
  // Checklist Card
  checklistCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkItemSuccessText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#10B981',
  },
  checkItemPendingText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
  },
  twoButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 4,
  },
  greenHalfBtn: {
    flex: 1.2,
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  greenHalfBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  redHalfBtn: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  redHalfBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  // Transit Card
  transitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  transitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lockBoxWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBoxTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  lockBoxSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  distanceRemainingBig: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0066CC',
  },
  percentSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  // Arrival Card
  arrivalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  infoCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoCell: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  authMethodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0F7FF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#D0E4FA',
  },
  authMethodLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#0066CC',
    letterSpacing: 0.5,
  },
  authMethodValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#00478F',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    width: '100%',
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
    fontWeight: '500',
  },
  // Action Buttons
  actionBtnBlue: {
    backgroundColor: '#0066CC',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  countdownBigNumber: {
    fontSize: 44,
    fontWeight: '900',
    color: '#F59E0B',
    lineHeight: 48,
    marginVertical: 2,
  },
  subNoteTeal: {
    fontSize: 12,
    color: '#0F766E',
    fontWeight: '500',
  },
  // Handover Card
  handoverCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    width: '100%',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  handoverItemTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  handoverSensorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  handoverSensorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D97706',
  },
  autoCloseNote: {
    fontSize: 11,
    color: '#9A3412',
    opacity: 0.8,
  },
  greenActionBtn: {
    flex: 1.2,
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  greenActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  beigeActionBtn: {
    flex: 1,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  beigeActionBtnText: {
    color: '#B45309',
    fontSize: 13,
    fontWeight: '700',
  },
  // Warning Card
  warningCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    width: '100%',
    gap: 12,
  },
  warningCardNotice: {
    fontSize: 12,
    color: '#B45309',
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
  },
  countdownProgressTrack: {
    height: 8,
    backgroundColor: '#FDE68A',
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
  },
  countdownProgressFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 4,
  },
  fullButtonsColumn: {
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  fullGreenBtn: {
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  fullRedOutlineBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#EF4444',
  },
  redOutlineBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
  completedReceiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    gap: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  receiptValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  receiptValueBold: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  secondaryActionBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 8,
  },
  secondaryActionBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  // Control Box
  controlBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    gap: 6,
    marginTop: 10,
  },
  controlTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  stepTabsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  stepTab: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 2,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
  },
  stepTabActive: {
    backgroundColor: '#0066CC',
  },
  stepTabLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  stepTabLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
