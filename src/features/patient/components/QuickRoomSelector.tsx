import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../../../components/ui';
import { ClinicDestination } from '../types';

interface Props {
  rooms: ClinicDestination[];
  selectedRoomId: string;
  onSelectRoom: (roomId: string) => void;
  onStartEscort: () => void;
  loadingEscort?: boolean;
}

export function QuickRoomSelector({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onStartEscort,
  loadingEscort = false,
}: Props) {
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) || rooms[0];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleLeft}>
          <Ionicons name="location-outline" size={16} color="#475569" />
          <AppText style={styles.titleText}>CHỌN ĐIỂM ĐẾN</AppText>
        </View>
        <AppText style={styles.countText}>{rooms.length} phòng</AppText>
      </View>

      {/* Horizontal Room Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {rooms.map((room) => {
          const isSelected = room.id === selectedRoomId;
          return (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              onPress={() => onSelectRoom(room.id)}
              style={[styles.chip, isSelected && styles.chipSelected]}
            >
              <AppText style={[styles.chipCode, isSelected && styles.chipCodeSelected]}>
                {room.roomCode}
              </AppText>
              <AppText
                style={[styles.chipName, isSelected && styles.chipNameSelected]}
                numberOfLines={1}
              >
                {room.name}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Destination Confirmation Bar */}
      {selectedRoom && (
        <View style={styles.destinationBar}>
          <View style={styles.infoCol}>
            <AppText style={styles.destName} numberOfLines={1}>
              {selectedRoom.name}
            </AppText>
            <AppText style={styles.destMeta}>
              {selectedRoom.location} · {selectedRoom.distance} · {selectedRoom.eta}
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onStartEscort}
            disabled={loadingEscort}
            style={({ pressed }) => [
              styles.btnEscort,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            {loadingEscort ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="walk" size={18} color="#FFFFFF" />
                <AppText style={styles.btnEscortText}>Dẫn đường</AppText>
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  titleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E293B',
    letterSpacing: 0.3,
  },
  countText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  chipsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 95,
  },
  chipSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#0284C7',
    borderWidth: 1.5,
  },
  chipCode: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  chipCodeSelected: {
    color: '#0284C7',
  },
  chipName: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  chipNameSelected: {
    color: '#0369A1',
    fontWeight: '600',
  },
  destinationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  infoCol: {
    flex: 1,
  },
  destName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  destMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  btnEscort: {
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  btnEscortText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
