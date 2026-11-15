import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText, Button, Card, LoadingState, Notice, Screen, StatusChip } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';
import { robotApiService } from '../../services/api';
import { DeliveryConnectionForm } from './DeliveryConnectionForm';
import { DeliveryConnection, createDeliveryReader } from './deliveryReader';
import { DeliveryQrCode } from './DeliveryQrCode';
import { DeliveryTwoQrFlow } from './DeliveryTwoQrFlow';
import { DeliveryParty, DeliveryReader, DeliveryStage, resolveDeliveryStage } from './deliveryMission';
import { useDeliveryMission } from './useDeliveryMission';

const stages: Record<DeliveryStage, { title: string; instruction: string; icon: keyof typeof Ionicons.glyphMap }> = {
  queued: { title: 'Đã nhận nhiệm vụ', instruction: 'Đang chờ hệ thống điều phối robot.', icon: 'clipboard-outline' },
  toSender: { title: 'Đang đến điểm gửi', instruction: 'Vui lòng chuẩn bị hàng tại điểm gửi.', icon: 'navigate-outline' },
  waitingSender: { title: 'Chờ nạp hàng', instruction: 'Robot đang chờ bước xác thực của người gửi.', icon: 'cube-outline' },
  authSender: { title: 'Quét QR người gửi', instruction: 'Nhân viên gửi hàng mở app, hiện mã QR. Robot quét bằng camera để xác thực mở khoang.', icon: 'camera-outline' },
  authReceiver: { title: 'Quét QR người nhận', instruction: 'Nhân viên nhận hàng mở app, hiện mã QR. Robot quét bằng camera để xác thực mở khoang.', icon: 'camera-outline' },
  unlockingSender: { title: 'Chờ xác nhận mở khóa tại điểm gửi', instruction: 'Chờ hệ thống xác nhận khoang đã mở trước khi nạp hàng.', icon: 'lock-open-outline' },
  unlockingReceiver: { title: 'Chờ xác nhận mở khóa tại điểm nhận', instruction: 'Chờ hệ thống xác nhận khoang đã mở trước khi lấy hàng.', icon: 'lock-open-outline' },
  loading: { title: 'Chờ nạp hàng', instruction: 'Đặt hàng vào khoang và xác nhận trên ứng dụng Staff.', icon: 'cube-outline' },
  transporting: { title: 'Đang vận chuyển', instruction: 'Robot đang đi đến điểm nhận.', icon: 'navigate-outline' },
  pickup: { title: 'Chờ lấy hàng', instruction: 'Lấy hàng khỏi khoang và xác nhận trên ứng dụng Staff.', icon: 'hand-left-outline' },
  securingSender: { title: 'Đang kiểm tra khóa khoang', instruction: 'Người gửi làm theo hướng dẫn đóng khoang và kiểm tra khóa trong ứng dụng Staff.', icon: 'lock-closed-outline' },
  securingReceiver: { title: 'Đang kiểm tra khóa khoang', instruction: 'Người nhận làm theo hướng dẫn đóng khoang và kiểm tra khóa trong ứng dụng Staff.', icon: 'lock-closed-outline' },
  updating: { title: 'Đang xử lý nhiệm vụ', instruction: 'Đang chờ thông tin về bước tiếp theo từ hệ thống.', icon: 'time-outline' },
  completed: { title: 'Giao hàng thành công', instruction: 'Hệ thống đã xác nhận hoàn tất bàn giao.', icon: 'checkmark-circle-outline' },
  ended: { title: 'Nhiệm vụ đã kết thúc', instruction: 'Chưa có xác nhận giao hàng từ hệ thống.', icon: 'information-circle-outline' },
  failed: { title: 'Giao hàng chưa hoàn tất', instruction: 'Hệ thống báo nhiệm vụ gặp lỗi. Vui lòng liên hệ bộ phận điều phối.', icon: 'alert-circle-outline' },
  cancelled: { title: 'Nhiệm vụ đã hủy', instruction: 'Hệ thống đã xác nhận hủy nhiệm vụ.', icon: 'close-circle-outline' },
  cancelling: { title: 'Đang dừng nhiệm vụ', instruction: 'Vui lòng chờ hệ thống xác nhận trạng thái robot.', icon: 'pause-circle-outline' },
  recovery: { title: 'Cần nhân viên kiểm tra', instruction: 'Hệ thống yêu cầu kiểm tra trước khi tiếp tục giao hàng.', icon: 'warning-outline' },
};

const STAFF_QR_PREFIX = 'MARSTAFF1.';

function PartyDetails({ title, party }: { title: string; party?: DeliveryParty }) {
  return (
    <View style={styles.party}>
      <AppText variant="caption" style={styles.partyEyebrow}>{title}</AppText>
      <AppText variant="label" style={{ fontWeight: '700' }}>{party?.name || 'Chưa có thông tin'}</AppText>
      {!!party?.location && <AppText variant="caption" style={{ color: colors.textSecondary }}>{party.location}</AppText>}
    </View>
  );
}

export function QrDeliveryMissionScreen({ connection, onConnect }: {
  connection: DeliveryConnection | null;
  onConnect: (connection: DeliveryConnection) => void;
}) {
  const [editing, setEditing] = useState(false);
  const reader = useMemo(() => connection ? createDeliveryReader(connection) : null, [connection]);

  if (editing) {
    return (
      <Screen>
        <View style={styles.content}>
          <AppText variant="title" accessibilityRole="header">Kết nối Job thật</AppText>
          <DeliveryConnectionForm
            current={connection}
            onConnect={(value) => {
              onConnect(value);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </View>
      </Screen>
    );
  }

  // Chưa gắn Job thật: hiển thị luồng 2 mã QR (gửi → nhận)
  if (!reader || !connection) {
    return (
      <Screen>
        <View style={styles.content}>
          <View style={styles.screenHeader}>
            <AppText variant="caption" style={styles.eyebrow}>MEDIASSIST ROVER</AppText>
            <AppText variant="title" accessibilityRole="header">Vận chuyển tự hành</AppText>
          </View>
          <DeliveryTwoQrFlow onConnectRealJob={() => setEditing(true)} />
        </View>
      </Screen>
    );
  }

  return (
    <DeliveryMissionDisplay
      reader={reader}
      connection={connection}
      limited={connection.mode === 'device'}
      onEdit={() => setEditing(true)}
    />
  );
}

function DeliveryMissionDisplay({ reader, connection, limited, onEdit }: {
  reader: DeliveryReader;
  connection: DeliveryConnection;
  limited: boolean;
  onEdit: () => void;
}) {
  const { state, mission, challenge, reconnect } = useDeliveryMission(reader);
  const { width } = useWindowDimensions();
  const isLandscape = width > 768;
  const qrSize = Math.max(180, Math.min(260, Math.round(width * 0.28)));
  const stage = mission ? resolveDeliveryStage(mission) : null;
  const summary = stage ? stages[stage] : null;
  const waitingQr = stage === 'authSender' || stage === 'authReceiver';

  const isSenderLeg = stage === 'authSender' || stage === 'toSender' || stage === 'waitingSender' || stage === 'unlockingSender' || stage === 'loading' || stage === 'securingSender';
  const isReceiverLeg = stage === 'authReceiver' || stage === 'transporting' || stage === 'unlockingReceiver' || stage === 'pickup' || stage === 'securingReceiver';

  // Điều kiện kiểm tra khoang cần đóng/khóa hoặc phục hồi (D2)
  const needsCompartmentSecuring =
    stage === 'recovery' ||
    stage === 'securingSender' ||
    stage === 'securingReceiver' ||
    stage === 'loading' ||
    stage === 'pickup' ||
    stage === 'unlockingSender' ||
    stage === 'unlockingReceiver' ||
    ((stage === 'cancelled' || stage === 'cancelling' || stage === 'failed') && Boolean(mission?.pickedUpAt || mission?.step));

  const legTitle = isSenderLeg
    ? 'CHẶNG GỬI (ĐIỂM A)'
    : isReceiverLeg
    ? 'CHẶNG NHẬN (ĐIỂM B)'
    : 'NHIỆM VỤ GIAO HÀNG';

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.screenHeader}>
          <View>
            <AppText variant="caption" style={styles.eyebrow}>MEDIASSIST ROVER · {legTitle}</AppText>
            <AppText variant="title" accessibilityRole="header">Nhiệm vụ Vận chuyển</AppText>
          </View>
          <StatusChip
            label={limited ? 'Job ID trực tiếp' : 'Bridge trực tiếp'}
            tone="neutral"
            size="sm"
          />
        </View>

        {limited && (
          <Notice message="Chỉ hiển thị QR cho Job ID đã nhập. Tiến độ và thông tin giao nhận cần kết nối bằng mã ghép nối." />
        )}
        {state === 'syncing' && <LoadingState message="Đang đồng bộ nhiệm vụ giao nhận…" />}
        {state === 'unavailable' && (
          <View style={styles.errorSection}>
            <Notice message="Chưa kết nối được hệ thống giao nhận. Đang thử kết nối lại." tone="error" />
            <Button title="Kết nối lại" icon="refresh" variant="secondary" onPress={reconnect} />
          </View>
        )}
        {state === 'ready' && !mission && (
          <Card>
            <AppText variant="heading">{limited ? "Chưa có mã QR đang hoạt động" : "Chưa thấy nhiệm vụ giao nhận"}</AppText>
            <AppText style={{ color: colors.textSecondary }}>
              {limited ? "Mã sẽ xuất hiện khi hệ thống mở bước xác thực." : "Chưa có nhiệm vụ giao nhận trong phạm vi tài khoản cầu nối."}
            </AppText>
          </Card>
        )}

        {/* Hướng dẫn đóng và kiểm tra khóa khi khoang cần phục hồi hoặc chưa khóa an toàn (D2) */}
        {needsCompartmentSecuring && (
          <Card style={styles.recoveryCard}>
            <View style={styles.recoveryHeader}>
              <View style={styles.recoveryIconWrap}>
                <Ionicons name="lock-closed" size={24} color="#B45309" />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="label" style={styles.recoveryTitle}>
                  Robot đang dừng an toàn · Cần đóng và kiểm tra khóa
                </AppText>
                <AppText variant="caption" style={styles.recoverySubtitle}>
                  {stage === 'recovery'
                    ? 'Hệ thống yêu cầu kiểm tra khoang vật lý và xác nhận phục hồi an toàn.'
                    : stage === 'cancelled' || stage === 'cancelling'
                    ? 'Nhiệm vụ đã dừng/hủy. Vui lòng kiểm tra và khóa nắp khoang trước khi chuyển trạng thái.'
                    : 'Khoang đang mở hoặc đang chờ đóng nắp. Vui lòng thực hiện các bước kiểm tra dưới đây.'}
                </AppText>
              </View>
            </View>

            <View style={styles.recoverySteps}>
              <View style={styles.recoveryStepItem}>
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.textSecondary} />
                <AppText style={styles.recoveryStepText}>
                  1. <AppText style={{ fontWeight: '700' }}>Đóng nắp khoang:</AppText> Nhấn nắp khoang đóng chặt vào khớp hoàn toàn, đảm bảo tay và đồ vật đã rời khỏi cơ cấu.
                </AppText>
              </View>
              <View style={styles.recoveryStepItem}>
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.textSecondary} />
                <AppText style={styles.recoveryStepText}>
                  2. <AppText style={{ fontWeight: '700' }}>Kiểm tra khóa cơ học:</AppText> Dùng tay kéo nhẹ nắp để kiểm tra chốt khóa vật lý đã ngậm chặt, không bị kênh hở.
                </AppText>
              </View>
              <View style={styles.recoveryStepItem}>
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.textSecondary} />
                <AppText style={styles.recoveryStepText}>
                  3. <AppText style={{ fontWeight: '700' }}>Xác nhận phục hồi:</AppText> Nhân viên y tế xác nhận khóa nắp trên ứng dụng Staff (hoặc xử lý cơ học tại chỗ nếu mất mạng) trước khi cho phép robot tiếp tục chuyển động.
                </AppText>
              </View>
            </View>
          </Card>
        )}

        {mission && summary && (
          <View style={[styles.mainLayout, isLandscape && styles.mainLayoutLandscape]}>
            {/* Cột trái: Trạng thái & thông tin giao nhận */}
            <View style={[styles.leftColumn, isLandscape && { flex: 54 }]}>
              <Card style={[styles.summaryCard, stage === 'completed' && styles.successCard]}>
                <View style={styles.statusHeading}>
                  <View style={styles.statusIconWrap}>
                    <Ionicons name={summary.icon} size={26} color={colors.textPrimary} />
                  </View>
                  <View style={styles.statusCopy} accessibilityLiveRegion="polite">
                    {!!mission.requestCode && (
                      <AppText variant="caption" style={{ color: colors.textSecondary, fontWeight: '600' }}>
                        Nhiệm vụ {mission.requestCode}
                      </AppText>
                    )}
                    <AppText variant="heading" accessibilityRole="header" style={{ fontWeight: '700' }}>
                      {summary.title}
                    </AppText>
                  </View>
                </View>
                <AppText style={{ color: colors.textSecondary, lineHeight: 24 }}>
                  {summary.instruction}
                </AppText>

                {/* Hướng dẫn xác thực QR hai chiều cho đúng chặng gửi / nhận (D1) */}
                {waitingQr && (
                  <View style={styles.qrGuidanceBlock}>
                    <View style={styles.qrGuidanceRow}>
                      <Ionicons name="phone-portrait-outline" size={20} color={colors.hero} />
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.guidanceHeading}>
                          Chiều 1: Staff dùng điện thoại quét mã trên Robot
                        </AppText>
                        <AppText style={styles.guidanceDetail}>
                          Nhân viên {stage === 'authSender' ? 'GỬI HÀNG (Điểm A)' : 'NHẬN HÀNG (Điểm B)'} mở app Staff, dùng camera điện thoại quét mã QR hiển thị ở khung bên phải màn hình này.
                        </AppText>
                      </View>
                    </View>

                    <View style={styles.qrGuidanceRow}>
                      <Ionicons name="camera-outline" size={20} color={colors.hero} />
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.guidanceHeading}>
                          Chiều 2: Robot quét mã QR trên app của Staff
                        </AppText>
                        <AppText style={styles.guidanceDetail}>
                          Hoặc: Nhân viên mở mã QR {stage === 'authSender' ? 'Người gửi' : 'Người nhận'} trong app Staff, đưa lại gần camera trên thân xe Robot. Hệ thống camera và module quét mã của Robot (Raspberry Pi chạy ROS / staff_qr.py) sẽ tự động nhận diện và gửi xác thực qua phiên MQTT thật.
                        </AppText>
                      </View>
                    </View>

                    <View style={styles.piHardwareBadge}>
                      <Ionicons name="hardware-chip-outline" size={14} color={colors.textSecondary} />
                      <AppText variant="caption" style={styles.piHardwareBadgeText}>
                        Camera quét QR của Robot do Raspberry Pi xử lý trực tiếp với phiên vận chuyển MQTT thật. Màn hình tablet không tự sinh transportSessionId giả lập.
                      </AppText>
                    </View>
                  </View>
                )}
              </Card>

              {/* Thông tin các bên giao nhận */}
              {!limited && (
                <Card style={styles.partiesCard}>
                  <View style={styles.parties}>
                    <PartyDetails title="NGƯỜI GỬI (ĐIỂM A)" party={mission.sender} />
                    <PartyDetails title="NGƯỜI NHẬN (ĐIỂM B)" party={mission.receiver} />
                  </View>
                  {!!mission.items?.length && (
                    <View style={styles.itemsSection}>
                      <AppText variant="caption" style={styles.partyEyebrow}>VẬT PHẨM GIAO NHẬN</AppText>
                      {mission.items.map((item, index) => (
                        <AppText key={index} style={{ fontWeight: '500' }}>
                          • {item.itemName || 'Vật phẩm'} · {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                        </AppText>
                      ))}
                    </View>
                  )}
                </Card>
              )}
            </View>

            {/* Cột phải: Mã QR của Robot (Staff quét mã này) */}
            <Card style={[styles.qrColumnCard, isLandscape && { flex: 46 }]}>
              {challenge ? (
                <View style={styles.qrInner}>
                  <StatusChip
                    label={
                      challenge.purpose === 'DELIVERY_SENDER'
                        ? 'MÃ QR NGƯỜI GỬI (ĐIỂM A) · STAFF QUÉT'
                        : 'MÃ QR NGƯỜI NHẬN (ĐIỂM B) · STAFF QUÉT'
                    }
                    tone="hero"
                    size="sm"
                  />
                  <View style={styles.qrBox}>
                    <DeliveryQrCode payload={challenge.qrPayload} size={qrSize} />
                  </View>
                  <AppText variant="caption" style={styles.centerMuted}>
                    Staff {challenge.purpose === 'DELIVERY_SENDER' ? 'gửi hàng' : 'nhận hàng'} mở ứng dụng Staff trên điện thoại và quét mã QR hiển thị ở trên.
                  </AppText>
                  <AppText variant="caption" style={{ color: colors.textMuted, fontSize: 11 }}>
                    Hết hạn: {new Date(challenge.expiresAt).toLocaleTimeString()}
                  </AppText>
                </View>
              ) : waitingQr && !challenge && mission.step?.resolvedInputsJson?.method === 'QR_CODE' ? (
                <Notice message="Chưa có mã QR hợp lệ cho chặng này. Đang chờ hệ thống cập nhật." />
              ) : (
                <View style={styles.waitingPlaceholder}>
                  <Ionicons name="time-outline" size={44} color={colors.textSecondary} />
                  <AppText variant="heading" style={{ textAlign: 'center' }}>
                    {stage === 'transporting' ? 'Đang trên đường di chuyển' : 'Đang xử lý nhiệm vụ'}
                  </AppText>
                  <AppText variant="caption" style={styles.centerMuted}>
                    Mã xác thực QR sẽ hiển thị tự động khi robot đến đúng điểm dừng.
                  </AppText>
                </View>
              )}
            </Card>
          </View>
        )}

        <Button
          title="Cài đặt kết nối"
          variant="secondary"
          icon="settings-outline"
          onPress={onEdit}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: 60,
  },
  screenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eyebrow: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  errorSection: {
    gap: spacing.md,
  },
  mainLayout: {
    gap: spacing.lg,
  },
  mainLayoutLandscape: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leftColumn: {
    gap: spacing.md,
  },
  summaryCard: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  successCard: {
    borderColor: colors.successText,
    backgroundColor: colors.successSurface,
  },
  statusHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusIconWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusCopy: {
    flex: 1,
    gap: 2,
  },
  scanActions: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  centerMuted: {
    textAlign: 'center',
    color: colors.textSecondary,
    maxWidth: 280,
    alignSelf: 'center',
  },
  partiesCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  parties: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  party: {
    flex: 1,
    minWidth: 140,
    gap: 2,
  },
  partyEyebrow: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  itemsSection: {
    gap: 4,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  qrColumnCard: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrInner: {
    alignItems: 'center',
    gap: spacing.md,
  },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  waitingPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: spacing.sm,
  },
  recoveryCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    padding: spacing.lg,
    gap: spacing.md,
  },
  recoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  recoveryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoveryTitle: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 15,
  },
  recoverySubtitle: {
    color: '#B45309',
    marginTop: 2,
    lineHeight: 18,
  },
  recoverySteps: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#FDE68A',
  },
  recoveryStepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  recoveryStepText: {
    flex: 1,
    color: '#78350F',
    fontSize: 12.5,
    lineHeight: 19,
  },
  qrGuidanceBlock: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  qrGuidanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  guidanceHeading: {
    fontWeight: '700',
    color: colors.textPrimary,
    fontSize: 13,
  },
  guidanceDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  piHardwareBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xs + 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  piHardwareBadgeText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
});
