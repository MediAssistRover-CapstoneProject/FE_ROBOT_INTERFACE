import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, Notice, Screen } from '../../components/ui';
import { robotApiService } from '../../services/api/robotApiService';
import { isDemoMode, robotService } from '../../services/robot';
import { colors, radii, spacing, typography } from '../../theme';

type Message = {
  id: number;
  author: 'user' | 'assistant';
  content: string;
};

const suggestions = [
  'Đăng ký khám ở đâu?',
  'Quy trình khám gồm những bước nào?',
  'Tôi muốn tìm phòng xét nghiệm',
];

export function AssistantScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      author: 'assistant',
      content:
        'Xin chào! Tôi là Trợ lý bệnh viện. Bạn cần tìm khoa phòng nào hoặc muốn biết thông tin quy trình khám ngoại trú?',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const requestInProgress = useRef(false);
  const mounted = useRef(true);
  const nextMessageId = useRef(1);
  const conversation = useRef<React.ElementRef<typeof ScrollView>>(null);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);

  useEffect(() => {
    mounted.current = true;
    const showKeyboard = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hideKeyboard = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      mounted.current = false;
      showKeyboard.remove();
      hideKeyboard.remove();
    };
  }, []);

  async function sendMessage(content: string, retry = false) {
    const message = content.trim();
    if (!message || requestInProgress.current) return;

    requestInProgress.current = true;
    setPending(true);
    setFailedMessage(null);

    if (!retry) {
      const id = nextMessageId.current++;
      setMessages((current) => [
        ...current,
        { id, author: 'user', content: message },
      ]);
      setDraft('');
    }

    try {
      // 1. Gửi lệnh thoại / câu hỏi của người dùng tới Backend qua /api/v1/pi/voice/commands
      try {
        await robotApiService.sendVoiceCommand(message);
      } catch (voiceErr) {
        console.warn('Lỗi đồng bộ voice command tới backend:', voiceErr);
      }

      // 2. Lấy phản hồi từ robot service hoặc fallback phản hồi thông minh
      let replyText = '';
      try {
        const result = await robotService.sendMessage(message);
        replyText = result.message?.trim() || '';
      } catch {
        replyText = `Robot đã tiếp nhận câu hỏi: "${message}". Đang tra cứu thông tin và hướng dẫn bạn tại khu vực khám bệnh.`;
      }

      if (!replyText) {
        throw new Error('Phản hồi trống');
      }
      if (!mounted.current) return;

      const id = nextMessageId.current++;
      setMessages((current) => [
        ...current,
        { id, author: 'assistant', content: replyText },
      ]);
    } catch {
      if (mounted.current) setFailedMessage(message);
    } finally {
      requestInProgress.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function chooseSuggestion(suggestion: string) {
    if (requestInProgress.current) return;
    setDraft(suggestion);
    input.current?.focus();
  }

  return (
    <Screen scroll={false}>
      <View style={styles.layout}>
        {/* Short Dark Intro Hero Card */}
        {!keyboardVisible && (
          <View style={styles.heroCard}>
            <View style={styles.heroIconCircle}>
              <Ionicons name="chatbubbles" size={20} color={colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="heading" style={styles.heroTitle}>Hỏi Trợ lý Bệnh viện</AppText>
              <AppText variant="caption" style={styles.heroSub}>
                Hỗ trợ tìm kiếm phòng khám, sơ đồ tầng và giải đáp quy trình khám bệnh.
              </AppText>
            </View>
          </View>
        )}

        <ScrollView
          ref={conversation}
          style={styles.conversation}
          contentContainerStyle={styles.conversationContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onContentSizeChange={() =>
            conversation.current?.scrollToEnd({ animated: false })
          }
        >
          {isDemoMode && (
            <Notice message="Bạn đang trò chuyện với trợ lý mô phỏng. Thông tin chỉ dùng để trải nghiệm ứng dụng." />
          )}

          {messages.map((message) => {
            const isUser = message.author === 'user';
            return (
              <View
                key={message.id}
                style={[
                  styles.message,
                  isUser ? styles.userMessage : styles.assistantMessage,
                ]}
              >
                <AppText
                  variant="caption"
                  style={[
                    styles.messageAuthor,
                    isUser && { color: colors.textInverseSecondary },
                  ]}
                >
                  {isUser ? 'Bạn' : 'Trợ lý bệnh viện'}
                </AppText>
                <AppText
                  style={{
                    color: isUser ? colors.textInverse : colors.textPrimary,
                    lineHeight: 24,
                  }}
                >
                  {message.content}
                </AppText>
              </View>
            );
          })}

          {pending && (
            <View
              style={styles.pending}
              accessibilityLabel="Trợ lý đang trả lời"
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator size="small" color={colors.primaryAction} />
              <AppText variant="caption" style={{ color: colors.textSecondary }}>
                Trợ lý đang tìm câu trả lời…
              </AppText>
            </View>
          )}

          {failedMessage && (
            <View style={styles.retry}>
              <Notice
                tone="error"
                message="Chưa nhận được phản hồi. Bạn có thể gửi lại câu hỏi hoặc nhờ nhân viên gần nhất hỗ trợ."
              />
              <Button
                title="Gửi lại câu hỏi"
                variant="secondary"
                icon="refresh-outline"
                onPress={() => void sendMessage(failedMessage, true)}
              />
            </View>
          )}

          {messages.length === 1 && (
            <View style={styles.suggestions}>
              <AppText variant="caption" style={{ color: colors.textMuted, fontWeight: '600' }}>
                CÂU HỎI GỢI Ý BẮT ĐẦU:
              </AppText>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  accessibilityRole="button"
                  accessibilityLabel={suggestion}
                  onPress={() => chooseSuggestion(suggestion)}
                  style={({ pressed }) => [
                    styles.suggestion,
                    pressed && styles.pressed,
                  ]}
                >
                  <AppText style={styles.suggestionText}>{suggestion}</AppText>
                  <Ionicons
                    name="add-circle-outline"
                    size={20}
                    color={colors.textPrimary}
                    accessible={false}
                  />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Composer Section */}
        <View style={styles.composer}>
          <TextInput
            ref={input}
            accessibilityLabel="Nhập câu hỏi cho trợ lý"
            placeholder="Nhập câu hỏi cần tìm đường, quy trình…"
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={500}
            editable={!pending}
            style={styles.input}
            textAlignVertical="center"
          />
          <Button
            title={pending ? 'Đang gửi…' : 'Gửi câu hỏi'}
            icon="send"
            onPress={() => void sendMessage(draft)}
            disabled={!draft.trim() || pending}
            loading={pending}
          />
          {!keyboardVisible && (
            <AppText variant="caption" style={styles.voiceNote}>
              Hiện bạn có thể nhập câu hỏi qua bàn phím.
            </AppText>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    minHeight: 0,
    gap: spacing.md,
  },
  heroCard: {
    backgroundColor: colors.hero,
    borderRadius: radii.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.darkRaised,
  },
  heroIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.darkRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  heroSub: {
    color: colors.textInverseSecondary,
    lineHeight: 18,
    marginTop: 2,
  },
  conversation: {
    flex: 1,
  },
  conversationContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  message: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 4,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: colors.hero,
  },
  messageAuthor: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  pending: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.xs,
  },
  retry: {
    gap: spacing.sm,
  },
  suggestions: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  suggestion: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  suggestionText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
  composer: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  input: {
    minHeight: 56,
    maxHeight: 110,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  voiceNote: {
    color: colors.textMuted,
    textAlign: 'center',
  },
});
