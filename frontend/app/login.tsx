import { useState } from "react";
import { View, StyleSheet, TextInput, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";

const HERO_LIGHT = "https://images.pexels.com/photos/7135053/pexels-photo-7135053.jpeg";
const HERO_DARK = "https://images.pexels.com/photos/6985201/pexels-photo-6985201.jpeg";

type Mode = "login" | "signup" | "verify" | "forgot" | "reset";

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export default function Auth() {
  const { colors, isDark } = useTheme();
  const { login } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = (keepEmail = false) => {
    setPassword("");
    setConfirm("");
    setCode("");
    setShowPw(false);
    if (!keepEmail) setEmail("");
    setFullName("");
  };

  const finish = async (data: any) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await login(data.token, data.user);
    router.replace("/home");
  };

  const doSignup = async () => {
    if (!fullName.trim()) return toast.show("Enter your full name", "error");
    if (!emailOk(email)) return toast.show("Enter a valid email", "error");
    if (password.length < 8) return toast.show("Password must be at least 8 characters", "error");
    if (password !== confirm) return toast.show("Passwords do not match", "error");
    setLoading(true);
    try {
      await api.post("/auth/signup", { full_name: fullName.trim(), email: email.trim().toLowerCase(), password }, false);
      toast.show("Code sent! Check your inbox", "success");
      setMode("verify");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const doVerify = async () => {
    if (code.trim().length !== 6) return toast.show("Enter the 6-digit code", "error");
    setLoading(true);
    try {
      const data = await api.post("/auth/verify-signup", { email: email.trim().toLowerCase(), code: code.trim() }, false);
      await finish(data);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const doLogin = async () => {
    if (!emailOk(email)) return toast.show("Enter a valid email", "error");
    if (!password) return toast.show("Enter your password", "error");
    setLoading(true);
    try {
      const data = await api.post("/auth/login", { email: email.trim().toLowerCase(), password }, false);
      await finish(data);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const doForgot = async () => {
    if (!emailOk(email)) return toast.show("Enter a valid email", "error");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() }, false);
      toast.show("If the account exists, a code was sent", "success");
      setMode("reset");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const doReset = async () => {
    if (code.trim().length !== 6) return toast.show("Enter the 6-digit code", "error");
    if (password.length < 8) return toast.show("Password must be at least 8 characters", "error");
    if (password !== confirm) return toast.show("Passwords do not match", "error");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { email: email.trim().toLowerCase(), code: code.trim(), password }, false);
      toast.show("Password updated! Please log in", "success");
      reset(true);
      setMode("login");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<Mode, { t: string; s: string }> = {
    login: { t: "Welcome back", s: "Log in to your AI + Music Hub account." },
    signup: { t: "Create account", s: "Sign up with your email to get started." },
    verify: { t: "Verify email", s: `Enter the 6-digit code we sent to ${email}` },
    forgot: { t: "Reset password", s: "Enter your email and we'll send a reset code." },
    reset: { t: "Set new password", s: `Enter the code sent to ${email} and your new password.` },
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.heroWrap}>
        <Image source={{ uri: isDark ? HERO_DARK : HERO_LIGHT }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient colors={["transparent", colors.surface]} style={StyleSheet.absoluteFill} locations={[0.3, 1]} />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.badge, { backgroundColor: colors.brand }]}>
          <Ionicons name="musical-notes" size={26} color="#fff" />
        </View>
        <AppText display weight="bold" style={styles.title}>{titles[mode].t}</AppText>
        <AppText style={[styles.subtitle, { color: colors.onSurfaceTertiary }]}>{titles[mode].s}</AppText>

        <View style={styles.form}>
          {mode === "signup" ? (
            <Input testID="signup-name-input" icon="person-outline" value={fullName} onChangeText={setFullName} placeholder="Full name" autoCapitalize="words" />
          ) : null}

          {mode === "verify" ? null : mode === "reset" ? null : (
            <Input
              testID={`${mode}-email-input`}
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          )}

          {mode === "verify" || mode === "reset" ? (
            <Input
              testID={`${mode}-code-input`}
              icon="keypad-outline"
              value={code}
              onChangeText={(t: string) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="6-digit code"
              keyboardType="number-pad"
              codeStyle
            />
          ) : null}

          {mode === "login" || mode === "signup" || mode === "reset" ? (
            <Input
              testID={mode === "reset" ? "reset-password-input" : `${mode}-password-input`}
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder={mode === "login" ? "Password" : "New password (min 8 chars)"}
              secureTextEntry={!showPw}
              rightIcon={showPw ? "eye-off-outline" : "eye-outline"}
              onRightPress={() => setShowPw((s) => !s)}
            />
          ) : null}

          {mode === "signup" || mode === "reset" ? (
            <Input
              testID={`${mode}-confirm-input`}
              icon="lock-closed-outline"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirm password"
              secureTextEntry={!showPw}
            />
          ) : null}

          {mode === "login" ? (
            <Pressable testID="forgot-password-button" onPress={() => { reset(true); setMode("forgot"); }} style={styles.forgotBtn}>
              <AppText style={{ color: colors.brand, fontFamily: FONT.text, fontWeight: "600" }}>Forgot password?</AppText>
            </Pressable>
          ) : null}

          <Button
            testID={`${mode}-submit-button`}
            title={
              mode === "login" ? "Log in"
                : mode === "signup" ? "Create account"
                : mode === "verify" ? "Verify & continue"
                : mode === "forgot" ? "Send reset code"
                : "Reset password"
            }
            loading={loading}
            onPress={
              mode === "login" ? doLogin
                : mode === "signup" ? doSignup
                : mode === "verify" ? doVerify
                : mode === "forgot" ? doForgot
                : doReset
            }
          />

          {mode === "verify" ? (
            <Pressable testID="resend-code-button" onPress={doSignup} style={styles.linkBtn}>
              <AppText style={{ color: colors.brand, fontWeight: "600", fontFamily: FONT.text }}>Resend code</AppText>
            </Pressable>
          ) : null}

          {mode === "forgot" || mode === "reset" || mode === "verify" ? (
            <Pressable testID="back-to-login-button" onPress={() => { reset(); setMode("login"); }} style={styles.linkBtn}>
              <AppText style={{ color: colors.onSurfaceTertiary, fontFamily: FONT.text }}>Back to log in</AppText>
            </Pressable>
          ) : null}
        </View>

        {mode === "login" ? (
          <Pressable testID="go-to-signup-button" onPress={() => { reset(); setMode("signup"); }} style={styles.switchRow}>
            <AppText style={{ color: colors.onSurfaceTertiary }}>New here? </AppText>
            <AppText style={{ color: colors.brand, fontFamily: FONT.text, fontWeight: "700" }}>Sign up</AppText>
          </Pressable>
        ) : mode === "signup" ? (
          <Pressable testID="go-to-login-button" onPress={() => { reset(); setMode("login"); }} style={styles.switchRow}>
            <AppText style={{ color: colors.onSurfaceTertiary }}>Already have an account? </AppText>
            <AppText style={{ color: colors.brand, fontFamily: FONT.text, fontWeight: "700" }}>Log in</AppText>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function Input({ icon, rightIcon, onRightPress, codeStyle, testID, ...props }: any) {
  const { colors } = useTheme();
  return (
    <View style={[styles.inputWrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={colors.onSurfaceTertiary} />
      <TextInput
        testID={testID}
        placeholderTextColor={colors.onSurfaceTertiary}
        autoCorrect={false}
        style={[styles.input, { color: colors.onSurface }, codeStyle && styles.codeInput]}
        {...props}
      />
      {rightIcon ? (
        <Pressable onPress={onRightPress} hitSlop={10}>
          <Ionicons name={rightIcon} size={20} color={colors.onSurfaceTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  content: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: SPACING.xl, paddingTop: 200 },
  badge: { width: 56, height: 56, borderRadius: RADIUS.lg, alignItems: "center", justifyContent: "center", marginBottom: SPACING.lg },
  title: { fontSize: 32, marginBottom: SPACING.sm },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: SPACING.xl },
  form: { gap: SPACING.md },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, height: 56, gap: SPACING.sm },
  input: { flex: 1, fontFamily: FONT.text, fontSize: 16 },
  codeInput: { letterSpacing: 6, fontSize: 20, fontFamily: FONT.display, fontWeight: "700" },
  forgotBtn: { alignSelf: "flex-end", paddingVertical: 2 },
  linkBtn: { alignSelf: "center", paddingVertical: SPACING.sm },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: SPACING.xl },
});
