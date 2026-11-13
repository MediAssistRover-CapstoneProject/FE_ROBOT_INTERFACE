import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Notice, Screen, StatusChip } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';
import { robotApiService } from '../../services/api';
import { HospitalInformationResponse } from '../../services/api/types';

const steps = [
  {
    title: 'Đăng ký và tiếp đón',
    summary: 'Bắt đầu tại quầy tiếp đón ở sảnh chính.',
    description:
      'Đến quầy tiếp đón để được hướng dẫn đăng ký khám. Chuẩn bị giấy tờ và thông tin theo yêu cầu của bệnh viện, sau đó kiểm tra số thứ tự và khu vực khám được hướng dẫn.',
    icon: 'clipboard-outline' as const,
  },
  {
    title: 'Khám với bác sĩ',
    summary: 'Đến đúng phòng khám và chờ gọi số.',
    description:
      'Tìm phòng khám theo thông tin đăng ký. Theo dõi bảng gọi số hoặc hướng dẫn của nhân viên để biết lượt của mình. Trao đổi tình trạng và nhu cầu khám trực tiếp với bác sĩ.',
    icon: 'medical-outline' as const,
  },
  {
    title: 'Thực hiện chỉ định',
    summary: 'Nếu bác sĩ yêu cầu xét nghiệm hoặc chụp chiếu.',
    description:
      'Nếu có chỉ định xét nghiệm, chẩn đoán hình ảnh hoặc dịch vụ khác, làm theo hướng dẫn của bác sĩ và nhân viên. Hỏi quầy hỗ trợ về địa điểm, thủ tục thanh toán và cách nhận kết quả.',
    icon: 'document-text-outline' as const,
  },
  {
    title: 'Nhận kết quả và kết thúc',
    summary: 'Hoàn tất buổi khám và nhận đơn thuốc.',
    description:
      'Quay lại phòng khám khi được hướng dẫn để bác sĩ xem kết quả. Kiểm tra thông tin thanh toán, đơn thuốc và lịch hẹn nếu có. Hỏi nhân viên nếu còn bước nào chưa rõ trước khi ra về.',
    icon: 'checkmark-circle-outline' as const,
  },
];

export function InformationScreen() {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [articles, setArticles] = useState<HospitalInformationResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isLiveApi, setIsLiveApi] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    robotApiService
      .getPublicHospitalInfo(0, 10)
      .then((res) => {
        if (alive && res && Array.isArray(res.content) && res.content.length > 0) {
          setArticles(res.content);
          setIsLiveApi(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen>
      <View style={styles.layout}>
        <View style={styles.heading}>
          <AppText variant="title">Quy trình khám ngoại trú</AppText>
          <AppText style={styles.description}>
            Xem từng bước để biết bạn cần chuẩn bị và làm gì tiếp theo.
          </AppText>
        </View>

        {isLiveApi ? (
          <Notice message="Đang kết nối danh mục cẩm nang Bệnh viện từ Local Backend." tone="info" />
        ) : (
          <Notice message="Đây là quy trình minh họa. Các bước thực tế có thể khác; vui lòng xác nhận với nhân viên bệnh viện." />
        )}

        {loading && <ActivityIndicator size="small" color={colors.primaryAction} style={{ marginVertical: 12 }} />}

        {/* Live Articles Section if available from Backend */}
        {articles.length > 0 && (
          <View style={styles.articlesSection}>
            <AppText variant="caption" style={styles.sectionHeaderTitle}>
              CẨM NANG & THÔNG TIN BỆNH VIỆN
            </AppText>
            {articles.slice(0, 2).map((art, idx) => (
              <View key={art.hospitalInformationId || idx} style={styles.articleCard}>
                <View style={styles.articleHeader}>
                  <Ionicons name="newspaper-outline" size={18} color={colors.textPrimary} />
                  <AppText style={styles.articleTitle}>
                    {art.title || 'Thông tin bệnh viện'}
                  </AppText>
                </View>
                <AppText style={styles.articleBody} numberOfLines={3}>
                  {art.content}
                </AppText>
              </View>
            ))}
          </View>
        )}

        <View style={styles.steps}>
          {steps.map((step, index) => {
            const isExpanded = expanded === index;
            return (
              <View key={step.title} style={styles.stepCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Bước ${index + 1}: ${step.title}`}
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityHint={isExpanded ? 'Thu gọn hướng dẫn' : 'Xem hướng dẫn chi tiết'}
                  onPress={() => setExpanded(isExpanded ? null : index)}
                  style={({ pressed }) => [
                    styles.stepHeader,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.stepNumber}>
                    <AppText style={styles.numberText}>{index + 1}</AppText>
                  </View>
                  <View style={styles.stepTitle}>
                    <AppText variant="heading" style={styles.titleText}>{step.title}</AppText>
                    <AppText variant="caption" style={styles.stepSummary}>
                      {step.summary}
                    </AppText>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color={colors.textSecondary}
                    accessible={false}
                  />
                </Pressable>

                {isExpanded && (
                  <View style={styles.stepDetails}>
                    <View style={styles.detailLabel}>
                      <Ionicons
                        name={step.icon}
                        size={18}
                        color={colors.textPrimary}
                        accessible={false}
                      />
                      <AppText variant="caption" style={styles.detailLabelText}>
                        Hướng dẫn chi tiết
                      </AppText>
                    </View>
                    <AppText style={styles.stepDescText}>{step.description}</AppText>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.helpNote}>
          <Ionicons
            name="information-circle-outline"
            size={22}
            color={colors.textSecondary}
            accessible={false}
          />
          <AppText variant="caption" style={styles.helpText}>
            Nếu chưa rõ bước tiếp theo, hãy hỏi nhân viên y tế tại quầy tiếp đón hoặc bấm SOS trên robot.
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: {
    gap: spacing.xl,
    paddingBottom: 40,
  },
  heading: {
    gap: spacing.xs,
  },
  description: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  articlesSection: {
    gap: spacing.sm,
  },
  sectionHeaderTitle: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  articleCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  articleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  articleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  articleBody: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  steps: {
    gap: spacing.md,
  },
  stepCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  stepHeader: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  stepNumber: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.hero,
    borderRadius: 20,
  },
  numberText: {
    fontWeight: '700',
    color: colors.textInverse,
    fontSize: 16,
  },
  stepTitle: {
    flex: 1,
    gap: 4,
  },
  titleText: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stepSummary: {
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.75,
  },
  stepDetails: {
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailLabelText: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  stepDescText: {
    color: colors.textSecondary,
    lineHeight: 24,
  },
  helpNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 2,
  },
  helpText: {
    flex: 1,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
