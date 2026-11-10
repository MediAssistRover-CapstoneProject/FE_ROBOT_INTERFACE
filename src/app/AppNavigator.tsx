import React, { useEffect } from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as ScreenOrientation from 'expo-screen-orientation';
import { HomeScreen } from '../features/home/HomeScreen';
import { DestinationsScreen } from '../features/navigation/DestinationsScreen';
import { NavigationScreen } from '../features/navigation/NavigationScreen';
import { AssistantScreen } from '../features/assistant/AssistantScreen';
import { EmergencyScreen } from '../features/emergency/EmergencyScreen';
import { InformationScreen } from '../features/information/InformationScreen';
import { colors } from '../theme';
import { RootStackParamList } from './navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();
const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: '#0F172A',
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

export function AppNavigator() {
  // Khóa cứng chiều ngang màn hình (Landscape) vĩnh viễn cho Robot App
  useEffect(() => {
    async function lockLandscape() {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } catch (e) {
        console.warn('Could not lock orientation to landscape:', e);
      }
    }
    lockLandscape();
  }, []);

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        screenOptions={{
          headerTintColor: colors.primary,
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: '#0F172A' },
          animation: 'none',
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false, title: 'Trang chính' }}
        />
        <Stack.Screen
          name="Destinations"
          component={DestinationsScreen}
          options={{ title: 'Chọn điểm đến' }}
        />
        <Stack.Screen
          name="Navigation"
          component={NavigationScreen}
          options={{ title: 'Hướng dẫn di chuyển', gestureEnabled: false }}
        />
        <Stack.Screen
          name="Assistant"
          component={AssistantScreen}
          options={{ title: 'Hỏi trợ lý' }}
        />
        <Stack.Screen
          name="Information"
          component={InformationScreen}
          options={{ title: 'Thông tin khám bệnh' }}
        />
        <Stack.Screen
          name="Emergency"
          component={EmergencyScreen}
          options={{ headerShown: false, title: 'Cuộc gọi khẩn cấp' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
