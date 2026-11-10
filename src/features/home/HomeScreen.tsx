import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../app/navigation';
import { PatientHubScreen } from '../patient/PatientHubScreen';
import type { DeliveryConnection } from '../logistics/deliveryReader';
import { QrDeliveryMissionScreen } from '../logistics/QrDeliveryMissionScreen';
import { AppText } from '../../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type AppTab = 'patient' | 'qrDelivery';

export function HomeScreen(props: Props) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<AppTab>('patient');
  const [deliveryConnection, setDeliveryConnection] = useState<DeliveryConnection | null>(null);

  return (
    <View style={styles.container}>
      {/* Active Screen View */}
      <View style={styles.screenArea}>
        {activeTab === 'patient' && <PatientHubScreen {...props} />}
        {activeTab === 'qrDelivery' && (
          <QrDeliveryMissionScreen connection={deliveryConnection} onConnect={setDeliveryConnection} />
        )}
      </View>

      {/* Mode Switcher Navigation Dock (Floating Pill at Bottom) */}
      <View style={[styles.dockContainer, { paddingBottom: Math.max(10, insets.bottom) }]}>
        <View style={styles.dockBar}>
          {/* Tab 1: Bệnh nhân */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab('patient')}
            style={[styles.dockTab, activeTab === 'patient' && styles.dockTabActive]}
          >
            <Ionicons
              name={activeTab === 'patient' ? 'person' : 'person-outline'}
              size={13}
              color={activeTab === 'patient' ? '#FFFFFF' : '#94A3B8'}
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
            accessibilityRole="button"
            onPress={() => setActiveTab('qrDelivery')}
            style={[styles.dockTab, activeTab === 'qrDelivery' && styles.dockTabActive]}
          >
            <Ionicons
              name={activeTab === 'qrDelivery' ? 'qr-code' : 'qr-code-outline'}
              size={13}
              color={activeTab === 'qrDelivery' ? '#FFFFFF' : '#94A3B8'}
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
    backgroundColor: '#F8FAFC',
  },
  screenArea: {
    flex: 1,
  },
  dockContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  dockBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 30,
    padding: 4,
    gap: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dockTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 24,
  },
  dockTabActive: {
    backgroundColor: '#0066CC',
  },
  dockLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  dockLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
