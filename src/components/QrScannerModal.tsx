import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, Notice } from './ui';
import { colors, radii, spacing, typography } from '../theme';

export type ScanState = 'scanning' | 'verifying' | 'verified' | 'error';

interface Props {
  title: string;
  subtitle?: string;
  onScan: (rawPayload: string) => Promise<void>;
  onClose: () => void;
}

export function QrScannerModal({ title, subtitle, onScan, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>('scanning');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const mounted = useRef(true);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height && width > 700;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
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

  const close = () => {
    if (state !== 'verifying') onClose();
  };

  // Tính toán kích thước camera an toàn cho tablet
  const cameraMaxHeight = Math.min(320, Math.round(height * 0.58));
  const cameraMaxWidth = Math.min(380, Math.round(width * 0.45));

  return (
    <Modal visible animationType="fade" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.modalContainer,
            isLandscape && styles.modalContainerLandscape,
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconCircle}>
                <Ionicons name="camera" size={20} color={colors.textPrimary} />
              </View>
              <View style={styles.headerText}>
                <AppText variant="heading" style={styles.titleText}>{title}</AppText>
                {!!subtitle && (
                  <AppText variant="caption" style={styles.subtitleText}>{subtitle}</AppText>
                )}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Đóng máy quét"
              onPress={close}
              disabled={state === 'verifying'}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.7 },
                state === 'verifying' && { opacity: 0.4 },
              ]}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          {/* Body Content */}
          <ScrollView
            contentContainerStyle={[
              styles.body,
              isLandscape && styles.bodyLandscape,
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Viewport Camera có giới hạn (không full màn hình, không méo) */}
            {state === 'scanning' && permission?.granted ? (
              <View style={[styles.cameraContainer, isLandscape && { flex: 1 }]}>
                <View
                  style={[
                    styles.cameraBox,
                    {
                      width: isLandscape ? cameraMaxWidth : '100%',
                      height: cameraMaxHeight,
                    },
                  ]}
                >
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={handleBarcode}
                  />
                  {/* Khung ngắm */}
                  <View pointerEvents="none" style={styles.viewfinder}>
                    <Ionicons name="scan" size={40} color="rgba(255,255,255,0.9)" />
                  </View>
                </View>
                <AppText variant="caption" style={styles.cameraHint}>
                  Hướng camera vào mã QR hiển thị trên ứng dụng Staff
                </AppText>
              </View>
            ) : null}

            {/* Trạng thái khác: xin quyền, đang xác thực, thành công, lỗi */}
            {state !== 'scanning' || !permission?.granted ? (
              <View style={[styles.statusBox, isLandscape && { flex: 1 }]}>
                {state === 'scanning' && !permission?.granted && (
                  <View style={styles.statusInner}>
                    <Ionicons name="camera-outline" size={48} color={colors.textSecondary} />
                    <AppText variant="heading" style={{ textAlign: 'center' }}>
                      Cần cấp quyền Camera
                    </AppText>
                    <AppText variant="caption" style={{ textAlign: 'center', color: colors.textSecondary }}>
                      Cho phép robot sử dụng camera để quét mã QR trên điện thoại nhân viên y tế.
                    </AppText>
                    {permission?.canAskAgain !== false ? (
                      <Button
                        title="Cấp quyền camera"
                        icon="key-outline"
                        onPress={() => void requestPermission()}
                      />
                    ) : (
                      <Notice
                        message="Vui lòng mở Cài đặt thiết bị để cho phép ứng dụng truy cập camera."
                        tone="warning"
                      />
                    )}
                  </View>
                )}

                {state === 'verifying' && (
                  <View style={styles.statusInner}>
                    <ActivityIndicator color={colors.primaryAction} size="large" />
                    <AppText variant="heading" style={{ textAlign: 'center' }}>
                      Đang xác thực mã QR…
                    </AppText>
                    <AppText variant="caption" style={{ textAlign: 'center', color: colors.textSecondary }}>
                      Đang gửi dữ liệu xác thực lên máy chủ Backend. Vui lòng giữ nguyên máy quét.
                    </AppText>
                  </View>
                )}

                {state === 'verified' && (
                  <View style={styles.statusInner}>
                    <Ionicons name="checkmark-circle" size={56} color={colors.successText} />
                    <AppText variant="heading" style={{ textAlign: 'center', color: colors.successText }}>
                      Xác thực thành công!
                    </AppText>
                    <AppText variant="caption" style={{ textAlign: 'center', color: colors.textSecondary }}>
                      Hệ thống đã xác nhận danh tính hợp lệ. Robot đang chuẩn bị mở chốt khoang.
                    </AppText>
                    <Button title="Về màn hình nhiệm vụ" onPress={onClose} />
                  </View>
                )}

                {state === 'error' && (
                  <View style={styles.statusInner}>
                    <Ionicons name="alert-circle" size={52} color={colors.danger} />
                    <AppText variant="heading" style={{ textAlign: 'center', color: colors.danger }}>
                      Xác thực không thành công
                    </AppText>
                    <Notice message={error} tone="error" />
                    <Button
                      title="Quét lại mã khác"
                      icon="refresh"
                      onPress={() => {
                        locked.current = false;
                        setState('scanning');
                      }}
                    />
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 620,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 12,
  },
  modalContainerLandscape: {
    maxWidth: 720,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  titleText: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitleText: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: {
    gap: spacing.lg,
    alignItems: 'center',
  },
  bodyLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraContainer: {
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
  },
  cameraBox: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  viewfinder: {
    width: 180,
    height: 180,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraHint: {
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  statusBox: {
    width: '100%',
    paddingVertical: spacing.lg,
  },
  statusInner: {
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
});
