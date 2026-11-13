import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RootStackParamList } from '../../app/navigation';
import { useRobotSession } from '../../app/RobotSession';
import { AppText, Button, Card, LoadingState, Notice, Screen, StatusChip } from '../../components/ui';
import { isDemoMode, NavigationTask, robotService } from '../../services/robot';
import { colors, radii, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Navigation'>;

const labels: Record<NavigationTask['status'], string> = {
  active: 'Đang hướng dẫn',
  pending: 'Đang chờ tiếp nhận',
  blocked: 'Lộ trình đang bị gián đoạn',
  stopped: 'Đã dừng lộ trình',
  arrived: 'Đã đến nơi',
};

export function NavigationScreen({ route, navigation }: Props) {
  const { setActiveTaskId } = useRobotSession();
  const [task, setTask] = useState<NavigationTask | null>(null);
  const [error, setError] = useState('');
  const [stopError, setStopError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [retry, setRetry] = useState(0);
  const mutationInFlight = useRef(false);
  const revision = useRef(0);
  const taskId = route.params.taskId;

  const receive = useCallback((result: NavigationTask) => {
    setTask(result);
    setActiveTaskId(result.status === 'stopped' || result.status === 'arrived' ? null : result.id);
  }, [setActiveTaskId]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = revision.current;
      if (!mutationInFlight.current) {
        try {
          const result = await robotService.getNavigation(taskId);
          if (alive && version === revision.current) {
            receive(result);
            setError('');
          }
          if (result.status === 'stopped' || result.status === 'arrived') return;
        } catch (cause) {
          if (alive && version === revision.current)
            setError(cause instanceof Error ? cause.message : 'Chưa thể cập nhật lộ trình.');
        }
      }
      if (alive) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [taskId, retry, receive]));

  async function stop() {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    revision.current += 1;
    setStopping(true);
    setStopError('');
    try {
      const result = await robotService.stopNavigation(taskId);
      receive(result);
      setError('');
    } catch (cause) {
      setStopError(cause instanceof Error ? cause.message : 'Chưa xác nhận robot đã dừng. Hãy nhờ nhân viên hỗ trợ.');
    } finally {
      mutationInFlight.current = false;
      revision.current += 1;
      setStopping(false);
      setRetry((n) => n + 1);
    }
  }

  const finished = task?.status === 'arrived' || task?.status === 'stopped';

  return (
    <Screen>
      {isDemoMode && (
        <Notice message="Lộ trình mô phỏng · Robot thực tế không di chuyển. Tiến độ sẽ lấy từ robot khi kết nối." />
      )}

      {error && (
        <View style={{ gap: spacing.sm }}>
          <Notice message={`${error} Trạng thái hiển thị có thể chưa được cập nhật.`} tone="error" />
          <Button title="Cập nhật lại" variant="secondary" onPress={() => setRetry((n) => n + 1)} />
        </View>
      )}

      {!task && !error && <LoadingState message="Đang nhận lộ trình…" />}

      {task && (
        <>
          {/* Main Destination Hero Card */}
          <Card style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name={finished ? 'checkmark-circle' : 'navigate'}
                  size={26}
                  color={finished ? colors.successText : colors.textPrimary}
                />
              </View>
              <StatusChip
                label={task.mode === 'escort' ? 'ROBOT DẪN ĐƯỜNG' : 'CHỈ ĐƯỜNG TỪNG BƯỚC'}
                tone={task.mode === 'escort' ? 'hero' : 'neutral'}
                size="sm"
              />
            </View>

            <AppText variant="title" style={styles.destTitleText}>
              {task.destinationName}
            </AppText>

            <View style={styles.statusRow}>
              <StatusChip
                label={error ? 'Chưa xác nhận trạng thái mới nhất' : labels[task.status]}
                tone={
                  task.status === 'arrived'
                    ? 'success'
                    : task.status === 'blocked'
                    ? 'danger'
                    : 'info'
                }
              />
            </View>

            {task.status === 'blocked' && (
              <Notice message="Vui lòng chờ tại vị trí an toàn và nhờ nhân viên hỗ trợ." tone="error" />
            )}
          </Card>

          {/* Stepper Card */}
          <View style={styles.sectionHeader}>
            <AppText variant="heading" style={{ fontWeight: '700' }}>
              Các bước di chuyển
            </AppText>
          </View>

          <Card style={styles.stepsCard}>
            {task.steps.map((step, index) => {
              const isCurrent = index === task.currentStep && !finished;
              const isDone = index < task.currentStep || finished;

              return (
                <View key={`${index}-${step}`} style={styles.stepRow}>
                  <View
                    style={[
                      styles.stepNumberDot,
                      isCurrent && styles.stepNumberDotActive,
                      isDone && styles.stepNumberDotDone,
                    ]}
                  >
                    {isDone ? (
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    ) : (
                      <AppText
                        style={[
                          styles.stepNumberText,
                          isCurrent && { color: colors.textInverse },
                        ]}
                      >
                        {index + 1}
                      </AppText>
                    )}
                  </View>
                  <AppText
                    style={[
                      styles.stepContentText,
                      isCurrent && styles.stepContentTextActive,
                    ]}
                  >
                    {step}
                  </AppText>
                </View>
              );
            })}
          </Card>
        </>
      )}

      {stopError && <Notice message={stopError} tone="error" />}

      {/* Action Buttons */}
      <View style={styles.actions}>
        {!finished && (
          <Button
            title={stopping ? 'Đang gửi yêu cầu dừng…' : 'Dừng lộ trình'}
            icon="stop-circle"
            variant="danger"
            loading={stopping}
            onPress={() => void stop()}
          />
        )}
        {finished && (
          <Button
            title="Về trang chính"
            icon="home-outline"
            onPress={() => navigation.popToTop()}
          />
        )}
        <Button
          title="Nhờ nhân viên hỗ trợ (SOS)"
          variant="secondary"
          icon="alert-circle-outline"
          onPress={() => navigation.navigate('Emergency')}
        />
      </View>

      {!finished && (
        <AppText variant="caption" style={styles.safetyFooter}>
          Nếu cần dừng robot ngay lập tức, hãy nhấn nút dừng cơ học trên thân robot. Nút trên màn hình cần kết nối mạng để gửi lệnh.
        </AppText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destTitleText: {
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  stepsCard: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepNumberDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepNumberDotActive: {
    backgroundColor: colors.hero,
    borderColor: colors.hero,
  },
  stepNumberDotDone: {
    backgroundColor: colors.successText,
    borderColor: colors.successText,
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  stepContentText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    paddingTop: 2,
  },
  stepContentTextActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  safetyFooter: {
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
});
