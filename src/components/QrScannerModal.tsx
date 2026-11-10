import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radii } from '../theme';

/**
 * Camera quét mã QR trên điện thoại Staff.
 *
 * Luồng:  Staff mở app → hiện QR dạng `MARSTAFF1.{64-char-proof}`
 *   →  Robot mở camera quét → gửi `proof` lên BE qua
 *         POST /api/v1/pi/jobs/{jobId}/staff-phone-qr/verify
 *   →  BE xác thực chữ ký, mở chốt tủ.
 */

export type ScanState = 'scanning' | 'verifying' | 'verified' | 'error';

interface Props {
  /** Tiêu đề phía trên camera, ví dụ 'QR Người gửi' */
  title: string;
  /** Gợi ý bên dưới, ví dụ 'Job abc123 · Lấy hàng tại A' */
  subtitle?: string;
  /** Được gọi khi quét thành công 1 mã. Trả về Promise → nếu reject → hiện lỗi. */
  onScan: (rawPayload: string) => Promise<void>;
  /** Đóng modal */
  onClose: () => void;
}

export function QrScannerModal({ title, subtitle, onScan, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>('scanning');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleBarcode = async ({ data }: BarcodeScanningResult) => {
    if (locked.current) return;
    locked.current = true;
    setState('verifying');
    try {
      await onScan(data);
      if (mounted.current) setState('verified');
    } catch (err) {
      if (!mounted.current) return;
      const msg = err instanceof Error ? err.message : 'Không thể xác thực mã QR.';
      setError(msg);
      setState('error');
    }
  };

  const close = () => { if (state !== 'verifying') onClose(); };

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="scan-outline" size={22} color="#0EA5E9" />
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đóng"
            onPress={close}
            disabled={state === 'verifying'}
            style={styles.close}
          >
            <Ionicons name="close" size={22} color="#CBD5E1" />
          </Pressable>
        </View>

        {/* Camera viewport */}
        {state === 'scanning' && permission?.granted ? (
          <>
            <View style={styles.camera}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarcode}
              />
              {/* Khung ngắm */}
              <View pointerEvents="none" style={styles.frame}>
                <Ionicons name="scan" size={34} color="rgba(255,255,255,0.85)" />
              </View>
            </View>
            <Text style={styles.hint}>
              Đưa mã QR trên điện thoại nhân viên y tế vào khung ngắm.
            </Text>
          </>
        ) : (
          <View style={styles.center}>
            {state === 'scanning' && (
              <>
                <Ionicons name="camera-outline" size={38} color="#64748B" />
                <Text style={styles.hint}>Cho phép robot sử dụng camera để quét mã QR nhân viên.</Text>
                {permission?.canAskAgain !== false ? (
                  <Pressable style={styles.btn} onPress={() => void requestPermission()}>
                    <Text style={styles.btnText}>Cấp quyền camera</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.hint}>Mở Cài đặt ứng dụng để cấp quyền camera.</Text>
                )}
              </>
            )}

            {state === 'verifying' && (
              <>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.hint}>Đang xác thực mã QR với hệ thống…</Text>
              </>
            )}

            {state === 'verified' && (
              <>
                <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                <Text style={styles.title}>Xác thực thành công</Text>
                <Text style={styles.hint}>
                  Hệ thống đã xác nhận danh tính. Đợi robot mở khóa ngăn tủ.
                </Text>
                <Pressable style={styles.btn} onPress={onClose}>
                  <Text style={styles.btnText}>Về nhiệm vụ</Text>
                </Pressable>
              </>
            )}

            {state === 'error' && (
              <>
                <Ionicons name="alert-circle" size={42} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  style={styles.btn}
                  onPress={() => { locked.current = false; setState('scanning'); }}
                >
                  <Text style={styles.btnText}>Quét lại</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A', paddingHorizontal: 16, paddingTop: 48 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerText: { flex: 1 },
  title: { color: '#F1F5F9', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  close: { padding: 8 },
  camera: {
    width: '100%', aspectRatio: 1, borderRadius: radii.lg,
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#000000',
  },
  frame: {
    width: 220, height: 220, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 20, justifyContent: 'center', alignItems: 'center',
  },
  hint: { color: '#94A3B8', textAlign: 'center', fontSize: 14, marginTop: 14 },
  center: { alignItems: 'center', gap: 14, paddingVertical: 40 },
  btn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: radii.md,
    backgroundColor: colors.primary, marginTop: 8,
  },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  errorText: { color: '#FCA5A5', textAlign: 'center', fontSize: 14 },
});
