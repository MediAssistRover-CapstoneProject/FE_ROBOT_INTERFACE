import Ionicons from '@expo/vector-icons/Ionicons';
import { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../theme';

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: PropsWithChildren<{ scroll?: boolean; contentStyle?: StyleProp<ViewStyle> }>) {
  const insets = useSafeAreaInsets();
  const containerStyle = [
    styles.container,
    {
      paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.md),
      paddingLeft: Math.max(spacing.xl, insets.left),
      paddingRight: Math.max(spacing.xl, insets.right),
    },
    contentStyle,
  ];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={containerStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[containerStyle, { flex: 1 }]}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';

export function AppText({
  variant = 'body',
  style,
  children,
  ...props
}: TextProps & { variant?: TextVariant }) {
  return (
    <Text {...props} style={[styles.text, typeStyles[variant], style]}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
  variant = 'surface',
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  variant?: 'surface' | 'hero' | 'muted';
}>) {
  const cardStyle = [
    styles.card,
    variant === 'hero' && styles.cardHero,
    variant === 'muted' && styles.cardMuted,
    style,
  ];
  return <View style={cardStyle}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  pill = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  pill?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isSecondary = variant === 'secondary';
  const isDanger = variant === 'danger';

  const backgroundColor = isSecondary
    ? colors.surface
    : isDanger
    ? colors.danger
    : colors.primaryAction;

  const foreground = isSecondary ? colors.textPrimary : colors.textInverse;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor },
        isSecondary && styles.buttonSecondaryBorder,
        pill && styles.buttonPill,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={22} color={foreground} />
      ) : null}
      <AppText
        variant="label"
        style={{
          color: foreground,
          fontWeight: '600',
          textAlign: 'center',
          flexShrink: 1,
        }}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

export function StatusChip({
  label,
  tone = 'neutral',
  icon,
  size = 'md',
  style,
}: {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'hero' | 'info';
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const isSmall = size === 'sm';

  const toneConfig: Record<
    string,
    { bg: string; text: string; iconColor: string; border?: string }
  > = {
    success: {
      bg: colors.successSurface,
      text: colors.successText,
      iconColor: colors.successText,
    },
    warning: {
      bg: colors.warningSurface,
      text: colors.warningText,
      iconColor: colors.warningText,
    },
    danger: {
      bg: colors.dangerSurface,
      text: colors.danger,
      iconColor: colors.danger,
    },
    neutral: {
      bg: colors.surfaceMuted,
      text: colors.textSecondary,
      iconColor: colors.textSecondary,
      border: colors.border,
    },
    hero: {
      bg: colors.hero,
      text: colors.textInverse,
      iconColor: colors.textInverse,
    },
    info: {
      bg: colors.logisticsCyanSoft,
      text: colors.logisticsCyan,
      iconColor: colors.logisticsCyan,
    },
  };

  const current = toneConfig[tone] || {
    bg: colors.surfaceMuted,
    text: colors.textSecondary,
    iconColor: colors.textSecondary,
    border: colors.border,
  };

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: current.bg,
          borderColor: current.border || 'transparent',
          paddingVertical: isSmall ? 4 : 6,
          paddingHorizontal: isSmall ? 10 : 12,
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={isSmall ? 13 : 15}
          color={current.iconColor}
          style={{ marginRight: 4 }}
        />
      ) : null}
      <AppText
        variant="caption"
        style={{
          color: current.text,
          fontWeight: '600',
          fontSize: isSmall ? 12 : 13,
          lineHeight: isSmall ? 16 : 18,
        }}
      >
        {label}
      </AppText>
    </View>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'surface',
  size = 48,
  disabled = false,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: 'surface' | 'dark' | 'ghost' | 'danger';
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDark = variant === 'dark';
  const isDanger = variant === 'danger';
  const isGhost = variant === 'ghost';

  const bg = isDark
    ? colors.hero
    : isDanger
    ? colors.dangerSurface
    : isGhost
    ? 'transparent'
    : colors.surface;

  const iconColor = isDark
    ? colors.textInverse
    : isDanger
    ? colors.danger
    : colors.textPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderWidth: isGhost ? 0 : 1,
          borderColor: isDark ? colors.darkRaised : colors.border,
        },
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={iconColor} />
    </Pressable>
  );
}

export function Notice({
  message,
  tone = 'info',
}: {
  message: string;
  tone?: 'info' | 'error' | 'success' | 'warning';
}) {
  const toneMap = {
    error: {
      bg: colors.dangerSurface,
      color: colors.danger,
      icon: 'alert-circle-outline' as const,
    },
    success: {
      bg: colors.successSurface,
      color: colors.successText,
      icon: 'checkmark-circle-outline' as const,
    },
    warning: {
      bg: colors.warningSurface,
      color: colors.warningText,
      icon: 'warning-outline' as const,
    },
    info: {
      bg: colors.surfaceMuted,
      color: colors.textPrimary,
      icon: 'information-circle-outline' as const,
    },
  };

  const current = toneMap[tone] || toneMap.info;

  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: current.bg }]}
    >
      <Ionicons name={current.icon} size={22} color={current.color} />
      <AppText
        variant="caption"
        style={{ flex: 1, color: current.color, fontWeight: '500' }}
      >
        {message}
      </AppText>
    </View>
  );
}

export function LoadingState({
  message = 'Đang tải thông tin…',
}: {
  message?: string;
}) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primaryAction} size="small" />
      <AppText variant="caption" style={{ color: colors.textSecondary }}>
        {message}
      </AppText>
    </View>
  );
}

const typeStyles: Record<TextVariant, TextStyle> = {
  display: typography.display,
  title: typography.pageTitle,
  heading: typography.sectionTitle,
  body: typography.body,
  label: typography.label,
  caption: typography.caption,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingTop: spacing.xxl,
    gap: spacing.xl,
    flexGrow: 1,
  },
  text: {
    color: colors.textPrimary,
  },
  card: {
    padding: spacing.xxl,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.xl,
    gap: spacing.md,
    // Soft subtle shadow for modern depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHero: {
    backgroundColor: colors.hero,
    borderColor: colors.darkRaised,
  },
  cardMuted: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderMuted,
  },
  button: {
    minHeight: 56,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonPill: {
    borderRadius: radii.pill,
  },
  buttonSecondaryBorder: {
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    padding: spacing.lg,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  loading: {
    paddingVertical: spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
});
