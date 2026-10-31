import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Notice, Screen } from '../../components/ui';
import { colors } from '../../theme';
import { robotApiService } from '../../services/api';
import { HospitalInformationResponse } from '../../services/api/types';

const steps = [
  {
    title: 'Đăng ký và tiếp đón',
    summary: 'Bắt đầu tại quầy tiếp đón.',
    description:
      'Đến quầy tiếp đón để được hướng dẫn đăng ký khám. Chuẩn bị giấy tờ và thông tin theo yêu cầu của bệnh viện, sau đó kiểm tra số thứ tự và khu vực khám được hướng dẫn.',
    icon: 'clipboard-outline' as const,
  },
  {
    title: 'Khám với bác sĩ',
    summary: 'Đến đúng phòng và chờ lượt.',
    description:
      'Tìm phòng khám theo thông tin đăng ký. Theo dõi bảng gọi số hoặc hướng dẫn của nhân viên để biết lượt của mình. Trao đổi tình trạng và nhu cầu khám trực tiếp với bác sĩ.',
    icon: 'medical-outline' as const,
  },
  {
    title: 'Thực hiện chỉ định',
    summary: 'Nếu bác sĩ yêu cầu thêm dịch vụ.',
    description:
      'Nếu có chỉ định xét nghiệm, chẩn đoán hình ảnh hoặc dịch vụ khác, làm theo hướng dẫn của bác sĩ và nhân viên. Hỏi quầy hỗ trợ về địa điểm, thủ tục thanh toán và cách nhận kết quả.',
    icon: 'document-text-outline' as const,
  },
  {
    title: 'Nhận kết quả và hướng dẫn',
    summary: 'Hoàn tất buổi khám theo hướng dẫn.',
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
      .catch(() => {
        // Fallback to static hospital outpatient guidelines smoothly
      })
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
            Xem từng bước để biết bạn cần làm gì tiếp theo.
          </AppText>
        </View>

        {isLiveApi ? (
          <Notice message="Đang kết nối danh mục cẩm nang Bệnh viện từ Local Backend (localhost:8080)." />
        ) : (
          <Notice message="Đây là quy trình minh họa. Các bước thực tế có thể khác; vui lòng xác nhận với nhân viên bệnh viện." />
        )}

        {loading && <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />}

        {/* Live Articles Section if available from Backend */}
        {articles.length > 0 && (
          <View style={{ gap: 8 }}>
            <AppText style={{ fontSize: 13, fontWeight: '700', color: '#0284C7' }}>
              CẨM NANG & THÔNG TIN BỆNH VIỆN TRỰC TUYẾN
            </AppText>
            {articles.slice(0, 2).map((art, idx) => (
              <View key={art.hospitalInformationId || idx} style={styles.articleCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="newspaper-outline" size={16} color={colors.primary} />
                  <AppText style={{ fontSize: 14, fontWeight: '600', color: '#0369A1', flex: 1 }}>
                    {art.title || 'Thông tin bệnh viện'}
                  </AppText>
                </View>
                <AppText style={{ fontSize: 13, color: '#334155', lineHeight: 18 }} numberOfLines={3}>
                  {art.content}
                </AppText>
              </View>
            ))}
            <AppText style={{ fontSize: 13, fontWeight: '700', color: '#0284C7', marginTop: 8 }}>
              CÁC BƯỚC KHÁM BỆNH CHI TIẾT
            </AppText>
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
                  accessibilityHint={
                    isExpanded ? 'Thu gọn hướng dẫn' : 'Xem hướng dẫn chi tiết'
                  }
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
                    <AppText style={styles.titleText}>{step.title}</AppText>
                    <AppText variant="caption" style={styles.description}>
                      {step.summary}
                    </AppText>
                  </View>
                  <Ionicons
                    name={
                      isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'
                    }
                    size={20}
                    color={colors.muted}
                    accessible={false}
                  />
                </Pressable>
                {isExpanded && (
                  <View style={styles.stepDetails}>
                    <View style={styles.detailLabel}>
                      <Ionicons
                        name={step.icon}
                        size={19}
                        color={colors.primary}
                        accessible={false}
                      />
                      <AppText variant="caption" style={styles.detailLabelText}>
                        Hướng dẫn
                      </AppText>
                    </View>
                    <AppText>{step.description}</AppText>
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
            color={colors.primary}
            accessible={false}
          />
          <AppText style={styles.helpText}>
            Nếu chưa rõ bước tiếp theo, hãy hỏi nhân viên tại quầy tiếp đón.
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: { gap: 20 },
  heading: { gap: 6 },
  description: { color: colors.muted },
  articleCard: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  steps: { gap: 12 },
  stepCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  stepHeader: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  stepNumber: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
  },
  numberText: { fontWeight: '700', color: colors.primary },
  stepTitle: { flex: 1, gap: 4 },
  titleText: { fontWeight: '700' },
  pressed: { opacity: 0.7 },
  stepDetails: {
    gap: 10,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailLabelText: { color: colors.primary, fontWeight: '600' },
  helpNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 2,
  },
  helpText: { flex: 1, color: colors.muted },
});
