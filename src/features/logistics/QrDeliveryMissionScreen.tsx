import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText, Button, Card, LoadingState, Notice, Screen } from '../../components/ui';
import { QrScannerModal } from '../../components/QrScannerModal';
import { colors, radii } from '../../theme';
import { robotApiService } from '../../services/api';
import { generateUuid } from '../../services/api/config';
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
      <AppText variant="caption" style={styles.eyebrow}>{title}</AppText>
      <AppText variant="heading">{party?.name || 'Chưa có thông tin'}</AppText>
      {!!party?.location && <AppText variant="caption">{party.location}</AppText>}
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

  // Chưa gắn Job thật: hiển thị ngay luồng 2 mã QR (gửi → nhận).
  if (!reader || !connection) {
    return (
      <Screen>
        <View style={styles.content}>
          <View>
            <AppText variant="caption" style={styles.eyebrow}>MEDIASSIST ROVER</AppText>
            <AppText variant="title" accessibilityRole="header">Vận chuyển</AppText>
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
  const qrSize = Math.max(152, Math.min(264, width - 108));
  const stage = mission ? resolveDeliveryStage(mission) : null;
  const summary = stage ? stages[stage] : null;
  const waitingQr = stage === 'authSender' || stage === 'authReceiver';

  // Camera scanner state
  const [scannerOpen, setScannerOpen] = useState(false);

  const jobId = mission?.jobId ?? (connection.mode === 'device' ? connection.jobId : null);
  const authStepId = challenge?.authJobStepId ?? mission?.step?.jobStepId ?? null;
  const scanPhase = stage === 'authSender' ? 'Người gửi · Điểm A' : 'Người nhận · Điểm B';

  /** Robot quét mã QR Staff → gửi proof lên server */
  const handleCameraScan = async (rawPayload: string) => {
    if (!jobId || !authStepId) {
      throw new Error('Chưa có thông tin Job hoặc bước xác thực đang hoạt động.');
    }
    if (!rawPayload.startsWith(STAFF_QR_PREFIX)) {
      throw new Error('Mã QR không hợp lệ. Yêu cầu nhân viên mở app và hiện mã QR giao nhận.');
    }
    await robotApiService.verifyStaffPhoneQr(jobId, {
      authJobStepId: authStepId,
      transportSessionId: generateUuid(), // placeholder — server sẽ kiểm tra MQTT session
      proof: rawPayload,
    });
  };

  return (
    <Screen>
      <View style={styles.content}>
        <View>
          <AppText variant="caption" style={styles.eyebrow}>MEDIASSIST ROVER</AppText>
          <AppText variant="title" accessibilityRole="header">Vận chuyển</AppText>
        </View>

        {limited && (
          <Notice message="Chỉ hiển thị QR cho Job ID đã nhập. Tiến độ và thông tin giao nhận cần kết nối bằng mã ghép nối." />
        )}
        {state === 'syncing' && <LoadingState message="Đang đồng bộ nhiệm vụ giao nhận…" />}
        {state === 'unavailable' && (
          <>
            <Notice message="Chưa kết nối được hệ thống giao nhận. Đang thử kết nối lại." tone="error" />
            <Button title="Kết nối lại" icon="refresh" variant="secondary" onPress={reconnect} />
          </>
        )}
        {state === 'ready' && !mission && (
          <Card>
            <AppText variant="heading">{limited ? "Chưa có mã QR đang hoạt động" : "Chưa thấy nhiệm vụ giao nhận"}</AppText>
            <AppText>{limited ? "Mã sẽ xuất hiện khi hệ thống mở bước xác thực." : "Chưa có nhiệm vụ giao nhận trong phạm vi tài khoản cầu nối."}</AppText>
          </Card>
        )}

        {mission && summary && (
          <>
            <Card style={stage === 'completed' ? styles.success : undefined}>
              <View style={styles.statusHeading}>
                <View style={styles.statusIcon}>
                  <Ionicons name={summary.icon} size={26} color={colors.primary} />
                </View>
                <View style={styles.statusCopy} accessibilityLiveRegion="polite">
                  {!!mission.requestCode && <AppText variant="caption">Nhiệm vụ {mission.requestCode}</AppText>}
                  <AppText variant="heading" accessibilityRole="header">{summary.title}</AppText>
                </View>
              </View>
              <AppText>{summary.instruction}</AppText>

              {/* Nút mở camera quét QR Staff khi đang ở bước xác thực */}
              {waitingQr && (
                <View style={styles.scanActions}>
                  <Button
                    title={stage === 'authSender' ? '📷 Quét QR người gửi' : '📷 Quét QR người nhận'}
                    icon="camera"
                    onPress={() => setScannerOpen(true)}
                  />
                  <AppText variant="caption" style={styles.center}>
                    Nhân viên y tế mở app Staff → hiện mã QR → Robot quét bằng camera
                  </AppText>
                </View>
              )}

              {/* Hiển thị mã QR robot (dự phòng — Staff quét robot) */}
              {challenge && (
                <View style={styles.qr}>
                  <AppText variant="caption" style={styles.eyebrow}>
                    {challenge.purpose === 'DELIVERY_SENDER'
                      ? 'HOẶC: STAFF QUÉT MÃ NÀY TRÊN ROBOT'
                      : 'HOẶC: STAFF QUÉT MÃ NÀY TRÊN ROBOT'}
                  </AppText>
                  <DeliveryQrCode payload={challenge.qrPayload} size={qrSize} />
                  <AppText variant="caption" style={styles.center}>
                    Staff cũng có thể hướng camera vào mã QR trên màn hình robot.
                  </AppText>
                </View>
              )}
              {waitingQr && !challenge && mission.step?.resolvedInputsJson?.method === 'QR_CODE' && (
                <Notice message="Chưa có mã QR hợp lệ. Đang cập nhật từ hệ thống." />
              )}
            </Card>

            {!limited && (
              <Card>
                <View style={styles.parties}>
                  <PartyDetails title="NGƯỜI GỬI" party={mission.sender} />
                  <PartyDetails title="NGƯỜI NHẬN" party={mission.receiver} />
                </View>
                {!!mission.items?.length && (
                  <View style={styles.items}>
                    <AppText variant="caption" style={styles.eyebrow}>HÀNG GIAO</AppText>
                    {mission.items.map((item, index) => (
                      <AppText key={index}>
                        {item.itemName || 'Vật phẩm'} · {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                      </AppText>
                    ))}
                  </View>
                )}
              </Card>
            )}
          </>
        )}
        <Button title="Cài đặt kết nối" variant="secondary" icon="settings-outline" onPress={onEdit} />
      </View>

      {/* Camera QR Scanner Modal */}
      {scannerOpen && (
        <QrScannerModal
          title={stage === 'authSender' ? 'Quét QR nhân viên gửi' : 'Quét QR nhân viên nhận'}
          subtitle={jobId ? `Job ${jobId.slice(0, 8).toUpperCase()} · ${scanPhase}` : scanPhase}
          onScan={handleCameraScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 48 },
  eyebrow: { color: colors.primaryDark, fontWeight: '700', letterSpacing: 0.6 },
  statusHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIcon: {
    width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.primarySoft,
  },
  statusCopy: { flex: 1 },
  success: { borderColor: colors.success, backgroundColor: colors.successSoft },
  scanActions: { gap: 8, paddingVertical: 8 },
  qr: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  center: { textAlign: 'center' },
  parties: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  party: { flex: 1, minWidth: 140, gap: 3 },
  items: { gap: 3, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border },
});
