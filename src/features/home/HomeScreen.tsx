import React from 'react';
import { StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../app/navigation';
import { PatientHubScreen } from '../patient/PatientHubScreen';
import { colors } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen(props: Props) {
  return (
    <View style={styles.container}>
      <PatientHubScreen {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
