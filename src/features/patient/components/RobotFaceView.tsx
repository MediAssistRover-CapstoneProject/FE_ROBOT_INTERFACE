import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { AudioWaveform } from '../../../components/AudioWaveform';
import { AppText } from '../../../components/ui';
import type { ActiveVoiceInteractionSummary } from '../../../services/api/robotMapService';
import { colors, radii, spacing } from '../../../theme';
import type { RobotFaceExpression } from '../robotDisplayMode';

export interface RobotFaceViewProps {
  expression: RobotFaceExpression;
  activeVoice: ActiveVoiceInteractionSummary | null;
  mqttConnected?: boolean;
  onOpenMap: () => void;
}

const EXPRESSION_STATUS: Record<
  RobotFaceExpression,
  { label: string; dotColor: string }
> = {
  listening: { label: 'Đang lắng nghe', dotColor: '#4ADE80' },
  speaking: { label: 'Đang trả lời', dotColor: '#38BDF8' },
  happy: { label: 'Đang trò chuyện', dotColor: '#4ADE80' },
  idle: { label: 'Sẵn sàng giao tiếp', dotColor: '#38BDF8' },
};

export function RobotFaceView({
  expression,
  activeVoice,
  mqttConnected = true,
  onOpenMap,
}: RobotFaceViewProps) {
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const mouthAnim = useRef(new Animated.Value(0.35)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  // Nhịp chớp mắt tự nhiên (~3.8s/lần) + dao động nhẹ theo trạng thái sống động của robot
  useEffect(() => {
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(3_200),
        Animated.timing(blinkAnim, {
          toValue: 0.08,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(blinkAnim, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.delay(350),
      ]),
    );
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -4,
          duration: 1_800,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1_800,
          useNativeDriver: true,
        }),
      ]),
    );

    blinkLoop.start();
    floatLoop.start();

    return () => {
      blinkLoop.stop();
      floatLoop.stop();
    };
  }, [blinkAnim, floatAnim]);

  // Chuyển động miệng khi robot đang nói hoặc đang lắng nghe
  useEffect(() => {
    if (expression === 'speaking') {
      const talkLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouthAnim, {
            toValue: 1,
            duration: 170,
            useNativeDriver: true,
          }),
          Animated.timing(mouthAnim, {
            toValue: 0.35,
            duration: 160,
            useNativeDriver: true,
          }),
        ]),
      );
      talkLoop.start();
      return () => {
        talkLoop.stop();
      };
    }

    if (expression === 'listening') {
      const listenLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouthAnim, {
            toValue: 0.65,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(mouthAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      listenLoop.start();
      return () => {
        listenLoop.stop();
      };
    }

    mouthAnim.setValue(0.35);
    return undefined;
  }, [expression, mouthAnim]);

  const statusMeta =
    expression === 'idle' && !mqttConnected
      ? { label: 'Chế độ chờ', dotColor: '#FCD34D' }
      : EXPRESSION_STATUS[expression];

  const isListeningGlow = expression === 'listening';
  const showWave = expression === 'speaking' || expression === 'listening';

  return (
    <View style={styles.root} testID="robot-face-view">
      <View style={styles.visor}>
        {/* Thanh trạng thái trên cùng & nút chuyển nhanh sang bản đồ khi nhàn rỗi */}
        <View style={styles.topBar}>
          <View style={styles.statusPill} testID="robot-face-status-pill">
            <View style={[styles.statusDot, { backgroundColor: statusMeta.dotColor }]} />
            <AppText style={styles.statusText}>{statusMeta.label}</AppText>
          </View>

          <Pressable
            onPress={onOpenMap}
            testID="robot-face-open-map-btn"
            accessibilityRole="button"
            accessibilityLabel="Xem bản đồ bệnh viện"
            style={({ pressed }) => [
              styles.mapButton,
              pressed && styles.mapButtonPressed,
            ]}
          >
            <Ionicons name="map-outline" size={18} color="#FFFFFF" />
            <AppText style={styles.mapButtonText}>Xem bản đồ</AppText>
          </Pressable>
        </View>

        {/* Cụm mắt & miệng biểu cảm ở chính giữa màn hình robot */}
        <Animated.View
          style={[
            styles.faceCenter,
            { transform: [{ translateY: floatAnim }] },
          ]}
        >
          <View style={styles.eyesRow}>
            {[0, 1].map((eyeIndex) => (
              <Animated.View
                key={eyeIndex}
                style={[
                  styles.eyeWrap,
                  isListeningGlow && styles.eyeWrapListening,
                  expression !== 'happy'
                    ? { transform: [{ scaleY: blinkAnim }] }
                    : undefined,
                ]}
              >
                {expression === 'happy' ? (
                  <Svg width={96} height={86} viewBox="0 0 96 86">
                    <Path
                      d="M 14 54 Q 48 16 82 54"
                      fill="none"
                      stroke="#67E8F9"
                      strokeWidth={11}
                      strokeLinecap="round"
                    />
                    <Path
                      d="M 14 54 Q 48 16 82 54"
                      fill="none"
                      stroke="#E0F2FE"
                      strokeWidth={5}
                      strokeLinecap="round"
                    />
                  </Svg>
                ) : (
                  <Svg width={96} height={86} viewBox="0 0 96 86">
                    <Rect
                      x={10}
                      y={6}
                      width={76}
                      height={74}
                      rx={36}
                      fill="#0E5B7E"
                    />
                    <Rect
                      x={16}
                      y={12}
                      width={64}
                      height={62}
                      rx={30}
                      fill="#38BDF8"
                    />
                    <Rect
                      x={24}
                      y={18}
                      width={48}
                      height={48}
                      rx={22}
                      fill="#BAE6FD"
                    />
                    <Circle cx={38} cy={32} r={9} fill="#FFFFFF" />
                    <Circle cx={57} cy={49} r={4.5} fill="#E0F2FE" />
                  </Svg>
                )}
              </Animated.View>
            ))}
          </View>

          <View style={styles.mouthWrap}>
            {expression === 'speaking' ? (
              <Animated.View
                style={[
                  styles.speakingMouth,
                  { transform: [{ scaleY: mouthAnim }] },
                ]}
              />
            ) : expression === 'listening' ? (
              <Animated.View
                style={[
                  styles.listeningMouth,
                  { transform: [{ scaleX: mouthAnim }] },
                ]}
              />
            ) : (
              <Svg width={128} height={42} viewBox="0 0 128 42">
                <Path
                  d={
                    expression === 'happy'
                      ? 'M 22 10 Q 64 42 106 10'
                      : 'M 30 14 Q 64 34 98 14'
                  }
                  fill="none"
                  stroke="#67E8F9"
                  strokeWidth={7}
                  strokeLinecap="round"
                />
              </Svg>
            )}
          </View>
        </Animated.View>

        {/* Thanh lời thoại / hướng dẫn cơ bản phía dưới (chừa góc phải cho nút SOS nổi) */}
        <View style={styles.bottomCard}>
          <View style={styles.dialogRow}>
            {showWave ? (
              <View style={styles.waveWrap}>
                <AudioWaveform color="#67E8F9" count={10} height={26} />
              </View>
            ) : (
              <View style={styles.botBadge}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color="#E0F2FE" />
              </View>
            )}

            <View style={styles.dialogCopy}>
              {activeVoice?.lastAnswerText ? (
                <>
                  {activeVoice.lastUserText ? (
                    <AppText style={styles.userQuote} numberOfLines={1}>
                      Bạn: “{activeVoice.lastUserText}”
                    </AppText>
                  ) : null}
                  <AppText style={styles.primarySpeech} numberOfLines={2}>
                    {activeVoice.lastAnswerText}
                  </AppText>
                </>
              ) : activeVoice ? (
                <>
                  <AppText style={styles.primarySpeech}>
                    Xin chào! Tôi đang lắng nghe bạn...
                  </AppText>
                  <AppText style={styles.secondaryHint} numberOfLines={1}>
                    Hãy hỏi tôi thông tin khám bệnh hoặc đường tới các khoa phòng
                  </AppText>
                </>
              ) : (
                <>
                  <AppText style={styles.primarySpeech}>
                    Xin chào! Tôi là MediAssist Rover
                  </AppText>
                  <AppText style={styles.secondaryHint} numberOfLines={1}>
                    Hãy nói chuyện với tôi hoặc hỏi đường tới các khoa phòng
                  </AppText>
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.background,
  },
  visor: {
    flex: 1,
    backgroundColor: colors.darkDeepBg,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.heroNestedBg,
    padding: spacing.xl,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.heroBlockBg,
    borderWidth: 1,
    borderColor: colors.heroNestedBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusText: {
    color: '#E0F2FE',
    fontSize: 13.5,
    fontWeight: '700',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.heroSurface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(186, 230, 253, 0.35)',
    minHeight: 44,
  },
  mapButtonPressed: {
    opacity: 0.85,
  },
  mapButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  faceCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  eyesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 72,
  },
  eyeWrap: {
    width: 112,
    height: 102,
    borderRadius: 56,
    backgroundColor: 'rgba(18, 107, 147, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeWrapListening: {
    backgroundColor: 'rgba(56, 189, 248, 0.24)',
    borderWidth: 2,
    borderColor: 'rgba(103, 232, 249, 0.55)',
  },
  mouthWrap: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakingMouth: {
    width: 72,
    height: 28,
    borderRadius: 16,
    backgroundColor: '#67E8F9',
    borderWidth: 2,
    borderColor: '#E0F2FE',
  },
  listeningMouth: {
    width: 56,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#38BDF8',
  },
  bottomCard: {
    backgroundColor: colors.heroBlockBg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.heroNestedBg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingRight: 96,
  },
  dialogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  botBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.heroSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveWrap: {
    width: 56,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.heroNestedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogCopy: {
    flex: 1,
    gap: 2,
  },
  userQuote: {
    color: '#BAE6FD',
    fontSize: 13,
    fontWeight: '600',
  },
  primarySpeech: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  secondaryHint: {
    color: '#CBD5E1',
    fontSize: 13.5,
    fontWeight: '500',
  },
});
