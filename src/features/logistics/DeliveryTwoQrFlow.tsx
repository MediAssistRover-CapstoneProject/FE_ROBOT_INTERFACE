import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText, Button, Card, Notice, StatusChip } from '../../components/ui';
import { QrScannerModal } from '../../components/QrScannerModal';
import { colors, radii, spacing, typography } from '../../theme';
import { DeliveryQrCode } from './DeliveryQrCode';
import type { DeliveryPurpose } from './deliveryMission';

type FlowStep = 'senderQr' | 'loading' | 'transporting' | 'receiverQr' | 'unloading' | 'done';

const ORDER: FlowStep[] = ['senderQr', 'loading', 'transporting', 'receiverQr', 'unloading', 'done'];

const STEP_INFO: Record<FlowStep, { title: string; hint: string; icon: keyof typeof Ionicons.glyphMap; next?: string }> = {
  senderQr: {
    title: 'Điểm gửi (A) · Quét QR #1',
    hint: 'Người gửi mở ứng dụng Staff, quét mã QR #1 để mở khoang robot.',
    icon: 'qr-code-outline',
    next: 'Đã quét — mở khoang',
  },
  loading: {
    title: 'Khoang đã mở · Nạp vật phẩm',
    hint: 'Đặt vật phẩm vào khoang, đóng nắp và xác nhận khóa trên ứng dụng Staff.',
    icon: 'cube-outline',
    next: 'Đã đóng & khóa khoang',
  },
  transporting: {
    title: 'Đang vận chuyển A → B',
    hint: 'Khoang đang khóa an toàn. Robot tự hành di chuyển đến điểm nhận.',
    icon: 'navigate-outline',
    next: 'Robot đã đến điểm nhận',
  },
  receiverQr: {
    title: 'Điểm nhận (B) · Quét QR #2',
    hint: 'Người nhận mở ứng dụng Staff, quét mã QR #2 để mở khoang lấy đồ.',
    icon: 'qr-code-outline',
    next: 'Đã quét — mở khoang',
  },
  unloading: {
    title: 'Khoang đã mở · Lấy đồ ra',
    hint: 'Lấy vật phẩm khỏi khoang, đóng nắp và xác nhận trên ứng dụng Staff.',
    icon: 'hand-left-outline',
    next: 'Đã lấy đồ & đóng khoang',
  },
  done: {
    title: 'Giao nhận hoàn tất',
    hint: 'Nhiệm vụ vận chuyển đã được bàn giao thành công an toàn.',
    icon: 'checkmark-circle-outline',
  },
};

const b64url = (input: string) => {
  const encoded = typeof btoa === 'function' ? btoa(input) : input;
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const randomId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

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
  const isLandscape = width > 768;
  const qrSize = Math.max(180, Math.min(260, Math.round(width * 0.28)));

  const [step, setStep] = useState<FlowStep>('senderQr');
  const [jobId, setJobId] = useState(randomId);
  const [scannerOpen, setScannerOpen] = useState(false);

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
      {/* Simulation Banner Notice */}
      <View style={styles.badgeRow}>
        <StatusChip
          label="Mô phỏng — không điều khiển robot"
          tone="warning"
          icon="information-circle-outline"
        />
        <AppText variant="caption" style={styles.jobIdCaption}>
          Job: {jobId.slice(0, 8).toUpperCase()}
        </AppText>
      </View>

      {/* Progress Stepper */}
      <View style={styles.stepperContainer}>
        {[
          { label: 'QR #1 · Điểm gửi', active: index <= 1, done: index > 1 },
          { label: 'Vận chuyển A → B', active: index === 2, done: index > 2 },
          { label: 'QR #2 · Điểm nhận', active: index >= 3 && index <= 4, done: index > 4 },
        ].map((s, i) => (
          <View key={s.label} style={styles.stepperItem}>
            <View
              style={[
                styles.stepperDot,
                s.active && styles.stepperDotActive,
                s.done && styles.stepperDotDone,
              ]}
            >
              {s.done ? (
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              ) : (
                <AppText
                  style={[
                    styles.stepperNum,
                    (s.active || s.done) && styles.stepperNumActive,
                  ]}
                >
                  {i + 1}
                </AppText>
              )}
            </View>
            <AppText
              style={[
                styles.stepperLabel,
                s.active && styles.stepperLabelActive,
                s.done && styles.stepperLabelDone,
              ]}
            >
              {s.label}
            </AppText>
          </View>
        ))}
      </View>

      {/* Main Content Area: Landscape 2 columns when wide */}
      <View style={[styles.mainLayout, isLandscape && styles.mainLayoutLandscape]}>
        {/* Left Column: Mission Status & Instructions */}
        <Card style={[styles.statusCard, isLandscape && { flex: 50 }]}>
          <View style={styles.stepHeader}>
            <View style={styles.stepIconWrap}>
              <Ionicons name={info.icon} size={24} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" style={{ color: colors.textSecondary }}>
                Giai đoạn {index + 1}/6
              </AppText>
              <AppText variant="heading" style={{ fontWeight: '700' }}>
                {info.title}
              </AppText>
            </View>
          </View>

          <AppText style={styles.hintText}>{info.hint}</AppText>

          {/* Action Button */}
          <View style={styles.stepActionBox}>
            {info.next ? (
              <Button title={info.next} icon="arrow-forward" onPress={advance} />
            ) : (
              <Button title="Nhiệm vụ mô phỏng mới" icon="refresh" onPress={reset} />
            )}
          </View>

          {/* Camera Scanner Trigger (if on QR steps) */}
          {(step === 'senderQr' || step === 'receiverQr') && (
            <Button
              title={isSender ? '📷 Robot quét QR người gửi' : '📷 Robot quét QR người nhận'}
              icon="camera"
              variant="secondary"
              onPress={() => setScannerOpen(true)}
            />
          )}

          <Button
            title="Kết nối Job thật / Bridge"
            variant="secondary"
            icon="link-outline"
            onPress={onConnectRealJob}
          />
        </Card>

        {/* Right Column: QR Code Card */}
        <Card style={[styles.qrCard, isLandscape && { flex: 50 }]}>
          {qr ? (
            <View style={styles.qrInner}>
              <View style={[styles.qrBadge, isSender ? styles.qrBadgeSender : styles.qrBadgeReceiver]}>
                <AppText style={styles.qrBadgeText}>
                  {isSender ? 'QR #1 · NGƯỜI GỬI (ĐIỂM A)' : 'QR #2 · NGƯỜI NHẬN (ĐIỂM B)'}
                </AppText>
              </View>

              <View style={styles.qrBox}>
                <DeliveryQrCode payload={qr.payload} size={qrSize} />
              </View>

              <View style={styles.qrMetaBox}>
                <AppText variant="caption" style={styles.qrMetaText}>
                  Mã: {qr.challengeId.slice(0, 8).toUpperCase()} • Hết hạn sau 10 phút
                </AppText>
                <AppText variant="caption" style={styles.qrInstructionSub}>
                  Nhân viên mở app Staff và hướng camera vào mã QR này để mở khoang.
                </AppText>
              </View>
            </View>
          ) : (
            <View style={styles.noQrPlaceholder}>
              <Ionicons
                name={step === 'transporting' ? 'navigate-circle' : 'checkmark-circle'}
                size={48}
                color={step === 'done' ? colors.successText : colors.textPrimary}
              />
              <AppText variant="heading" style={{ textAlign: 'center', marginTop: 12 }}>
                {step === 'transporting'
                  ? 'Robot đang di chuyển'
                  : step === 'loading'
                  ? 'Đang nạp vật phẩm'
                  : step === 'unloading'
                  ? 'Đang lấy vật phẩm'
                  : 'Hoàn tất giao nhận'}
              </AppText>
              <AppText variant="caption" style={{ textAlign: 'center', color: colors.textSecondary }}>
                {info.hint}
              </AppText>
            </View>
          )}
        </Card>
      </View>

      {/* Camera Scanner Modal */}
      {scannerOpen && (
        <QrScannerModal
          title={isSender ? 'Quét QR nhân viên gửi' : 'Quét QR nhân viên nhận'}
          subtitle={`Xem trước · Job ${jobId.slice(0, 8).toUpperCase()}`}
          onScan={async (raw) => {
            if (!raw.startsWith('MARSTAFF1.')) {
              throw new Error('Mã QR không đúng định dạng Staff. Yêu cầu nhân viên mở app và hiện mã QR giao nhận.');
            }
            advance();
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  jobIdCaption: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  stepperContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperItem: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  stepperDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperDotActive: {
    backgroundColor: colors.hero,
    borderColor: colors.hero,
  },
  stepperDotDone: {
    backgroundColor: colors.successText,
    borderColor: colors.successText,
  },
  stepperNum: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  stepperNumActive: {
    color: '#FFFFFF',
  },
  stepperLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  stepperLabelActive: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  stepperLabelDone: {
    color: colors.successText,
  },
  mainLayout: {
    gap: spacing.lg,
  },
  mainLayoutLandscape: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statusCard: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    color: colors.textSecondary,
    lineHeight: 24,
  },
  stepActionBox: {
    marginTop: spacing.xs,
  },
  qrCard: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrInner: {
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
  },
  qrBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  qrBadgeSender: {
    backgroundColor: colors.hero,
  },
  qrBadgeReceiver: {
    backgroundColor: colors.successText,
  },
  qrBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrMetaBox: {
    alignItems: 'center',
    gap: 4,
  },
  qrMetaText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  qrInstructionSub: {
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  noQrPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
});
