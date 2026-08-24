import { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Modal,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation } from "react-native-reanimated";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";

import { AppText, Button, Header, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";
import { api } from "@/src/api/client";

const INSTRUMENTS = ["Piano", "Guitar", "Ukulele", "Violin", "Flute", "Keyboard", "Bass"];

export default function Notes() {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<"record" | "song">("record");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Musical Notes" onBack={() => router.back()} />

      <View style={[styles.segment, { backgroundColor: colors.surfaceTertiary }]}>
        {(["record", "song"] as const).map((t) => (
          <Pressable
            key={t}
            testID={`notes-tab-${t}`}
            onPress={() => {
              Haptics.selectionAsync();
              setTab(t);
            }}
            style={[styles.segmentBtn, tab === t && { backgroundColor: colors.surfaceSecondary }]}
          >
            <AppText
              weight="semibold"
              style={{ color: tab === t ? colors.onSurface : colors.onSurfaceTertiary, fontSize: 14 }}
            >
              {t === "record" ? "Hum a melody" : "Find song notes"}
            </AppText>
          </Pressable>
        ))}
      </View>

      {tab === "record" ? (
        <RecordMelody colors={colors} toast={toast} insets={insets} />
      ) : (
        <SongLookup colors={colors} toast={toast} insets={insets} />
      )}
    </View>
  );
}

/* --------------------------- Record melody --------------------------- */
function RecordMelody({ colors, toast, insets }: any) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  const [permModal, setPermModal] = useState<null | "ask" | "blocked">(null);

  const scale = useSharedValue(1);
  const ring = useSharedValue(0);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring.value * 0.6 }],
    opacity: 1 - ring.value,
  }));
  const btnStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    return () => cancelAnimation(ring);
  }, []);

  const ensurePermission = async () => {
    const cur = await AudioModule.getRecordingPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain) {
      setPermModal("ask");
      return false;
    }
    setPermModal("blocked");
    return false;
  };

  const requestNow = async () => {
    const res = await AudioModule.requestRecordingPermissionsAsync();
    setPermModal(null);
    if (res.granted) start();
    else if (!res.canAskAgain) setPermModal("blocked");
  };

  const start = async () => {
    const ok = await ensurePermission();
    if (!ok) return;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setNotes(null);
      setRecording(true);
      scale.value = withTiming(1.08, { duration: 200 });
      ring.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false);
    } catch {
      toast.show("Couldn't start recording", "error");
    }
  };

  const stop = async () => {
    setRecording(false);
    cancelAnimation(ring);
    ring.value = 0;
    scale.value = withTiming(1, { duration: 200 });
    try {
      await recorder.stop();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const uri = recorder.uri;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (!uri) {
        toast.show("Nothing recorded", "error");
        return;
      }
      setAnalyzing(true);
      const form = new FormData();
      form.append("file", { uri, name: "melody.m4a", type: "audio/m4a" } as any);
      const data = await api.postForm("/notes/detect", form);
      setNotes(data.notes);
      setMessage(data.message);
    } catch (e: any) {
      toast.show(e.message || "Could not analyze audio", "error");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: insets.bottom + SPACING.xl, alignItems: "center" }}>
      <AppText style={{ color: colors.onSurfaceTertiary, textAlign: "center", marginBottom: SPACING.xl, fontSize: 14 }}>
        Hum or sing one steady note at a time. We'll turn it into note names.
      </AppText>

      <View style={styles.micArea}>
        {recording ? (
          <Animated.View style={[styles.ring, { borderColor: colors.brand }, ringStyle]} />
        ) : null}
        <Animated.View style={btnStyle}>
          <Pressable
            testID="notes-record-button"
            onPress={recording ? stop : start}
            disabled={analyzing}
            style={[styles.mic, { backgroundColor: recording ? colors.error : colors.brand }]}
          >
            <Ionicons name={recording ? "stop" : "mic"} size={44} color="#fff" />
          </Pressable>
        </Animated.View>
      </View>

      <AppText weight="semibold" style={{ marginTop: SPACING.xl }}>
        {analyzing ? "Analyzing…" : recording ? "Listening… tap to stop" : "Tap to start humming"}
      </AppText>

      {analyzing ? <ActivityIndicator color={colors.brand} style={{ marginTop: SPACING.lg }} /> : null}

      {notes ? (
        <View style={[styles.resultCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <AppText style={{ color: colors.onSurfaceTertiary, marginBottom: SPACING.md }}>{message}</AppText>
          {notes.length > 0 ? (
            <View style={styles.noteChips}>
              {notes.map((n, i) => (
                <View key={i} style={[styles.noteChip, { backgroundColor: colors.brand }]}>
                  <AppText style={{ color: colors.onBrand, fontFamily: FONT.display, fontWeight: "700" }}>{n}</AppText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <PermModal permModal={permModal} setPermModal={setPermModal} requestNow={requestNow} colors={colors} />
    </ScrollView>
  );
}

/* --------------------------- Song lookup --------------------------- */
function SongLookup({ colors, toast, insets }: any) {
  const [song, setSong] = useState("");
  const [instrument, setInstrument] = useState("Piano");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const generate = async () => {
    if (!song.trim()) {
      toast.show("Enter a song name", "error");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await api.post("/notes/from-song", { song: song.trim(), instrument });
      setResult(data.result);
    } catch (e: any) {
      toast.show(e.message || "Could not find notes", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      bottomOffset={20}
      contentContainerStyle={{ padding: SPACING.lg, paddingBottom: insets.bottom + SPACING.xl }}
      showsVerticalScrollIndicator={false}
    >
      <AppText weight="semibold" style={{ marginBottom: SPACING.sm }}>Song name</AppText>
      <View style={[styles.inputWrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="notes-song-input"
          value={song}
          onChangeText={setSong}
          placeholder="e.g. Happy Birthday"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={{ flex: 1, fontFamily: FONT.text, fontSize: 16, color: colors.onSurface }}
          returnKeyType="done"
        />
      </View>

      <AppText weight="semibold" style={{ marginTop: SPACING.lg, marginBottom: SPACING.sm }}>Instrument</AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: SPACING.sm, paddingRight: SPACING.lg }}
        style={{ marginHorizontal: -SPACING.lg, paddingHorizontal: SPACING.lg }}
      >
        {INSTRUMENTS.map((ins) => {
          const active = ins === instrument;
          return (
            <Pressable
              key={ins}
              testID={`notes-instrument-${ins}`}
              onPress={() => {
                Haptics.selectionAsync();
                setInstrument(ins);
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.brand : colors.surfaceSecondary,
                  borderColor: active ? colors.brand : colors.border,
                },
              ]}
            >
              <AppText style={{ color: active ? colors.onBrand : colors.onSurface, fontWeight: "600", fontFamily: FONT.text }}>
                {ins}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <Button testID="notes-generate-button" title="Get notes & chords" onPress={generate} loading={loading} style={{ marginTop: SPACING.xl }} />

      {result ? (
        <View style={[styles.resultCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, marginTop: SPACING.xl }]}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: SPACING.md, gap: 8 }}>
            <Ionicons name="musical-notes" size={18} color={colors.brand} />
            <AppText display weight="bold" style={{ fontSize: 16 }}>{song} · {instrument}</AppText>
          </View>
          <AppText style={{ color: colors.onSurface, fontSize: 14, lineHeight: 22 }}>{result}</AppText>
        </View>
      ) : null}
    </KeyboardAwareScrollView>
  );
}

function PermModal({ permModal, setPermModal, requestNow, colors }: any) {
  return (
    <Modal visible={permModal !== null} transparent animationType="fade" onRequestClose={() => setPermModal(null)}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[styles.modalIcon, { backgroundColor: colors.brand }]}>
            <Ionicons name="mic" size={26} color={colors.onBrand} />
          </View>
          <AppText display weight="bold" style={{ fontSize: 18, marginTop: SPACING.md }}>Microphone access</AppText>
          <AppText style={{ color: colors.onSurfaceTertiary, textAlign: "center", marginVertical: SPACING.sm }}>
            {permModal === "blocked"
              ? "Enable microphone in Settings to detect your melody."
              : "We use your microphone to detect the notes you hum."}
          </AppText>
          {permModal === "blocked" ? (
            <Button testID="notes-perm-settings" title="Open Settings" onPress={() => { setPermModal(null); Linking.openSettings(); }} style={{ alignSelf: "stretch" }} />
          ) : (
            <Button testID="notes-perm-allow" title="Allow microphone" onPress={requestNow} style={{ alignSelf: "stretch" }} />
          )}
          <Pressable onPress={() => setPermModal(null)} style={{ paddingVertical: SPACING.sm, marginTop: 4 }}>
            <AppText style={{ color: colors.onSurfaceTertiary }}>Not now</AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", margin: SPACING.lg, borderRadius: RADIUS.md, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, height: 40, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center" },
  micArea: { width: 200, height: 200, alignItems: "center", justifyContent: "center", marginTop: SPACING.lg },
  ring: { position: "absolute", width: 130, height: 130, borderRadius: 65, borderWidth: 3 },
  mic: { width: 130, height: 130, borderRadius: 65, alignItems: "center", justifyContent: "center" },
  resultCard: { width: "100%", borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACING.lg, marginTop: SPACING.xl },
  noteChips: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  noteChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, minWidth: 44, alignItems: "center" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, height: 54 },
  chip: { height: 40, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  modalCard: { width: "100%", borderRadius: RADIUS.xl, padding: SPACING.xl, alignItems: "center" },
  modalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
});
