import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppText, Button, Card, Notice } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';
import { bridgeOrigin, DEFAULT_DELIVERY_BRIDGE_URL, DeliveryConnection, isDeliveryJobId } from './deliveryReader';

export function DeliveryConnectionForm({ current, onConnect, onCancel }: {
  current: DeliveryConnection | null;
  onConnect: (connection: DeliveryConnection) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState(current?.mode ?? 'bridge');
  const [url, setUrl] = useState(current?.mode === 'bridge' ? current.url : DEFAULT_DELIVERY_BRIDGE_URL);
  const [key, setKey] = useState(current?.mode === 'bridge' ? current.pairingToken : '');
  const [jobId, setJobId] = useState(current?.mode === 'device' ? current.jobId : '');
  const [error, setError] = useState('');

  function connect() {
    if (mode === 'device') {
      const id = jobId.trim().toLowerCase();
      if (!isDeliveryJobId(id)) {
        setError('Vui lòng nhập đúng định dạng UUID của nhiệm vụ (Job ID).');
        return;
      }
      onConnect({ mode, jobId: id });
      return;
    }

    const origin = bridgeOrigin(url);
    const pairingToken = key.trim();
    if (!origin || !/^[\x21-\x7e]{1,256}$/.test(pairingToken)) {
      setError('Vui lòng nhập địa chỉ máy kết nối và mã ghép nối hợp lệ.');
      return;
    }
    onConnect({ mode, url: origin, pairingToken });
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <AppText variant="heading" style={styles.title}>Cài đặt kết nối nhiệm vụ</AppText>
        <AppText variant="caption" style={styles.subtitle}>
          {mode === 'bridge'
            ? 'Nhập địa chỉ máy kết nối nội bộ và mã ghép nối do bộ phận điều phối cung cấp.'
            : 'Chỉ hiển thị mã QR của nhiệm vụ đã chỉ định mà không kết nối cầu nối.'}
        </AppText>
      </View>

      {mode === 'bridge' ? (
        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <AppText variant="label" style={styles.fieldLabel}>Địa chỉ máy kết nối (URL)</AppText>
            <TextInput
              accessibilityLabel="Địa chỉ máy kết nối giao nhận"
              value={url}
              onChangeText={setUrl}
              placeholder="http://192.168.1.20:8790"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroup}>
            <AppText variant="label" style={styles.fieldLabel}>Mã ghép nối màn hình</AppText>
            <TextInput
              accessibilityLabel="Mã ghép nối màn hình"
              value={key}
              onChangeText={setKey}
              placeholder="Nhập mã ghép nối"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
          </View>
        </View>
      ) : (
        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <AppText variant="label" style={styles.fieldLabel}>Mã định danh nhiệm vụ (Job ID)</AppText>
            <TextInput
              accessibilityLabel="UUID nhiệm vụ giao nhận"
              value={jobId}
              onChangeText={setJobId}
              placeholder="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
        </View>
      )}

      {!!error && <Notice message={error} tone="error" />}

      <View style={styles.actions}>
        <Button title="Lưu và kết nối" onPress={connect} />
        <Button
          title={mode === 'bridge' ? 'Chuyển sang nhập Job ID trực tiếp' : 'Dùng mã ghép nối màn hình'}
          variant="secondary"
          onPress={() => {
            setMode(mode === 'bridge' ? 'device' : 'bridge');
            setError('');
          }}
        />
        {onCancel && <Button title="Quay lại" variant="secondary" onPress={onCancel} />}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.xxl,
    borderRadius: radii.xl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  fields: {
    gap: spacing.md,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    fontSize: 16,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
