import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  Text,
  TextProps,
  Pressable,
  PressableProps,
  View,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";

/* ----------------------------- Text ----------------------------- */
export function AppText(
  props: TextProps & { weight?: "regular" | "medium" | "semibold" | "bold"; display?: boolean }
) {
  const { colors } = useTheme();
  const { style, weight = "regular", display, ...rest } = props;
  const fw = { regular: "400", medium: "500", semibold: "600", bold: "700" }[weight] as any;
  return (
    <Text
      {...rest}
      style={[
        { color: colors.onSurface, fontFamily: display ? FONT.display : FONT.text, fontWeight: fw },
        style,
      ]}
    />
  );
}

/* ----------------------------- Button ----------------------------- */
export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
  style?: any;
}) {
  const { colors } = useTheme();
  const bg =
    variant === "primary" ? colors.brand : variant === "danger" ? colors.error : colors.surfaceTertiary;
  const fg =
    variant === "secondary" ? colors.onSurface : variant === "danger" ? colors.onError : colors.onBrand;
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      disabled={off}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={{ color: fg, fontFamily: FONT.display, fontWeight: "600", fontSize: 16 }}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/* ----------------------------- Avatar ----------------------------- */
export function Avatar({ initials, size = 40, color }: { initials: string; size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color || colors.brand,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontFamily: FONT.display, fontWeight: "700", fontSize: size * 0.4 }}>
        {(initials || "?").toUpperCase()}
      </Text>
    </View>
  );
}

/* ----------------------------- Header ----------------------------- */
export function Header({
  title,
  onBack,
  right,
  color,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  color?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tint = color || colors.onSurface;
  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + SPACING.sm, backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable testID="header-back-button" onPress={onBack} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={26} color={tint} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
        <Text style={[styles.headerTitle, { color: tint }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerBtn}>{right}</View>
      </View>
    </View>
  );
}

/* ----------------------------- Toast ----------------------------- */
type ToastType = "info" | "success" | "error";
const ToastCtx = createContext<{ show: (msg: string, type?: ToastType) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [msg, setMsg] = useState("");
  const [type, setType] = useState<ToastType>("info");
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<any>(null);

  const show = useCallback(
    (m: string, t: ToastType = "info") => {
      setMsg(m);
      setType(t);
      if (t === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      }, 2600);
    },
    [opacity]
  );

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toast,
          { top: insets.top + 8, opacity, backgroundColor: type === "error" ? colors.error : type === "success" ? colors.success : "#2b2b2b" },
        ]}
      >
        <Text testID="toast-message" style={styles.toastText}>
          {msg}
        </Text>
      </Animated.View>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}

const styles = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
  },
  btnRow: { flexDirection: "row", alignItems: "center" },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: SPACING.sm, paddingHorizontal: SPACING.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  headerBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontFamily: FONT.display, fontWeight: "700", fontSize: 18 },
  toast: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "90%",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: RADIUS.pill,
    zIndex: 9999,
  },
  toastText: { color: "#fff", fontFamily: FONT.text, fontWeight: "600", fontSize: 14, textAlign: "center" },
});
