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
import { AppText, Button, Notice, Screen } from '../../components/ui';
import { robotApiService } from '../../services/api/robotApiService';
import { isDemoMode, robotService } from '../../services/robot';
import { colors } from '../../theme';

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
        'Xin chào! Bạn cần tìm khu vực nào hoặc muốn biết các bước khám ngoại trú?',
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
        // Dự phòng phản hồi khi API trợ lý chưa kết nối riêng
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
        {!keyboardVisible && (
          <View style={styles.heading}>
            <AppText variant="title">Hỏi trợ lý</AppText>
            <AppText style={styles.description}>
              Hỗ trợ tìm đường và tìm hiểu quy trình khám.
            </AppText>
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
                <AppText variant="caption" style={styles.messageAuthor}>
                  {isUser ? 'Bạn' : 'Trợ lý bệnh viện'}
                </AppText>
                <AppText>{message.content}</AppText>
              </View>
            );
          })}

          {pending && (
            <View
              style={styles.pending}
              accessibilityLabel="Trợ lý đang trả lời"
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator size="small" color={colors.primary} />
              <AppText variant="caption">Trợ lý đang trả lời…</AppText>
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
              <AppText variant="caption">Chọn một câu hỏi để bắt đầu</AppText>
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
                    name="add-outline"
                    size={19}
                    color={colors.primary}
                    accessible={false}
                  />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={styles.composer}>
          <AppText variant="caption" style={styles.inputLabel}>
            Nhập câu hỏi
          </AppText>
          <TextInput
            ref={input}
            accessibilityLabel="Nhập câu hỏi cho trợ lý"
            placeholder="Ví dụ: Tôi đăng ký khám ở đâu?"
            placeholderTextColor={colors.muted}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={500}
            editable={!pending}
            style={styles.input}
            textAlignVertical="top"
          />
          <Button
            title={pending ? 'Đang gửi…' : 'Gửi câu hỏi'}
            icon="send-outline"
            onPress={() => void sendMessage(draft)}
            disabled={!draft.trim() || pending}
            loading={pending}
          />
          {!keyboardVisible && (
            <AppText variant="caption" style={styles.voiceNote}>
              Hiện bạn có thể nhập câu hỏi. Trò chuyện bằng giọng nói sẽ có sau.
            </AppText>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: { flex: 1, minHeight: 0 },
  heading: { gap: 6, paddingBottom: 16 },
  description: { color: colors.muted },
  conversation: { flex: 1 },
  conversationContent: { gap: 14, paddingBottom: 20 },
  message: { borderRadius: 16, padding: 14, gap: 6, maxWidth: '94%' },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primarySoft,
  },
  messageAuthor: { color: colors.muted, fontWeight: '600' },
  pending: { flexDirection: 'row', gap: 9, alignItems: 'center', padding: 4 },
  retry: { gap: 10 },
  suggestions: { gap: 9, paddingTop: 2 },
  suggestion: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionText: { flex: 1, color: colors.primary },
  pressed: { opacity: 0.7 },
  composer: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    paddingBottom: 6,
  },
  inputLabel: { color: colors.text, fontWeight: '600' },
  input: {
    minHeight: 58,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
  },
  voiceNote: { color: colors.muted },
});
