import { View, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Avatar } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

type Tile = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  bg: string;
  fg: string;
};

export default function Home() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const tiles: Tile[] = [
    { key: "chat", title: "Chat with AI", subtitle: "Ask Aria anything", icon: "chatbubbles", route: "/chat", bg: colors.tileChat, fg: colors.onTileLight },
    { key: "studio", title: "Studio", subtitle: "Record & loop tracks", icon: "mic", route: "/studio", bg: colors.tileStudio, fg: colors.onTileLight },
    { key: "notes", title: "Musical Notes", subtitle: "Hum or find song notes", icon: "musical-notes", route: "/notes", bg: colors.tileNotes, fg: colors.onTileDark },
    { key: "channel", title: "Public Channel", subtitle: "Share with everyone", icon: "people", route: "/channel", bg: colors.tileSocial, fg: colors.onTileDark },
  ];

  const go = (r: string) => {
    Haptics.selectionAsync();
    router.push(r as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SPACING.lg,
          paddingHorizontal: SPACING.lg,
          paddingBottom: insets.bottom + SPACING.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <AppText style={{ color: colors.onSurfaceTertiary, fontSize: 15 }}>Welcome back,</AppText>
            <AppText display weight="bold" style={styles.name} numberOfLines={1}>
              {user?.name || "there"}
            </AppText>
          </View>
          <Pressable testID="settings-button" onPress={() => go("/settings")} hitSlop={10}>
            <Avatar initials={user?.initials || "?"} size={44} />
          </Pressable>
        </View>

        <AppText display weight="semibold" style={[styles.section, { color: colors.onSurface }]}>
          What do you want to create?
        </AppText>

        <View style={styles.grid}>
          {tiles.map((t) => (
            <Pressable
              key={t.key}
              testID={`home-tile-${t.key}`}
              onPress={() => go(t.route)}
              style={({ pressed }) => [styles.tile, { backgroundColor: t.bg, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
                <Ionicons name={t.icon} size={26} color={t.fg} />
              </View>
              <View>
                <AppText display weight="bold" style={[styles.tileTitle, { color: t.fg }]}>
                  {t.title}
                </AppText>
                <AppText style={[styles.tileSub, { color: t.fg, opacity: 0.85 }]}>{t.subtitle}</AppText>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", marginBottom: SPACING.xl },
  name: { fontSize: 26, marginTop: 2 },
  section: { fontSize: 18, marginBottom: SPACING.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: SPACING.md },
  tile: {
    width: "48.5%",
    aspectRatio: 0.92,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    justifyContent: "space-between",
  },
  tileIcon: { width: 48, height: 48, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 19 },
  tileSub: { fontSize: 13, marginTop: 2, fontFamily: FONT.text },
});
