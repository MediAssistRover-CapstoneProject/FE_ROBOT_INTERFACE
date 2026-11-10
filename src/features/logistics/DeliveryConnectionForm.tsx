import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppText, Button, Card, Notice } from '../../components/ui';
import { colors, radii } from '../../theme';
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
        setError('Nhập UUID của nhiệm vụ (Job ID).');
        return;
      }
      onConnect({ mode, jobId: id });
      return;
    }

    const origin = bridgeOrigin(url);
    const pairingToken = key.trim();
    if (!origin || !/^[\x21-\x7e]{1,256}$/.test(pairingToken)) {
      setError('Nhập địa chỉ máy kết nối và mã ghép nối hợp lệ.');
      return;
    }
    onConnect({ mode, url: origin, pairingToken });
  }

  return (
    <Card>
      <AppText variant="heading">Kết nối giao nhận</AppText>
      {mode === 'bridge' ? (
        <>
          <AppText variant="caption">Nhập địa chỉ máy kết nối nội bộ và mã ghép nối do bộ phận điều phối cung cấp.</AppText>
          <TextInput
            accessibilityLabel="Địa chỉ máy kết nối giao nhận"
            value={url} onChangeText={setUrl} placeholder="http://192.168.1.20:8790"
            autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input}
          />
          <TextInput
            accessibilityLabel="Mã ghép nối màn hình"
            value={key} onChangeText={setKey} placeholder="Mã ghép nối"
            autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input}
          />
        </>
      ) : (
        <>
          <AppText variant="caption">Chế độ này chỉ hiển thị mã QR của nhiệm vụ đã chỉ định. Dùng kết nối giao nhận để xem tiến độ và thông tin giao nhận.</AppText>
          <TextInput
            accessibilityLabel="UUID nhiệm vụ giao nhận"
            value={jobId} onChangeText={setJobId} placeholder="Job ID (UUID)"
            autoCapitalize="none" autoCorrect={false} style={styles.input}
          />
        </>
      )}
      {!!error && <Notice message={error} tone="error" />}
      <Button title="Kết nối" onPress={connect} />
      <View style={styles.actions}>
        <Button
          title={mode === 'bridge' ? 'Chỉ hiển thị QR theo Job ID' : 'Dùng mã ghép nối màn hình'}
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
  input: {
    color: colors.text, fontSize: 16, minHeight: 50, borderWidth: 1,
    borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: 14,
  },
  actions: { gap: 8 },
});
