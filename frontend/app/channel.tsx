import { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Avatar, Button, Header, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { api } from "@/src/api/client";

type Post = {
  id: string;
  text: string;
  author: { id: string; name: string; initials: string };
  likes: number;
  liked_by_me: boolean;
  comment_count: number;
  created_at: string;
};

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const AVATAR_COLORS = ["#2D6A4F", "#D4A373", "#8F9E8B", "#C92A42", "#40916C"];
const colorFor = (id: string) => AVATAR_COLORS[id.charCodeAt(id.length - 1) % AVATAR_COLORS.length];

export default function Channel() {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/posts");
      setPosts(data.posts);
    } catch (e: any) {
      toast.show(e.message || "Failed to load feed", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const toggleLike = async (post: Post) => {
    Haptics.selectionAsync();
    setPosts((ps) =>
      ps.map((p) =>
        p.id === post.id
          ? { ...p, liked_by_me: !p.liked_by_me, likes: p.likes + (p.liked_by_me ? -1 : 1) }
          : p
      )
    );
    try {
      await api.post(`/posts/${post.id}/like`);
    } catch {
      load();
    }
  };

  const submitPost = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const data = await api.post("/posts", { text: draft.trim() });
      setPosts((p) => [data.post, ...p]);
      setDraft("");
      setComposeOpen(false);
      toast.show("Posted!", "success");
    } catch (e: any) {
      toast.show(e.message || "Could not post", "error");
    } finally {
      setPosting(false);
    }
  };

  const renderItem = ({ item }: { item: Post }) => (
    <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <Avatar initials={item.author.initials} size={40} color={colorFor(item.author.id)} />
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <AppText weight="semibold" style={{ fontSize: 15 }}>{item.author.name}</AppText>
          <AppText style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>{timeAgo(item.created_at)}</AppText>
        </View>
      </View>
      <AppText style={{ fontSize: 15, lineHeight: 22, marginTop: SPACING.sm }}>{item.text}</AppText>
      <View style={styles.actions}>
        <Pressable testID={`post-like-${item.id}`} onPress={() => toggleLike(item)} style={styles.actionBtn} hitSlop={8}>
          <Ionicons
            name={item.liked_by_me ? "heart" : "heart-outline"}
            size={20}
            color={item.liked_by_me ? colors.error : colors.onSurfaceTertiary}
          />
          <AppText style={{ color: colors.onSurfaceTertiary, marginLeft: 6, fontSize: 13 }}>{item.likes}</AppText>
        </Pressable>
        <Pressable
          testID={`post-comment-${item.id}`}
          onPress={() => router.push(`/post/${item.id}`)}
          style={styles.actionBtn}
          hitSlop={8}
        >
          <Ionicons name="chatbubble-outline" size={19} color={colors.onSurfaceTertiary} />
          <AppText style={{ color: colors.onSurfaceTertiary, marginLeft: 6, fontSize: 13 }}>{item.comment_count}</AppText>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Public Channel" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: insets.bottom + 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="people" size={30} color={colors.tileSocial} />
              </View>
              <AppText display weight="semibold" style={{ fontSize: 18, marginTop: SPACING.md }}>No posts yet</AppText>
              <AppText style={{ color: colors.onSurfaceTertiary, marginTop: 6 }}>Be the first to share something!</AppText>
            </View>
          }
        />
      )}

      <Pressable
        testID="channel-compose-fab"
        onPress={() => {
          Haptics.selectionAsync();
          setComposeOpen(true);
        }}
        style={[styles.fab, { backgroundColor: colors.brand, bottom: insets.bottom + SPACING.lg }]}
      >
        <Ionicons name="create" size={26} color={colors.onBrand} />
      </Pressable>

      <Modal visible={composeOpen} transparent animationType="slide" onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalRoot}>
          <Pressable style={{ flex: 1 }} onPress={() => setComposeOpen(false)} />
          <View style={[styles.composeCard, { backgroundColor: colors.surfaceSecondary, paddingBottom: insets.bottom + SPACING.lg }]}>
            <View style={styles.composeHead}>
              <AppText display weight="bold" style={{ fontSize: 18 }}>New post</AppText>
              <Pressable testID="compose-close" onPress={() => setComposeOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
            <TextInput
              testID="compose-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="Share your thoughts, tracks or ideas…"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              autoFocus
              style={[styles.composeInput, { color: colors.onSurface, backgroundColor: colors.surface }]}
            />
            <Button testID="compose-submit" title="Post to channel" onPress={submitPost} loading={posting} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACING.lg, marginBottom: SPACING.md },
  cardHead: { flexDirection: "row", alignItems: "center" },
  actions: { flexDirection: "row", gap: SPACING.xl, marginTop: SPACING.md },
  actionBtn: { flexDirection: "row", alignItems: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  fab: { position: "absolute", right: SPACING.lg, width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  composeCard: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg },
  composeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.md },
  composeInput: { minHeight: 120, borderRadius: RADIUS.md, padding: SPACING.lg, fontFamily: FONT.text, fontSize: 16, textAlignVertical: "top", marginBottom: SPACING.lg },
});
