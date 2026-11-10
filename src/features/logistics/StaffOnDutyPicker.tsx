import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Card, Notice } from '../../components/ui';
import { apiClient } from '../../services/api/client';
import { colors, radii } from '../../theme';

/**
 * Thông tin nhân viên đang trực ca — trả về từ `GET /api/v1/staff/on-duty`
 */
export interface OnDutyStaff {
  staffProfileId: string;
  accountId: string;
  fullName: string;
  avatarUrl?: string | null;
  shiftId: string;
  startsAt: string;
  endsAt: string;
  checkedInAt?: string | null;
  roomId?: string;
  roomCode?: string;
  roomName?: string;
  endpointId?: string | null;
  deliverable?: boolean;
  reason?: string | null;
}

interface Props {
  selected: OnDutyStaff | null;
  onSelect: (staff: OnDutyStaff) => void;
}

async function fetchOnDutyStaff(): Promise<OnDutyStaff[]> {
  const token = await apiClient.ensureDeviceToken();
  const baseUrl = apiClient.getBaseUrl();
  const res = await fetch(`${baseUrl}/api/v1/staff/on-duty?page=0&size=100`, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new Error('AUTH_REQUIRED');
    }
    throw new Error(`Staff API lỗi ${res.status}`);
  }
  const data = await res.json();
  const content: unknown[] = Array.isArray(data?.content) ? data.content : [];
  return content.filter(
    (s: any) => s && typeof s.accountId === 'string' && typeof s.fullName === 'string',
  ) as OnDutyStaff[];
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function StaffOnDutyPicker({ selected, onSelect }: Props) {
  const [staff, setStaff] = useState<OnDutyStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchOnDutyStaff()
      .then((list) => {
        if (alive) {
          setStaff(list);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setLoading(false);
        if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
          setError('Cần quyền STAFF/ADMIN để xem danh sách nhân viên trực ca.');
        } else {
          setError('Không thể tải danh sách nhân viên. Kiểm tra kết nối Backend.');
        }
      });
    return () => { alive = false; };
  }, []);

  const refresh = () => {
    setLoading(true);
    setError('');
    fetchOnDutyStaff()
      .then(setStaff)
      .catch(() => setError('Không thể tải danh sách nhân viên.'))
      .finally(() => setLoading(false));
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="caption">Đang tải danh sách nhân viên trực ca…</AppText>
      </View>
    );
  }

  if (error) {
    return (
      <View>
        <Notice message={error} tone="error" />
        <Pressable style={styles.retryBtn} onPress={refresh}>
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <AppText style={styles.retryText}>Thử lại</AppText>
        </Pressable>
      </View>
    );
  }

  if (staff.length === 0) {
    return <Notice message="Không có nhân viên nào đang trực ca. Hãy kiểm tra ca trực trên hệ thống." />;
  }

  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <Ionicons name="people" size={16} color={colors.primary} />
        <AppText style={styles.headerText}>
          NHÂN VIÊN ĐANG TRỰC ({staff.length})
        </AppText>
        <Pressable onPress={refresh} hitSlop={8}>
          <Ionicons name="refresh-outline" size={16} color="#64748B" />
        </Pressable>
      </View>
      <FlatList
        data={staff}
        keyExtractor={(item) => item.accountId}
        scrollEnabled={staff.length > 4}
        style={staff.length > 4 ? styles.scrollable : undefined}
        renderItem={({ item }) => {
          const isSelected = selected?.accountId === item.accountId;
          return (
            <Pressable
              style={[styles.staffRow, isSelected && styles.staffRowSelected]}
              onPress={() => onSelect(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                <Ionicons
                  name={isSelected ? 'checkmark' : 'person'}
                  size={18}
                  color={isSelected ? '#FFFFFF' : '#64748B'}
                />
              </View>
              <View style={styles.info}>
                <AppText style={[styles.name, isSelected && styles.nameSelected]}>
                  {item.fullName}
                </AppText>
                <AppText style={styles.detail}>
                  {item.roomCode ?? 'Chưa rõ phòng'}
                  {item.roomName ? ` · ${item.roomName}` : ''}
                  {item.startsAt ? ` · ${formatTime(item.startsAt)}–${formatTime(item.endsAt)}` : ''}
                </AppText>
                {item.deliverable === false && item.reason && (
                  <AppText style={styles.warning}>{item.reason}</AppText>
                )}
              </View>
              {isSelected && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  list: { gap: 4 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6,
  },
  headerText: {
    flex: 1, color: colors.primaryDark, fontSize: 12,
    fontWeight: '800', letterSpacing: 0.5,
  },
  scrollable: { maxHeight: 280 },
  staffRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: radii.md, borderWidth: 1.5,
    borderColor: 'transparent',
  },
  staffRowSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(2,132,199,0.06)',
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F1F5F9', alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelected: { backgroundColor: colors.primary },
  info: { flex: 1, gap: 1 },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  nameSelected: { color: colors.primaryDark },
  detail: { fontSize: 11, color: '#64748B' },
  warning: { fontSize: 10, color: '#B91C1C', fontWeight: '600' },
  separator: { height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 10 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, justifyContent: 'center',
  },
  retryText: { color: colors.primary, fontWeight: '700' },
});
