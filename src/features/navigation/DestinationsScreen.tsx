import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { RootStackParamList } from '../../app/navigation';
import { useRobotSession } from '../../app/RobotSession';
import { AppText, Button, Card, LoadingState, Notice, Screen, StatusChip } from '../../components/ui';
import { Destination, isDemoMode, robotService } from '../../services/robot';
import { colors, radii, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Destinations'>;

const filters = [
  { id: 'all', label: 'Tất cả' },
  { id: 'clinic', label: 'Phòng khám' },
  { id: 'lab', label: 'Xét nghiệm' },
  { id: 'pharmacy', label: 'Nhà thuốc' },
  { id: 'payment', label: 'Thanh toán' },
  { id: 'service', label: 'Dịch vụ' },
] as const;

const categoryIcons = {
  clinic: 'medkit-outline',
  lab: 'flask-outline',
  pharmacy: 'medical-outline',
  payment: 'card-outline',
  service: 'information-circle-outline',
} as const;

const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

export function DestinationsScreen({ navigation, route }: Props) {
  const {
    activeTaskId,
    navigationReady,
    checkingNavigation,
    navigationError,
    reconcileNavigation,
    requestNavigation,
  } = useRobotSession();

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    robotService
      .getDestinations()
      .then((data) => {
        if (alive) setDestinations(data);
      })
      .catch((cause) => {
        if (alive)
          setLoadError(
            cause instanceof Error ? cause.message : 'Chưa tải được danh sách địa điểm.'
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [retry]);

  async function start(destination: Destination) {
    if (submitting.current) return;
    if (activeTaskId) {
      navigation.navigate('Navigation', { taskId: activeTaskId });
      return;
    }
    submitting.current = true;
    setPendingId(destination.id);
    setError('');
    try {
      const task = await requestNavigation(destination.id, route.params.mode);
      if (mounted.current) navigation.replace('Navigation', { taskId: task.id });
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Chưa gửi được yêu cầu. Vui lòng thử lại.'
        );
    } finally {
      submitting.current = false;
      if (mounted.current) setPendingId(null);
    }
  }

  const visible = destinations.filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      searchable(`${item.name} ${item.floor} ${item.description}`).includes(
        searchable(query.trim())
      )
  );

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title">
          {route.params.mode === 'escort' ? 'Bạn muốn đến đâu?' : 'Tìm nơi bạn cần đến'}
        </AppText>
        <AppText variant="caption" style={styles.headerSubtitle}>
          {route.params.mode === 'escort'
            ? 'Chọn địa điểm bên dưới để robot tự hành dẫn đường cho bạn.'
            : 'Xem sơ đồ lộ trình và hướng dẫn di chuyển từng bước.'}
        </AppText>
      </View>

      {isDemoMode && (
        <Notice message="Danh sách địa điểm minh họa, chưa phải bản đồ của bệnh viện thực tế." />
      )}

      {activeTaskId && (
        <Button
          title="Quay lại lộ trình đang mở"
          variant="secondary"
          onPress={() => navigation.navigate('Navigation', { taskId: activeTaskId })}
        />
      )}

      {!navigationReady && pendingId === null && (
        <View style={{ gap: 10 }}>
          {navigationError && <Notice message={navigationError} tone="error" />}
          <Button
            title="Kiểm tra lộ trình hiện tại"
            variant="secondary"
            loading={checkingNavigation}
            onPress={() => void reconcileNavigation()}
          />
        </View>
      )}

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Tìm tên khoa phòng, bác sĩ hoặc dịch vụ…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          accessibilityLabel="Tìm địa điểm"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Xóa từ khóa tìm kiếm"
            onPress={() => setQuery('')}
            style={styles.clearBtn}
          >
            <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Category Filter Chips */}
      <View style={styles.filtersRow}>
        {filters.map((filter) => {
          const isSelected = category === filter.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={filter.id}
              onPress={() => setCategory(filter.id)}
              style={[
                styles.filterChip,
                isSelected ? styles.filterChipSelected : styles.filterChipUnselected,
              ]}
            >
              <AppText
                variant="caption"
                style={[
                  styles.filterChipText,
                  isSelected && styles.filterChipTextSelected,
                ]}
              >
                {filter.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {error && <Notice message={error} tone="error" />}

      {loading ? (
        <LoadingState message="Đang tải danh sách địa điểm…" />
      ) : loadError ? (
        <Card>
          <Notice message={loadError} tone="error" />
          <Button title="Tải lại địa điểm" onPress={() => setRetry((n) => n + 1)} />
        </Card>
      ) : (
        <>
          <AppText variant="caption" style={styles.countText}>
            Hiển thị {visible.length} địa điểm
          </AppText>

          {visible.length === 0 && (
            <Card>
              <AppText variant="heading">Chưa tìm thấy địa điểm</AppText>
              <AppText variant="caption" style={{ color: colors.textSecondary }}>
                Thử đổi từ khóa hoặc chọn “Tất cả”. Bạn cũng có thể bấm SOS hoặc nhờ nhân viên tại quầy.
              </AppText>
            </Card>
          )}

          <View style={styles.cardsGrid}>
            {visible.map((destination) => (
              <Card key={destination.id} style={styles.destCard}>
                <View style={styles.destinationHeader}>
                  <View style={styles.destIconBox}>
                    <Ionicons
                      name={categoryIcons[destination.category]}
                      size={22}
                      color={colors.textPrimary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="heading" style={styles.destTitle}>
                      {destination.name}
                    </AppText>
                    <AppText variant="caption" style={styles.destFloor}>
                      {destination.floor}
                    </AppText>
                  </View>
                </View>
                <AppText variant="caption" style={styles.destDesc}>
                  {destination.description}
                </AppText>
                <Button
                  title={route.params.mode === 'escort' ? 'Dẫn tôi đến đây' : 'Xem chỉ đường'}
                  onPress={() => void start(destination)}
                  variant="primary"
                  icon="navigate-outline"
                  loading={pendingId === destination.id}
                  disabled={pendingId !== null || activeTaskId !== null || !navigationReady}
                />
              </Card>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  clearBtn: {
    padding: spacing.xs,
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipUnselected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipSelected: {
    backgroundColor: colors.hero,
    borderWidth: 1,
    borderColor: colors.hero,
  },
  filterChipText: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
  filterChipTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  countText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  cardsGrid: {
    gap: spacing.md,
  },
  destCard: {
    gap: spacing.md,
  },
  destinationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  destIconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destTitle: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  destFloor: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  destDesc: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
