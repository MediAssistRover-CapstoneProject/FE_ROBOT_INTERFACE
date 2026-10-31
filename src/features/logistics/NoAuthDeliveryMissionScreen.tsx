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

export type NoAuthStage =
  | 'arrived' // Ảnh 1: Robot đã đến P. Điều dưỡng (Đang chờ người nhận · Thùng vẫn khóa)
  | 'obstacle' // Ảnh 3: Đang tránh vật cản (Phát hiện vật cản / Bị chặn đường - Unhappy case)
  | 'searching' // Ảnh 4: Đang tìm người nhận (Đếm ngược 58s)
  | 'returning' // Ảnh 2: Đang chuẩn bị quay về (Staff hủy / Hết thời gian - Unhappy case)
  | 'retrieval' // Vui lòng lấy vật phẩm (Cảm biến xác nhận)
  | 'warning_close' // Thùng sắp tự đóng (29s)
  | 'closing' // Đang đóng thùng...
  | 'completed'; // Hoàn tất / Biên bản bàn giao

export function NoAuthDeliveryMissionScreen() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<NoAuthStage>('arrived');
  const [searchCountdown, setSearchCountdown] = useState(58);
  const [closeCountdown, setCloseCountdown] = useState(29);
  const [isSearching, setIsSearching] = useState(false);

  // Live Local Backend API Connection Status
  const [apiStatus, setApiStatus] = useState<{
    connected: boolean;
    latencyMs: number;
    lastCall?: string;
    lastResult?: string;
    loading: boolean;
  }>({
    connected: false,
    latencyMs: 0,
    loading: false,
  });

  // Check live API reachability on mount
  useEffect(() => {
    robotApiService.pingServer().then((res) => {
      setApiStatus((prev) => ({
        ...prev,
        connected: res.ok,
        latencyMs: res.latencyMs,
        lastCall: 'GET /api/v1/public/zones',
        lastResult: res.ok ? `200 OK (${res.latencyMs}ms)` : res.error || 'Lỗi kết nối',
      }));
    });
  }, []);

  // Countdown timer for searching state (58s)
  useEffect(() => {
    if (stage !== 'searching') return;
    setIsSearching(true);
    const interval = setInterval(() => {
      setSearchCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Hết giờ tìm kiếm -> Tự động chuyển sang quay về kho (Unhappy case timeout)
          setStage('returning');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [stage]);

  // Real API Calls for Unhappy cases and lifecycle
  const handleTriggerObstacleApi = async () => {
    setStage('obstacle');
    setApiStatus((prev) => ({ ...prev, loading: true }));
    try {
      const res = await robotApiService.reportStepError(
        'step-vt001-03',
        'OBSTACLE_BLOCKED',
        { distanceM: 1.2, sensor: 'LIDAR_ULTRASONIC', action: 'SEARCHING_REROUTE' },
      );
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/job-steps/step-vt001-03/errors',
        lastResult: JSON.stringify(res || { status: 'ERROR_RECORDED' }),
      }));
    } catch (err: unknown) {
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/job-steps/step-vt001-03/errors',
        lastResult: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleTriggerSearchingApi = async () => {
    setSearchCountdown(58);
    setStage('searching');
    setApiStatus((prev) => ({ ...prev, loading: true }));
    try {
      const res = await robotApiService.reportStepStarted('step-vt001-04', 'job-vt001');
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/job-steps/step-vt001-04/started',
        lastResult: JSON.stringify(res || { status: 'STARTED' }),
      }));
    } catch (err: unknown) {
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/job-steps/step-vt001-04/started',
        lastResult: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleTriggerReturnApi = async () => {
    setStage('returning');
    setApiStatus((prev) => ({ ...prev, loading: true }));
    try {
      const res = await robotApiService.reportJobError(
        'job-vt001',
        'TASK_CANCELLED_BY_STAFF',
        'Staff xác nhận hủy nhiệm vụ tại P. Điều dưỡng',
        { returnDestination: 'Kho vật tư - Zone A' },
      );
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/jobs/job-vt001/errors',
        lastResult: JSON.stringify(res || { status: 'RETURNING_TO_BASE' }),
      }));
    } catch (err: unknown) {
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/jobs/job-vt001/errors',
        lastResult: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleTriggerArrivedApi = async () => {
    setStage('arrived');
    setApiStatus((prev) => ({ ...prev, loading: true }));
    try {
      const res = await robotApiService.reportStepResult('step-vt001-04', {
        arrivedAt: new Date().toISOString(),
        location: 'P. Điều dưỡng - Zone A',
      });
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/job-steps/step-vt001-04/result',
        lastResult: JSON.stringify(res || { status: 'STEP_COMPLETED' }),
      }));
    } catch (err: unknown) {
      setApiStatus((prev) => ({
        ...prev,
        loading: false,
        lastCall: 'POST /api/v1/pi/job-steps/step-vt001-04/result',
        lastResult: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  // Countdown timer for warning close (29s)
  useEffect(() => {
    if (stage !== 'warning_close') return;
    const interval = setInterval(() => {
      setCloseCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setStage('closing');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [stage]);

  const stepperLabels = [
    'Nhận\nnhiệm vụ',
    'Nạp vật\nphẩm',
    'Vận\nchuyển',
    'Đến\nnơi',
    'Bàn\ngiao',
    'Hoàn\nthành',
  ];

  // Determine active step
  const getCurrentStep = (): number => {
    if (stage === 'obstacle') return 3;
    if (stage === 'arrived' || stage === 'searching' || stage === 'returning') return 4;
    if (stage === 'retrieval' || stage === 'warning_close' || stage === 'closing') return 5;
    if (stage === 'completed') return 6;
    return 4;
  };

  // Warning step for Stepper (Step 3 obstacle)
  const getWarningStep = (): number | undefined => {
    if (stage === 'obstacle') return 3;
    if (stage === 'warning_close') return 5;
    return undefined;
  };

  // Return step for Stepper (Step 4 returning)
  const getReturnStep = (): number | undefined => {
    if (stage === 'returning') return 4;
    return undefined;
  };

  // Compartment status tag text & color
  const isCompartmentOpen = stage === 'retrieval' || stage === 'warning_close';
  const isCompartmentClosing = stage === 'closing';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 1. Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Ionicons name="hardware-chip" size={16} color="#0284C7" />
          <AppText style={styles.robotNameText}>MediRover #001</AppText>
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <AppText style={styles.onlineText}>Online</AppText>
          </View>
        </View>
        <View style={styles.topBarRight}>
          <Ionicons name="battery-charging" size={16} color="#10B981" />
          <AppText style={styles.batteryText}>79%</AppText>
          <AppText style={styles.headerTimeText}>20:00</AppText>
        </View>
      </View>

      {/* 2. Task Banner */}
      <View style={styles.taskBanner}>
        <View style={styles.taskBannerLeft}>
          <AppText style={styles.taskIdText}>#VT001</AppText>
          <View style={styles.priorityBadge}>
            <AppText style={styles.priorityText}>Bình thường</AppText>
          </View>
          <AppText style={styles.routeSummaryText}>Kho vật tư → P. Điều dưỡng</AppText>
        </View>
        <AppText style={styles.timeTag}>19:59</AppText>
      </View>

      {/* 3. Status Tags */}
      <View style={styles.tagRow}>
        <View
          style={[
            styles.tagItem,
            isCompartmentOpen
              ? styles.tagItemOrange
              : isCompartmentClosing
              ? styles.tagItemTeal
              : styles.tagItemLocked,
          ]}
        >
          <Ionicons
            name={isCompartmentOpen ? 'lock-open-outline' : 'lock-closed-outline'}
            size={13}
            color={
              isCompartmentOpen
                ? '#D97706'
                : isCompartmentClosing
                ? '#0D9488'
                : '#059669'
            }
          />
          <AppText
            style={[
              styles.tagText,
              {
                color: isCompartmentOpen
                  ? '#B45309'
                  : isCompartmentClosing
                  ? '#0F766E'
                  : '#059669',
              },
            ]}
          >
            {isCompartmentOpen
              ? 'Thùng: Đang mở'
              : isCompartmentClosing
              ? 'Thùng: Đang đóng'
              : 'Thùng đã khóa'}
          </AppText>
        </View>

        <View style={[styles.tagItem, styles.tagItemGreen]}>
          <Ionicons name="shield-checkmark-outline" size={13} color="#059669" />
          <AppText style={[styles.tagText, { color: '#059669' }]}>Không cần quét</AppText>
        </View>
        <AppText style={styles.zoneText}>Zone A - Tầng 1</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 4. Stepper 6 bước */}
        <LogisticsStepper
          currentStep={getCurrentStep()}
          warningStep={getWarningStep()}
          returnStep={getReturnStep()}
          steps={stepperLabels}
        />

        {/* ============================================================ */}
        {/* 5. GIAI ĐOẠN 1 (Ảnh 1): ROBOT ĐÃ ĐẾN P. ĐIỀU DƯỠNG */}
        {/* ============================================================ */}
        {stage === 'arrived' && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxBlue}>
              <Ionicons name="business" size={42} color="#0F4C81" />
            </View>
            <View style={styles.statusPillTeal}>
              <View style={[styles.dot, { backgroundColor: '#0F766E' }]} />
              <AppText style={[styles.statusPillText, { color: '#0F766E' }]}>
                ĐÃ ĐẾN ĐIỂM GIAO
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Robot đã đến P. Điều dưỡng</AppText>
            <AppText style={styles.heroSubtitle}>
              Đang chờ người nhận · Thùng vẫn khóa
            </AppText>

            {/* Recipient & Locked Box Card */}
            <View style={styles.arrivalCard}>
              <View style={styles.infoCardRow}>
                <View style={styles.infoCell}>
                  <AppText style={styles.cellLabel}>NGƯỜI NHẬN</AppText>
                  <AppText style={styles.cellValue}>Điều dưỡng trực</AppText>
                </View>
                <View style={styles.infoCell}>
                  <AppText style={styles.cellLabel}>THÙNG</AppText>
                  <AppText style={[styles.cellValue, { color: '#059669' }]}>
                    🔒 Đang khóa
                  </AppText>
                </View>
              </View>

              <View style={styles.authMethodPill}>
                <Ionicons name="shield-checkmark" size={18} color="#059669" />
                <View>
                  <AppText style={styles.authMethodLabel}>
                    PHƯƠNG THỨC XÁC MINH - ĐÃ THIẾT LẬP
                  </AppText>
                  <AppText style={styles.authMethodValue}>Không cần quét</AppText>
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

            {/* Nút hành động */}
            <Pressable
              onPress={() => {
                setSearchCountdown(58);
                setStage('searching');
              }}
              style={styles.actionBtnBlue}
            >
              <Ionicons name="volume-medium-outline" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>
                Tìm người nhận (Phát loa & Đếm ngược) →
              </AppText>
            </Pressable>

            <Pressable
              onPress={() => setStage('retrieval')}
              style={styles.greenActionBtnFull}
            >
              <Ionicons name="hand-left" size={18} color="#FFFFFF" />
              <AppText style={styles.greenActionBtnText}>
                Tôi là người nhận → Mở thùng lấy vật tư
              </AppText>
            </Pressable>
          </View>
        )}

        {/* ============================================================ */}
        {/* 6. GIAI ĐOẠN 2 (Ảnh 3): ĐANG TRÁNH VẬT CẢN (UNHAPPY CASE API) */}
        {/* ============================================================ */}
        {stage === 'obstacle' && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxObstacle}>
              <Ionicons name="alert-circle" size={44} color="#D97706" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                PHÁT HIỆN VẬT CẢN
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang tránh vật cản</AppText>

            {/* 2x2 Info Grid Card */}
            <View style={styles.obstacleCard}>
              <View style={styles.grid2x2}>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>TRẠNG THÁI</AppText>
                  <AppText style={[styles.cellValue, { color: '#D97706' }]}>
                    Đang xử lý
                  </AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>THÙNG</AppText>
                  <AppText style={[styles.cellValue, { color: '#059669' }]}>
                    🔒 Vẫn khóa
                  </AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>BÁO CÁO</AppText>
                  <AppText style={[styles.cellValue, { color: '#10B981' }]}>
                    ✓ Đã gửi
                  </AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>VẬT CẢN</AppText>
                  <AppText style={[styles.cellValue, { color: '#0F172A' }]}>
                    Vật cản phía trước
                  </AppText>
                </View>
              </View>
            </View>

            {/* Sensor Info Box */}
            <View style={styles.sensorInfoBox}>
              <Ionicons name="radio-outline" size={18} color="#D97706" />
              <AppText style={styles.sensorInfoText}>
                Cảm biến LiDAR & Siêu âm phát hiện chướng ngại vật cách 1.2m. Robot đang tự động quét tìm lộ trình phụ.
              </AppText>
            </View>

            {/* Xử lý tiếp */}
            <Pressable onPress={() => setStage('arrived')} style={styles.actionBtnBlue}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>
                ✓ Đã né xong vật cản → Đến P. Điều dưỡng
              </AppText>
            </Pressable>

            <Pressable
              onPress={() => {
                Alert.alert(
                  'Báo cáo lối đi bị tắc',
                  'Đã báo trung tâm điều phối. Robot sẽ hủy giao hàng và quay về trạm an toàn.',
                  [{ text: 'Xác nhận quay về', onPress: () => setStage('returning') }]
                );
              }}
              style={styles.cancelReturnBtn}
            >
              <Ionicons name="arrow-undo-outline" size={16} color="#DC2626" />
              <AppText style={styles.cancelReturnBtnText}>
                Lối đi bị chặn hoàn toàn → Hủy & Quay về
              </AppText>
            </Pressable>
          </View>
        )}

        {/* ============================================================ */}
        {/* 7. GIAI ĐOẠN 3 (Ảnh 4): ĐANG TÌM NGƯỜI NHẬN (ĐẾM NGƯỢC 58S) */}
        {/* ============================================================ */}
        {stage === 'searching' && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxPerson}>
              <Ionicons name="person" size={40} color="#1E293B" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                ĐANG CHỜ NGƯỜI NHẬN
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang tìm người nhận</AppText>
            <AppText style={styles.countdownBigNumber}>{searchCountdown}s</AppText>

            {/* 2x2 Grid */}
            <View style={styles.searchingCard}>
              <View style={styles.grid2x2}>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>DỰ KIẾN</AppText>
                  <AppText style={styles.cellValue}>2s</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>NGƯỜI NHẬN</AppText>
                  <AppText style={styles.cellValue}>Điều dưỡng trực</AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>THÙNG</AppText>
                  <AppText style={[styles.cellValue, { color: '#059669' }]}>
                    🔒 Vẫn khóa
                  </AppText>
                </View>
                <View style={styles.cell2x2}>
                  <AppText style={styles.cellLabel}>THÔNG BÁO</AppText>
                  <AppText style={[styles.cellValue, { color: '#10B981' }]}>
                    ✓ Đã gửi
                  </AppText>
                </View>
              </View>
            </View>

            {/* Nút lớn xanh: Tôi là người nhận → */}
            <Pressable
              onPress={() => setStage('retrieval')}
              style={styles.greenRecipientBtn}
            >
              <AppText style={styles.greenRecipientBtnText}>
                Tôi là người nhận →
              </AppText>
            </Pressable>

            {/* Hủy chuyển sang quay về */}
            <Pressable
              onPress={() => {
                Alert.alert(
                  'Xác nhận hủy nhận hàng',
                  'Staff xác nhận hủy nhiệm vụ. Robot sẽ khóa thùng và lập lộ trình quay về kho.',
                  [{ text: 'Đồng ý', onPress: () => setStage('returning') }]
                );
              }}
              style={styles.secondaryActionBtn}
            >
              <AppText style={styles.secondaryActionBtnText}>
                Staff hủy nhận / Không có người trực
              </AppText>
            </Pressable>
          </View>
        )}

        {/* ============================================================ */}
        {/* 8. GIAI ĐOẠN 4 (Ảnh 2): ĐANG CHUẨN BỊ QUAY VỀ (UNHAPPY CASE) */}
        {/* ============================================================ */}
        {stage === 'returning' && (
          <View style={styles.stateContainer}>
            <View style={styles.heroIconBoxReturn}>
              <Ionicons name="return-up-back" size={44} color="#D97706" />
            </View>
            <View style={styles.statusPillOrange}>
              <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
              <AppText style={[styles.statusPillText, { color: '#B45309' }]}>
                CHUẨN BỊ TRẢ VẬT PHẨM VỀ NƠI GỬI
              </AppText>
            </View>
            <AppText style={styles.heroTitle}>Đang chuẩn bị quay về</AppText>

            {/* Checklist Card */}
            <View style={styles.returnCard}>
              <AppText style={styles.returnReasonLabel}>LÝ DO TRẢ LẠI</AppText>
              <AppText style={styles.returnReasonText}>Staff hủy nhiệm vụ</AppText>

              <View style={styles.returnDivider} />

              <View style={styles.checklistColumn}>
                <View style={styles.returnCheckRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                  <AppText style={styles.returnCheckTextDone}>
                    Vật phẩm vẫn còn trong thùng
                  </AppText>
                </View>

                <View style={styles.returnCheckRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                  <AppText style={styles.returnCheckTextDone}>
                    Khóa thùng
                  </AppText>
                </View>

                <View style={styles.returnCheckRow}>
                  <Ionicons name="hourglass-outline" size={18} color="#D97706" />
                  <AppText style={styles.returnCheckTextPending}>
                    Đang lập lộ trình về...
                  </AppText>
                </View>
              </View>
            </View>

            <Pressable
              onPress={() => {
                Alert.alert(
                  'Robot quay về Kho an toàn',
                  'Robot #001 đã trở về Kho vật tư và bàn giao lại nguyên vẹn vật phẩm.',
                  [{ text: 'Đóng', onPress: () => setStage('completed') }]
                );
              }}
              style={styles.actionBtnBlue}
            >
              <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>
                Xác nhận lộ trình quay về Kho vật tư →
              </AppText>
            </Pressable>

            <Pressable
              onPress={() => setStage('arrived')}
              style={styles.secondaryActionBtn}
            >
              <AppText style={styles.secondaryActionBtnText}>
                Thử lại nhiệm vụ giao tại P. Điều dưỡng
              </AppText>
            </Pressable>
          </View>
        )}

        {/* ============================================================ */}
        {/* 9. GIAI ĐOẠN 5: VUI LÒNG LẤY VẬT PHẨM (KHI NGƯỜI NHẬN ĐÃ ẤN) */}
        {/* ============================================================ */}
        {stage === 'retrieval' && (
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

            <View style={styles.twoButtonsRow}>
              <Pressable
                onPress={() => setStage('closing')}
                style={styles.greenActionBtn}
              >
                <AppText style={styles.greenActionBtnText}>✓ Đã lấy vật phẩm</AppText>
              </Pressable>

              <Pressable
                onPress={() => {
                  setCloseCountdown(29);
                  setStage('warning_close');
                }}
                style={styles.beigeActionBtn}
              >
                <AppText style={styles.beigeActionBtnText}>Chưa lấy được</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {/* ============================================================ */}
        {/* 10. GIAI ĐOẠN 6: THÙNG SẮP TỰ ĐÓNG (29S) */}
        {/* ============================================================ */}
        {stage === 'warning_close' && (
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
            <AppText style={styles.countdownBigNumber}>{closeCountdown}s</AppText>

            <View style={styles.warningCard}>
              <AppText style={styles.warningCardNotice}>
                Cảm biến xác nhận vật phẩm vẫn còn trong thùng. Robot sẽ đóng khóa thùng khi hết giờ.
              </AppText>
              <View style={styles.countdownProgressTrack}>
                <View
                  style={[
                    styles.countdownProgressFill,
                    { width: `${Math.max(5, (closeCountdown / 30) * 100)}%` },
                  ]}
                />
              </View>
            </View>

            <View style={styles.fullButtonsColumn}>
              <Pressable
                onPress={() => setStage('closing')}
                style={styles.fullGreenBtn}
              >
                <AppText style={styles.greenActionBtnText}>✓ Đã lấy vật phẩm</AppText>
              </Pressable>

              <Pressable
                onPress={() => {
                  Alert.alert(
                    'Đã gửi cảnh báo Staff',
                    'Đã ghi nhận sự cố chưa lấy vật phẩm và thông báo đến Điều dưỡng trưởng.',
                    [{ text: 'Đóng thùng ngay', onPress: () => setStage('closing') }]
                  );
                }}
                style={styles.fullRedOutlineBtn}
              >
                <AppText style={styles.redOutlineBtnText}>Đóng thùng và báo Staff</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {/* ============================================================ */}
        {/* 11. GIAI ĐOẠN 7: ĐANG ĐÓNG THÙNG... */}
        {/* ============================================================ */}
        {stage === 'closing' && (
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

            <Pressable
              onPress={() => setStage('completed')}
              style={[styles.actionBtnBlue, { marginTop: 12 }]}
            >
              <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>Xác nhận hoàn tất →</AppText>
            </Pressable>
          </View>
        )}

        {/* ============================================================ */}
        {/* 12. GIAI ĐOẠN 8: HOÀN TẤT NHIỆM VỤ */}
        {/* ============================================================ */}
        {stage === 'completed' && (
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
              Biên bản bàn giao số điện tử đã được ghi nhận trên hệ thống
            </AppText>

            <View style={styles.completedReceiptCard}>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>MÃ ĐƠN HÀNG</AppText>
                <AppText style={styles.receiptValueBold}>#VT001</AppText>
              </View>
              <View style={styles.receiptDivider} />
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>VẬT PHẨM</AppText>
                <AppText style={styles.receiptValue}>Vật tư y tế thông thường</AppText>
              </View>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>ĐIỂM GIAO</AppText>
                <AppText style={styles.receiptValue}>P. Điều dưỡng (Zone A - Tầng 1)</AppText>
              </View>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>PHƯƠNG THỨC</AppText>
                <AppText style={[styles.receiptValue, { color: '#059669' }]}>
                  ✓ Không cần quét (Xác nhận thủ công)
                </AppText>
              </View>
              <View style={styles.receiptRow}>
                <AppText style={styles.receiptLabel}>CẢM BIẾN THÙNG</AppText>
                <AppText style={[styles.receiptValue, { color: '#10B981' }]}>
                  ✓ Đã lấy hết, đã khóa an toàn
                </AppText>
              </View>
            </View>

            <Pressable onPress={() => setStage('arrived')} style={styles.actionBtnBlue}>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <AppText style={styles.actionBtnText}>Bắt đầu chu trình nhiệm vụ mới</AppText>
            </Pressable>
          </View>
        )}

        {/* ============================================================ */}
        {/* 13. THANH ĐIỀU KHIỂN & MÔ PHỎNG SỰ CỐ API ROBOT */}
        {/* ============================================================ */}
        <View style={styles.simulatorBox}>
          <View style={styles.simHeaderRow}>
            <Ionicons name="pulse-outline" size={15} color="#DC2626" />
            <AppText style={styles.simHeaderTitle}>
              MÔ PHỎNG SỰ CỐ API & UNHAPPY CASES ROBOT:
            </AppText>
          </View>

          <View style={styles.simButtonsGrid}>
            <Pressable
              onPress={handleTriggerObstacleApi}
              style={[
                styles.simBtn,
                stage === 'obstacle' && styles.simBtnActiveWarning,
              ]}
            >
              <Ionicons name="warning-outline" size={14} color="#D97706" />
              <AppText style={styles.simBtnText}>1. Gọi API: Bị chặn đường (Ảnh 3)</AppText>
            </Pressable>

            <Pressable
              onPress={handleTriggerSearchingApi}
              style={[
                styles.simBtn,
                stage === 'searching' && styles.simBtnActiveOrange,
              ]}
            >
              <Ionicons name="person-outline" size={14} color="#0284C7" />
              <AppText style={styles.simBtnText}>2. Gọi API: Tìm người nhận (Ảnh 4)</AppText>
            </Pressable>

            <Pressable
              onPress={handleTriggerReturnApi}
              style={[
                styles.simBtn,
                stage === 'returning' && styles.simBtnActiveRed,
              ]}
            >
              <Ionicons name="return-up-back-outline" size={14} color="#DC2626" />
              <AppText style={styles.simBtnText}>3. Gọi API: Staff hủy quay về (Ảnh 2)</AppText>
            </Pressable>

            <Pressable
              onPress={handleTriggerArrivedApi}
              style={[
                styles.simBtn,
                stage === 'arrived' && styles.simBtnActiveBlue,
              ]}
            >
              <Ionicons name="checkmark-done-outline" size={14} color="#059669" />
              <AppText style={styles.simBtnText}>4. Gọi API: Đến nơi bình thường (Ảnh 1)</AppText>
            </Pressable>
          </View>

          {/* Live API Console / Inspector */}
          <View style={styles.liveConsoleBox}>
            <View style={styles.consoleHeader}>
              <View
                style={[
                  styles.statusCircle,
                  { backgroundColor: apiStatus.connected ? '#10B981' : '#F59E0B' },
                ]}
              />
              <AppText style={styles.consoleTitle}>
                {apiStatus.connected
                  ? `Local Backend Server (${apiStatus.latencyMs}ms)`
                  : 'Đang kết nối Máy chủ Local...'}
              </AppText>
              {apiStatus.loading && (
                <AppText style={styles.consoleLoadingText}>Đang gửi...</AppText>
              )}
            </View>

            {apiStatus.lastCall && (
              <View style={styles.consoleDetails}>
                <AppText style={styles.consoleEndpointText}>{apiStatus.lastCall}</AppText>
                <AppText style={styles.consoleResultText} numberOfLines={2}>
                  {apiStatus.lastResult}
                </AppText>
              </View>
            )}
          </View>
        </View>

        {/* 14. CHỌN XEM NHANH 8 GIAI ĐOẠN */}
        <View style={styles.controlBox}>
          <AppText style={styles.controlTitle}>CHUYỂN NHANH 8 TRẠNG THÁI GIAO HÀNG:</AppText>
          <View style={styles.stepTabsRow}>
            {(['arrived', 'obstacle', 'searching', 'returning'] as NoAuthStage[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  if (s === 'searching') setSearchCountdown(58);
                  setStage(s);
                }}
                style={[styles.stepTab, stage === s && styles.stepTabActive]}
              >
                <AppText style={[styles.stepTabLabel, stage === s && styles.stepTabLabelActive]}>
                  {
                    s === 'arrived'
                      ? '1. Đến nơi'
                      : s === 'obstacle'
                      ? '2. Vật cản'
                      : s === 'searching'
                      ? '3. Tìm 58s'
                      : '4. Quay về'
                  }
                </AppText>
              </Pressable>
            ))}
          </View>

          <View style={[styles.stepTabsRow, { marginTop: 4 }]}>
            {(['retrieval', 'warning_close', 'closing', 'completed'] as NoAuthStage[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  if (s === 'warning_close') setCloseCountdown(29);
                  setStage(s);
                }}
                style={[styles.stepTab, stage === s && styles.stepTabActive]}
              >
                <AppText style={[styles.stepTabLabel, stage === s && styles.stepTabLabelActive]}>
                  {
                    s === 'retrieval'
                      ? '5. Lấy hàng'
                      : s === 'warning_close'
                      ? '6. Cảnh báo'
                      : s === 'closing'
                      ? '7. Đang đóng'
                      : '8. Hoàn tất'
                  }
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
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#B45309',
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
  tagItemOrange: {
    backgroundColor: '#FEF3C7',
  },
  tagItemLocked: {
    backgroundColor: '#ECFDF5',
  },
  tagItemTeal: {
    backgroundColor: '#CCFBF1',
  },
  tagItemGreen: {
    backgroundColor: '#ECFDF5',
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
  heroIconBoxObstacle: {
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
  heroIconBoxPerson: {
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
  heroIconBoxReturn: {
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
  statusPillTeal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#CCFBF1',
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
  statusPillGreen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
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
    textAlign: 'center',
  },
  countdownBigNumber: {
    fontSize: 44,
    fontWeight: '900',
    color: '#F59E0B',
    lineHeight: 48,
    marginVertical: 2,
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
  subNoteTeal: {
    fontSize: 12,
    color: '#0F766E',
    fontWeight: '500',
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
  cellLabel: {
    fontSize: 8,
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
  authMethodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  authMethodLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  authMethodValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#047857',
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
  // Obstacle Card
  obstacleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    width: '100%',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sensorInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    width: '100%',
  },
  sensorInfoText: {
    flex: 1,
    fontSize: 11,
    color: '#B45309',
    lineHeight: 16,
    fontWeight: '500',
  },
  cancelReturnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    width: '100%',
  },
  cancelReturnBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  // Searching Card
  searchingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  greenRecipientBtn: {
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 4,
  },
  greenRecipientBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  // Return Card
  returnCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    width: '100%',
    gap: 10,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  returnReasonLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  returnReasonText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#D97706',
  },
  returnDivider: {
    height: 1,
    backgroundColor: '#FEF3C7',
    marginVertical: 4,
  },
  checklistColumn: {
    gap: 10,
  },
  returnCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  returnCheckTextDone: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
  returnCheckTextPending: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
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
  twoButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 4,
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
  greenActionBtnFull: {
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
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
  grid2x2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell2x2: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
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
  secondaryActionBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 4,
  },
  secondaryActionBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  // Simulator Box
  simulatorBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    gap: 10,
    marginTop: 8,
  },
  simHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  simHeaderTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  simButtonsGrid: {
    gap: 6,
  },
  simBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simBtnActiveWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  simBtnActiveOrange: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  simBtnActiveRed: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  simBtnActiveBlue: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  simBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
  },
  // Live Console Box
  liveConsoleBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
    gap: 6,
  },
  consoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusCircle: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  consoleTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#E2E8F0',
    flex: 1,
  },
  consoleLoadingText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#38BDF8',
  },
  consoleDetails: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 8,
    gap: 3,
  },
  consoleEndpointText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#38BDF8',
    fontFamily: 'monospace',
  },
  consoleResultText: {
    fontSize: 9,
    color: '#94A3B8',
    fontFamily: 'monospace',
  },
  // Control Box
  controlBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    gap: 6,
    marginTop: 8,
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
