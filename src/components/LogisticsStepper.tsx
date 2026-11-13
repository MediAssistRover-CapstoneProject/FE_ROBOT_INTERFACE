import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from './ui';
import { colors, radii, spacing, typography } from '../theme';

interface Props {
  currentStep: number; // 1 to 6
  steps?: string[];
  warningStep?: number;
  returnStep?: number;
}

const DEFAULT_STEPS = [
  'Nhận\nnhiệm vụ',
  'Lấy\nvật phẩm',
  'Vận\nchuyển',
  'Đến\nnơi',
  'Bàn\ngiao',
  'Hoàn\nthành',
];

export function LogisticsStepper({ currentStep, steps = DEFAULT_STEPS, warningStep, returnStep }: Props) {
  const stepList = steps;
  return (
    <View style={styles.container}>
      <View style={styles.stepperRow}>
        {stepList.map((step, idx) => {
          const stepNum = idx + 1;
          const isDone = stepNum < currentStep && warningStep !== stepNum && returnStep !== stepNum;
          const isWarning = warningStep === stepNum;
          const isReturn = returnStep === stepNum;
          const isAlert = isWarning || isReturn;
          const isActive = stepNum === currentStep && !isAlert;

          return (
            <React.Fragment key={idx}>
              {/* Connector line before circle (except first) */}
              {idx > 0 && (
                <View
                  style={[
                    styles.connector,
                    stepNum <= currentStep ? styles.connectorActive : styles.connectorInactive,
                    isAlert && styles.connectorWarning,
                  ]}
                />
              )}

              {/* Circle Icon */}
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.circle,
                    isDone && styles.circleDone,
                    isActive && styles.circleActive,
                    isAlert && styles.circleWarning,
                    !isDone && !isActive && !isAlert && styles.circleUpcoming,
                  ]}
                >
                  {isReturn ? (
                    <Ionicons name="arrow-undo" size={14} color="#FFFFFF" />
                  ) : isWarning ? (
                    <AppText style={styles.warningExclamation}>!</AppText>
                  ) : isDone ? (
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  ) : isActive ? (
                    <View style={styles.activeDot} />
                  ) : (
                    <AppText style={styles.upcomingText}>{stepNum}</AppText>
                  )}
                </View>
                <AppText
                  style={[
                    styles.label,
                    isActive && styles.labelActive,
                    isAlert && styles.labelWarning,
                    isDone && styles.labelDone,
                  ]}
                >
                  {step}
                </AppText>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    marginVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    width: 52,
  },
  connector: {
    flex: 1,
    height: 2,
    marginTop: 15,
    marginHorizontal: -4,
  },
  connectorActive: {
    backgroundColor: colors.hero,
  },
  connectorWarning: {
    backgroundColor: colors.warningText,
  },
  connectorInactive: {
    backgroundColor: colors.border,
  },
  circle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  circleDone: {
    backgroundColor: colors.successText,
  },
  circleActive: {
    backgroundColor: colors.hero,
    borderWidth: 3,
    borderColor: colors.darkRaised,
  },
  circleWarning: {
    backgroundColor: colors.warningText,
    borderWidth: 3,
    borderColor: colors.warningSurface,
  },
  circleUpcoming: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textInverse,
  },
  upcomingText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  warningExclamation: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
    lineHeight: 16,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    color: colors.textSecondary,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  labelWarning: {
    color: colors.warningText,
    fontWeight: '700',
  },
  labelDone: {
    color: colors.successText,
    fontWeight: '600',
  },
});
