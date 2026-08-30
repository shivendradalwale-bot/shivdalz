import { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Header, RichText, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { api } from "@/src/api/client";

type Msg = { id: string; role: "user" | "assistant"; text: string };

export default function Chat() {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Msg>>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get("/chat/history");
        setMessages(data.messages);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    const temp: Msg = { id: `u-${Date.now()}`, role: "user", text: t };
    setMessages((m) => [...m, temp]);
    setSending(true);
    scrollEnd();
    try {
      const data = await api.post("/chat/message", { text: t });
      setMessages((m) => [...m, { id: data.id, role: "assistant", text: data.text }]);
      scrollEnd();
    } catch (e: any) {
      toast.show(e.message || "Aria is unavailable", "error");
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    try {
      await api.del("/chat/history");
      setMessages([]);
      toast.show("Conversation cleared", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const renderItem = ({ item }: { item: Msg }) => {
    const mine = item.role === "user";
    return (
      <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
        <View
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: colors.brand, borderBottomRightRadius: 4 }
              : { backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
          ]}
        >
          {mine ? (
            <AppText style={{ color: colors.onBrand, fontSize: 15, lineHeight: 21 }}>{item.text}</AppText>
          ) : (
            <RichText text={item.text} color={colors.onSurface} size={15} />
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header
        title="Aria"
        onBack={() => router.back()}
        right={
          messages.length > 0 ? (
            <Pressable testID="chat-clear-button" onPress={clear} hitSlop={10}>
              <Ionicons name="trash-outline" size={22} color={colors.onSurfaceTertiary} />
            </Pressable>
          ) : null
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.md, flexGrow: 1 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
                  <Ionicons name="sparkles" size={30} color={colors.brand} />
                </View>
                <AppText display weight="semibold" style={{ fontSize: 18, marginTop: SPACING.md }}>
                  Hi, I'm Aria
                </AppText>
                <AppText style={{ color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 6 }}>
                  How can I help you create today?
                </AppText>
              </View>
            }
            onContentSizeChange={scrollEnd}
          />
        )}

        {sending ? (
          <View style={styles.typing}>
            <ActivityIndicator size="small" color={colors.onSurfaceTertiary} />
            <AppText style={{ color: colors.onSurfaceTertiary, marginLeft: 8, fontSize: 13 }}>
              Aria is typing…
            </AppText>
          </View>
        ) : null}

        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom || SPACING.md }]}>
          <View style={[styles.inputWrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <TextInput
              testID="chat-input"
              value={text}
              onChangeText={setText}
              placeholder="Message Aria…"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={[styles.input, { color: colors.onSurface }]}
              multiline
            />
          </View>
          <Pressable
            testID="chat-send-button"
            onPress={send}
            disabled={sending || !text.trim()}
            style={[styles.sendBtn, { backgroundColor: colors.brand, opacity: sending || !text.trim() ? 0.5 : 1 }]}
          >
            <Ionicons name="arrow-up" size={22} color={colors.onBrand} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bubbleRow: { flexDirection: "row", marginBottom: SPACING.md },
  bubble: { maxWidth: "82%", paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.lg },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  typing: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm,
  },
  inputWrap: { flex: 1, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: SPACING.lg, maxHeight: 120, minHeight: 48, justifyContent: "center" },
  input: { fontFamily: FONT.text, fontSize: 15, paddingVertical: Platform.OS === "ios" ? 12 : 8 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
