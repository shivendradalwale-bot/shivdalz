import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Avatar, Header, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { api } from "@/src/api/client";

type Comment = {
  id: string;
  text: string;
  author: { name: string; initials: string };
  created_at: string;
};

export default function PostComments() {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get(`/posts/${id}/comments`);
        setComments(data.comments);
      } catch (e: any) {
        toast.show(e.message || "Failed to load comments", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const data = await api.post(`/posts/${id}/comments`, { text: t });
      setComments((c) => [...c, data.comment]);
      setText("");
    } catch (e: any) {
      toast.show(e.message || "Could not comment", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Comments" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: SPACING.lg, flexGrow: 1 }}
            renderItem={({ item }) => (
              <View style={styles.comment}>
                <Avatar initials={item.author.initials} size={36} />
                <View style={[styles.bubble, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <AppText weight="semibold" style={{ fontSize: 14 }}>{item.author.name}</AppText>
                  <AppText style={{ fontSize: 14, lineHeight: 20, marginTop: 2 }}>{item.text}</AppText>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={40} color={colors.onSurfaceTertiary} />
                <AppText style={{ color: colors.onSurfaceTertiary, marginTop: SPACING.md }}>No comments yet. Start the conversation!</AppText>
              </View>
            }
          />
        )}
        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom || SPACING.md }]}>
          <View style={[styles.inputWrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <TextInput
              testID="comment-input"
              value={text}
              onChangeText={setText}
              placeholder="Add a comment…"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={{ flex: 1, fontFamily: FONT.text, fontSize: 15, color: colors.onSurface, paddingVertical: Platform.OS === "ios" ? 12 : 8 }}
              multiline
            />
          </View>
          <Pressable
            testID="comment-send"
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  comment: { flexDirection: "row", marginBottom: SPACING.md, gap: SPACING.sm },
  bubble: { flex: 1, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, padding: SPACING.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 100 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: SPACING.sm },
  inputWrap: { flex: 1, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: SPACING.lg, minHeight: 48, maxHeight: 120, justifyContent: "center" },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
