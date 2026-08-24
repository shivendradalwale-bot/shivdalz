import { useRef, useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";

const HERO_LIGHT = "https://images.pexels.com/photos/7135053/pexels-photo-7135053.jpeg";
const HERO_DARK = "https://images.pexels.com/photos/6985201/pexels-photo-6985201.jpeg";

export default function Login() {
  const { colors, isDark } = useTheme();
  const { login } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const codeRef = useRef<TextInput>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendOtp = async () => {
    if (!emailValid) {
      toast.show("Enter a valid email address", "error");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/request-otp", { email: email.trim().toLowerCase() }, false);
      setStep("otp");
      toast.show("Code sent! Check your inbox", "success");
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (e: any) {
      toast.show(e.message || "Could not send code", "error");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (code.trim().length !== 6) {
      toast.show("Enter the 6-digit code", "error");
      return;
    }
    setLoading(true);
    try {
      const data = await api.post(
        "/auth/verify-otp",
        { email: email.trim().toLowerCase(), code: code.trim() },
        false
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await login(data.token, data.user);
      router.replace("/home");
    } catch (e: any) {
      toast.show(e.message || "Invalid code", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.heroWrap}>
        <Image source={{ uri: isDark ? HERO_DARK : HERO_LIGHT }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["transparent", colors.surface]}
          style={StyleSheet.absoluteFill}
          locations={[0.3, 1]}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.badge, { backgroundColor: colors.brand }]}>
            <Ionicons name="musical-notes" size={26} color="#fff" />
          </View>
          <AppText display weight="bold" style={styles.title}>
            AI + Music Hub
          </AppText>
          <AppText style={[styles.subtitle, { color: colors.onSurfaceTertiary }]}>
            {step === "email"
              ? "Sign in with your email. We'll send you a one-time code."
              : `Enter the 6-digit code we sent to ${email}`}
          </AppText>

          {step === "email" ? (
            <View style={styles.form}>
              <View style={[styles.inputWrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Ionicons name="mail-outline" size={20} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="login-email-input"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@email.com"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  returnKeyType="go"
                  onSubmitEditing={sendOtp}
                  style={[styles.input, { color: colors.onSurface }]}
                />
              </View>
              <Button testID="login-send-code-button" title="Send code" onPress={sendOtp} loading={loading} />
            </View>
          ) : (
            <View style={styles.form}>
              <View style={[styles.inputWrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Ionicons name="keypad-outline" size={20} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="login-otp-input"
                  ref={codeRef}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  keyboardType="number-pad"
                  returnKeyType="go"
                  onSubmitEditing={verifyOtp}
                  style={[styles.input, styles.otpInput, { color: colors.onSurface }]}
                />
              </View>
              <Button testID="login-verify-button" title="Verify & continue" onPress={verifyOtp} loading={loading} />
              <Pressable
                testID="login-change-email-button"
                onPress={() => {
                  setStep("email");
                  setCode("");
                }}
                style={styles.linkBtn}
              >
                <AppText style={{ color: colors.brand, fontFamily: FONT.text, fontWeight: "600" }}>
                  Use a different email
                </AppText>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heroWrap: { position: "absolute", top: 0, left: 0, right: 0, height: 320 },
  content: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: SPACING.xl, paddingTop: 260 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.lg,
  },
  title: { fontSize: 34, marginBottom: SPACING.sm },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: SPACING.xl },
  form: { gap: SPACING.md },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    height: 56,
    gap: SPACING.sm,
  },
  input: { flex: 1, fontFamily: FONT.text, fontSize: 16 },
  otpInput: { letterSpacing: 8, fontSize: 22, fontFamily: FONT.display, fontWeight: "700" },
  linkBtn: { alignSelf: "center", paddingVertical: SPACING.sm },
});
