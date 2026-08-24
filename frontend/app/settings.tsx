import { useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, Switch, Modal, TextInput, Platform, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Avatar, Button, Header, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { api } from "@/src/api/client";

export default function Settings() {
  const { colors, isDark, toggle } = useTheme();
  const { user, logout, setUser } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = await api.put("/auth/profile", { name: name.trim() });
      setUser(data.user);
      setNameOpen(false);
      toast.show("Name updated", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Settings" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: insets.bottom + SPACING.xl }}>
        {/* Profile */}
        <View style={[styles.profile, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Avatar initials={user?.initials || "?"} size={64} />
          <AppText display weight="bold" style={{ fontSize: 20, marginTop: SPACING.md }}>{user?.name}</AppText>
          <AppText style={{ color: colors.onSurfaceTertiary, marginTop: 2 }}>{user?.email}</AppText>
          <Pressable testID="edit-name-button" onPress={() => { setName(user?.name || ""); setNameOpen(true); }} style={[styles.editBtn, { borderColor: colors.border }]}>
            <Ionicons name="pencil" size={14} color={colors.brand} />
            <AppText style={{ color: colors.brand, marginLeft: 6, fontFamily: FONT.text, fontWeight: "600" }}>Edit name</AppText>
          </Pressable>
        </View>

        {/* Preferences */}
        <AppText weight="semibold" style={[styles.groupTitle, { color: colors.onSurfaceTertiary }]}>PREFERENCES</AppText>
        <View style={[styles.group, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.rowIcon, { backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name={isDark ? "moon" : "sunny"} size={18} color={colors.onSurface} />
              </View>
              <AppText style={{ fontSize: 15 }}>Dark mode</AppText>
            </View>
            <Switch
              testID="theme-toggle"
              value={isDark}
              onValueChange={() => {
                Haptics.selectionAsync();
                toggle();
              }}
              trackColor={{ true: colors.brand, false: colors.borderStrong }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Account */}
        <AppText weight="semibold" style={[styles.groupTitle, { color: colors.onSurfaceTertiary }]}>ACCOUNT</AppText>
        <View style={[styles.group, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Pressable testID="logout-button" onPress={doLogout} style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.rowIcon, { backgroundColor: "rgba(201,42,66,0.12)" }]}>
                <Ionicons name="log-out-outline" size={18} color={colors.error} />
              </View>
              <AppText style={{ fontSize: 15, color: colors.error }}>Log out</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>

        <AppText style={{ color: colors.onSurfaceTertiary, textAlign: "center", marginTop: SPACING.xl, fontSize: 12 }}>
          AI + Music Hub · v1.0
        </AppText>
      </ScrollView>

      <Modal visible={nameOpen} transparent animationType="fade" onRequestClose={() => setNameOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surfaceSecondary }]}>
            <AppText display weight="bold" style={{ fontSize: 18, marginBottom: SPACING.md }}>Edit name</AppText>
            <TextInput
              testID="name-input"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoFocus
              style={[styles.input, { color: colors.onSurface, backgroundColor: colors.surface, borderColor: colors.border }]}
            />
            <Button testID="save-name-button" title="Save" onPress={saveName} loading={saving} style={{ marginTop: SPACING.lg }} />
            <Pressable onPress={() => setNameOpen(false)} style={{ paddingVertical: SPACING.md, alignItems: "center" }}>
              <AppText style={{ color: colors.onSurfaceTertiary }}>Cancel</AppText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { borderRadius: RADIUS.xl, borderWidth: StyleSheet.hairlineWidth, padding: SPACING.xl, alignItems: "center" },
  editBtn: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, marginTop: SPACING.md },
  groupTitle: { fontSize: 12, letterSpacing: 0.5, marginTop: SPACING.xl, marginBottom: SPACING.sm, marginLeft: SPACING.sm },
  group: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.lg },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  rowIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  modalCard: { width: "100%", borderRadius: RADIUS.xl, padding: SPACING.xl },
  input: { height: 54, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: SPACING.lg, fontFamily: FONT.text, fontSize: 16 },
});
