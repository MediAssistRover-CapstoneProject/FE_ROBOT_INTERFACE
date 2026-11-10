import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText, Button, Card, Notice } from '../../components/ui';
import { colors, radii } from '../../theme';
import { DeliveryQrCode } from './DeliveryQrCode';
import type { DeliveryPurpose } from './deliveryMission';

/**
 * Luồng giao nhận 2 mã QR hiển thị trên màn hình robot:
 *
 *  1. Điểm gửi (A)  → QR #1 `DELIVERY_SENDER`: người gửi quét bằng Staff App
 *     để mở khoang, bỏ đồ vào rồi đóng & khóa.
 *  2. Vận chuyển A → B (khoang khóa).
 *  3. Điểm nhận (B) → QR #2 `DELIVERY_RECEIVER` (mã khác hoàn toàn): người nhận
 *     quét để mở khoang, lấy đồ, đóng khoang → hoàn tất.
 *
 * Chế độ này là bản xem trước khi chưa gắn Job thật. Khi kết nối Job thật,
 * mã QR có chữ ký sẽ do Backend cấp (`/api/v1/pi/jobs/{jobId}/qr-challenge`).
 */

type FlowStep = 'senderQr' | 'loading' | 'transporting' | 'receiverQr' | 'unloading' | 'done';

const ORDER: FlowStep[] = ['senderQr', 'loading', 'transporting', 'receiverQr', 'unloading', 'done'];

const STEP_INFO: Record<FlowStep, { title: string; hint: string; icon: keyof typeof Ionicons.glyphMap; next?: string }> = {
  senderQr: {
    title: 'Điểm gửi (A) · Quét QR #1',
    hint: 'Người gửi mở Staff App, quét mã QR #1 để mở khoang robot.',
    icon: 'qr-code-outline',
    next: 'Đã quét — mở khoang',
  },
  loading: {
    title: 'Khoang đã mở · Bỏ đồ vào',
    hint: 'Đặt hàng vào khoang, đóng nắp và xác nhận khóa trên Staff App.',
    icon: 'cube-outline',
    next: 'Đã đóng & khóa khoang',
  },
  transporting: {
    title: 'Đang vận chuyển A → B',
    hint: 'Khoang đang khóa. Robot di chuyển đến điểm nhận.',
    icon: 'navigate-outline',
    next: 'Robot đã đến điểm nhận',
  },
  receiverQr: {
    title: 'Điểm nhận (B) · Quét QR #2',
    hint: 'Người nhận mở Staff App, quét mã QR #2 để mở khoang lấy đồ.',
    icon: 'qr-code-outline',
    next: 'Đã quét — mở khoang',
  },
  unloading: {
    title: 'Khoang đã mở · Lấy đồ ra',
    hint: 'Lấy hàng khỏi khoang, đóng nắp và xác nhận trên Staff App.',
    icon: 'hand-left-outline',
    next: 'Đã lấy đồ & đóng khoang',
  },
  done: {
    title: 'Giao nhận hoàn tất',
    hint: 'Nhiệm vụ đã được bàn giao thành công.',
    icon: 'checkmark-circle-outline',
  },
};

const b64url = (input: string) => {
  // btoa có sẵn trên Hermes/Web; mã ASCII nên an toàn.
  const encoded = typeof btoa === 'function' ? btoa(input) : input;
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const randomId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Payload cùng định dạng `MARQR1` với Staff App (chữ ký giả lập ở chế độ xem trước). */
function buildPreviewPayload(jobId: string, purpose: DeliveryPurpose) {
  const challengeId = randomId();
  const stepId = randomId();
  const expires = Math.floor(Date.now() / 1000) + 10 * 60;
  const body = b64url(`${challengeId}|${jobId}|${stepId}|${purpose}|${expires}`);
  const sig = b64url(randomId() + randomId()).slice(0, 43).padEnd(43, 'A');
  return { challengeId, payload: `MARQR1.${body}.${sig}` };
}

export function DeliveryTwoQrFlow({ onConnectRealJob }: { onConnectRealJob: () => void }) {
  const { width } = useWindowDimensions();
  const qrSize = Math.max(160, Math.min(240, width - 120));
  const [step, setStep] = useState<FlowStep>('senderQr');
  const [jobId, setJobId] = useState(randomId);

  // Hai mã QR khác nhau hoàn toàn cho cùng một job.
  const senderQr = useMemo(() => buildPreviewPayload(jobId, 'DELIVERY_SENDER'), [jobId]);
  const receiverQr = useMemo(() => buildPreviewPayload(jobId, 'DELIVERY_RECEIVER'), [jobId]);

  const info = STEP_INFO[step];
  const index = ORDER.indexOf(step);
  const qr = step === 'senderQr' ? senderQr : step === 'receiverQr' ? receiverQr : null;
  const isSender = step === 'senderQr';

  const advance = () => setStep(ORDER[Math.min(index + 1, ORDER.length - 1)] ?? 'done');
  const reset = () => {
    setJobId(randomId());
    setStep('senderQr');
  };

  return (
    <View style={styles.wrap}>
      {/* Thanh tiến trình A → B */}
      <View style={styles.progress}>
        {[
          { label: 'QR #1 · Gửi', active: index <= 1, done: index > 1 },
          { label: 'Vận chuyển', active: index === 2, done: index > 2 },
          { label: 'QR #2 · Nhận', active: index >= 3 && index <= 4, done: index > 4 },
        ].map((s, i) => (
          <View key={s.label} style={styles.progressItem}>
            <View
              style={[
                styles.progressDot,
                s.active && styles.progressDotActive,
                s.done && styles.progressDotDone,
              ]}
            >
              {s.done ? (
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              ) : (
                <AppText style={[styles.progressNum, (s.active || s.done) && styles.progressNumActive]}>{i + 1}</AppText>
              )}
            </View>
            <AppText style={[styles.progressLabel, s.active && styles.progressLabelActive]}>{s.label}</AppText>
          </View>
        ))}
      </View>

      <Card style={step === 'done' ? styles.success : undefined}>
        <View style={styles.heading}>
          <View style={styles.icon}>
            <Ionicons name={info.icon} size={26} color={colors.primary} />
          </View>
          <View style={styles.headingCopy} accessibilityLiveRegion="polite">
            <AppText variant="caption">Job {jobId.slice(0, 8).toUpperCase()}</AppText>
            <AppText variant="heading" accessibilityRole="header">{info.title}</AppText>
          </View>
        </View>
        <AppText>{info.hint}</AppText>

        {qr && (
          <View style={styles.qrBox}>
            <View style={[styles.qrBadge, { backgroundColor: isSender ? '#0369A1' : '#047857' }]}>
              <AppText style={styles.qrBadgeText}>
                {isSender ? 'QR #1 · NGƯỜI GỬI · DELIVERY_SENDER' : 'QR #2 · NGƯỜI NHẬN · DELIVERY_RECEIVER'}
              </AppText>
            </View>
            <DeliveryQrCode payload={qr.payload} size={qrSize} />
            <AppText variant="caption" style={styles.center}>
              Mã {qr.challengeId.slice(0, 8).toUpperCase()} · hết hạn sau 10 phút
            </AppText>
          </View>
        )}

        <View style={styles.actions}>
          {info.next ? (
            <Button title={info.next} icon="arrow-forward" onPress={advance} />
          ) : (
            <Button title="Nhiệm vụ mới" icon="refresh" onPress={reset} />
          )}
        </View>
      </Card>

      <Notice message="Đang ở chế độ xem trước: mã QR đúng định dạng MARQR1 nhưng chữ ký là giả lập, Staff App sẽ không xác thực được. Bấm 'Kết nối Job thật' để robot hiển thị mã QR có chữ ký do Backend cấp." />
      <Button title="Kết nối Job thật / Bridge" variant="secondary" icon="link-outline" onPress={onConnectRealJob} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  progress: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  progressItem: { alignItems: 'center', gap: 4, flex: 1 },
  progressDot: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.border,
  },
  progressDotActive: { backgroundColor: colors.primary },
  progressDotDone: { backgroundColor: colors.success },
  progressNum: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  progressNumActive: { color: '#FFFFFF' },
  progressLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  progressLabelActive: { color: colors.primaryDark, fontWeight: '800' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.primarySoft,
  },
  headingCopy: { flex: 1 },
  success: { borderColor: colors.success, backgroundColor: colors.successSoft },
  qrBox: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  qrBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  qrBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  center: { textAlign: 'center' },
  actions: { marginTop: 8 },
});
