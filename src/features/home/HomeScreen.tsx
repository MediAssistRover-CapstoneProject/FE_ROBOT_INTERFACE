import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../app/navigation';
import { PatientHubScreen } from '../patient/PatientHubScreen';
import type { DeliveryConnection } from '../logistics/deliveryReader';
import { QrDeliveryMissionScreen } from '../logistics/QrDeliveryMissionScreen';
import { AppText } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type AppTab = 'patient' | 'qrDelivery';

export function HomeScreen(props: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [activeTab, setActiveTab] = useState<AppTab>('patient');
  const [deliveryConnection, setDeliveryConnection] = useState<DeliveryConnection | null>(null);

  return (
    <View style={styles.container}>
      {/* Active Screen View */}
      <View style={styles.screenArea}>
        {activeTab === 'patient' && <PatientHubScreen {...props} />}
        {activeTab === 'qrDelivery' && (
          <QrDeliveryMissionScreen
            connection={deliveryConnection}
            onConnect={setDeliveryConnection}
          />
        )}
      </View>

      {/* Mode Switcher Navigation Dock (Floating Pill in Charcoal #202022) */}
      <View
        pointerEvents="box-none"
        style={[
          styles.dockContainer,
          isLandscape
            ? {
                bottom: Math.max(spacing.sm, insets.bottom + 4),
                right: Math.max(spacing.xl, insets.right + 12),
                alignItems: 'flex-end',
              }
            : {
                bottom: 0,
                left: 0,
                right: 0,
                alignItems: 'center',
                paddingBottom: Math.max(spacing.md, insets.bottom),
              },
        ]}
      >
        <View style={styles.dockBar}>
          {/* Tab 1: Bệnh nhân */}
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Chế độ Bệnh nhân"
            accessibilityState={{ selected: activeTab === 'patient' }}
            onPress={() => setActiveTab('patient')}
            style={[styles.dockTab, activeTab === 'patient' && styles.dockTabActive]}
          >
            <Ionicons
              name={activeTab === 'patient' ? 'person' : 'person-outline'}
              size={18}
              color={activeTab === 'patient' ? colors.textPrimary : colors.textInverseSecondary}
            />
            <AppText
              style={[
                styles.dockLabel,
                activeTab === 'patient' && styles.dockLabelActive,
              ]}
            >
              Bệnh nhân
            </AppText>
          </Pressable>

          {/* Tab 2: Vận chuyển QR */}
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Chế độ Vận chuyển QR"
            accessibilityState={{ selected: activeTab === 'qrDelivery' }}
            onPress={() => setActiveTab('qrDelivery')}
            style={[styles.dockTab, activeTab === 'qrDelivery' && styles.dockTabActive]}
          >
            <Ionicons
              name={activeTab === 'qrDelivery' ? 'qr-code' : 'qr-code-outline'}
              size={18}
              color={activeTab === 'qrDelivery' ? colors.textPrimary : colors.textInverseSecondary}
            />
            <AppText
              style={[
                styles.dockLabel,
                activeTab === 'qrDelivery' && styles.dockLabelActive,
              ]}
            >
              Vận chuyển
            </AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenArea: {
    flex: 1,
  },
  dockContainer: {
    position: 'absolute',
    zIndex: 1000,
  },
  dockBar: {
    flexDirection: 'row',
    backgroundColor: colors.dock,
    borderRadius: radii.pill,
    padding: 5,
    gap: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
    borderWidth: 1,
    borderColor: colors.darkRaised,
  },
  dockTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  dockTabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  dockLabel: {
    color: colors.textInverseSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  dockLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
});
