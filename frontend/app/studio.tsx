import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, Modal, Linking, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
  createAudioPlayer,
  type AudioPlayer,
} from "expo-audio";

import { AppText, Button, Header, useToast } from "@/src/components/ui";
import { FONT, RADIUS, SPACING, useTheme } from "@/src/theme";

const TRACK_COUNT = 4;
const TRACK_COLORS = ["#2D6A4F", "#D4A373", "#8F9E8B", "#C92A42"];

type Track = { uri: string | null; volume: number; muted: boolean };

export default function Studio() {
  const { colors, isDark } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const players = useRef<(AudioPlayer | null)[]>(new Array(TRACK_COUNT).fill(null));

  const [tracks, setTracks] = useState<Track[]>(
    new Array(TRACK_COUNT).fill(0).map(() => ({ uri: null, volume: 0.9, muted: false }))
  );
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(100);
  const [permModal, setPermModal] = useState<null | "ask" | "blocked">(null);
  const pendingTrack = useRef<number | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      players.current.forEach((p) => p?.remove());
    };
  }, []);

  const applyRate = (p: AudioPlayer) => {
    try {
      p.setPlaybackRate(tempo / 100);
    } catch {
      /* older api */
    }
  };

  const ensurePermission = async (index: number) => {
    const current = await AudioModule.getRecordingPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain) {
      pendingTrack.current = index;
      setPermModal("ask");
      return false;
    }
    setPermModal("blocked");
    return false;
  };

  const requestNow = async () => {
    const res = await AudioModule.requestRecordingPermissionsAsync();
    setPermModal(null);
    if (res.granted && pendingTrack.current != null) {
      startRecording(pendingTrack.current);
    } else if (!res.granted && !res.canAskAgain) {
      setPermModal("blocked");
    }
  };

  const startRecording = async (index: number) => {
    if (playing) stopAll();
    const ok = await ensurePermission(index);
    if (!ok) return;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setRecordingIndex(index);
    } catch (e) {
      toast.show("Couldn't start recording", "error");
    }
  };

  const stopRecording = async (index: number) => {
    try {
      await recorder.stop();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const uri = recorder.uri;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      setRecordingIndex(null);
      if (!uri) {
        toast.show("Nothing recorded", "error");
        return;
      }
      players.current[index]?.remove();
      const p = createAudioPlayer({ uri });
      p.loop = true;
      p.volume = tracks[index].muted ? 0 : tracks[index].volume;
      applyRate(p);
      players.current[index] = p;
      setTracks((t) => t.map((tr, i) => (i === index ? { ...tr, uri } : tr)));
      toast.show(`Track ${index + 1} recorded`, "success");
    } catch (e) {
      toast.show("Couldn't save recording", "error");
      setRecordingIndex(null);
    }
  };

  const clearTrack = (index: number) => {
    players.current[index]?.remove();
    players.current[index] = null;
    setTracks((t) => t.map((tr, i) => (i === index ? { ...tr, uri: null } : tr)));
    Haptics.selectionAsync();
  };

  const toggleMute = (index: number) => {
    setTracks((t) =>
      t.map((tr, i) => {
        if (i !== index) return tr;
        const muted = !tr.muted;
        const p = players.current[i];
        if (p) p.volume = muted ? 0 : tr.volume;
        return { ...tr, muted };
      })
    );
    Haptics.selectionAsync();
  };

  const setVolume = (index: number, v: number) => {
    setTracks((t) =>
      t.map((tr, i) => {
        if (i !== index) return tr;
        const p = players.current[i];
        if (p && !tr.muted) p.volume = v;
        return { ...tr, volume: v };
      })
    );
  };

  const playAll = () => {
    const has = tracks.some((t) => t.uri);
    if (!has) {
      toast.show("Record a track first", "info");
      return;
    }
    players.current.forEach((p, i) => {
      if (p) {
        p.loop = true;
        p.volume = tracks[i].muted ? 0 : tracks[i].volume;
        applyRate(p);
        p.seekTo(0);
        p.play();
      }
    });
    setPlaying(true);
    Haptics.selectionAsync();
  };

  const stopAll = () => {
    players.current.forEach((p) => {
      if (p) {
        p.pause();
        p.seekTo(0);
      }
    });
    setPlaying(false);
  };

  const onTempo = (v: number) => {
    setTempo(v);
    players.current.forEach((p) => p && applyRate(p));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Looper Studio" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 180 }}
        showsVerticalScrollIndicator={false}
      >
        <AppText style={{ color: colors.onSurfaceTertiary, marginBottom: SPACING.lg, fontSize: 14 }}>
          Record up to 4 layers, then loop and mix them together.
        </AppText>

        {tracks.map((track, i) => {
          const isRec = recordingIndex === i;
          const accent = TRACK_COLORS[i];
          return (
            <View
              key={i}
              testID={`studio-track-${i}`}
              style={[styles.track, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            >
              <View style={styles.trackTop}>
                <View style={[styles.trackDot, { backgroundColor: accent }]} />
                <AppText display weight="semibold" style={{ fontSize: 15, flex: 1 }}>
                  Track {i + 1}
                </AppText>
                {track.uri ? (
                  <Pressable testID={`studio-clear-${i}`} onPress={() => clearTrack(i)} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color={colors.onSurfaceTertiary} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.trackControls}>
                <Pressable
                  testID={`studio-record-${i}`}
                  onPress={() => (isRec ? stopRecording(i) : startRecording(i))}
                  disabled={recordingIndex !== null && !isRec}
                  style={[
                    styles.recBtn,
                    { backgroundColor: isRec ? colors.error : accent, opacity: recordingIndex !== null && !isRec ? 0.4 : 1 },
                  ]}
                >
                  <Ionicons name={isRec ? "stop" : track.uri ? "refresh" : "mic"} size={22} color="#fff" />
                </Pressable>

                <Pressable
                  testID={`studio-mute-${i}`}
                  onPress={() => toggleMute(i)}
                  disabled={!track.uri}
                  style={[styles.muteBtn, { backgroundColor: colors.surfaceTertiary, opacity: track.uri ? 1 : 0.4 }]}
                >
                  <Ionicons
                    name={track.muted ? "volume-mute" : "volume-high"}
                    size={18}
                    color={track.muted ? colors.error : colors.onSurface}
                  />
                </Pressable>

                <Slider
                  testID={`studio-volume-${i}`}
                  style={{ flex: 1, height: 40 }}
                  minimumValue={0}
                  maximumValue={1}
                  value={track.volume}
                  onValueChange={(v) => setVolume(i, v)}
                  minimumTrackTintColor={accent}
                  maximumTrackTintColor={colors.surfaceTertiary}
                  thumbTintColor={accent}
                  disabled={!track.uri}
                />
              </View>

              {isRec ? (
                <AppText style={{ color: colors.error, fontSize: 12, marginTop: 6 }}>● Recording… tap stop</AppText>
              ) : !track.uri ? (
                <AppText style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 6 }}>
                  Tap the mic to record this layer
                </AppText>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {/* Glass transport bar */}
      <BlurView
        intensity={40}
        tint={isDark ? "dark" : "light"}
        style={[styles.transport, { paddingBottom: insets.bottom || SPACING.md, borderTopColor: colors.border }]}
      >
        <View style={styles.transportRow}>
          <Pressable
            testID="studio-play-all"
            onPress={playing ? stopAll : playAll}
            style={[styles.playAll, { backgroundColor: playing ? colors.error : colors.brand }]}
          >
            <Ionicons name={playing ? "stop" : "play"} size={24} color={colors.onBrand} />
            <AppText style={{ color: colors.onBrand, fontFamily: FONT.display, fontWeight: "700", marginLeft: 6 }}>
              {playing ? "Stop" : "Play all"}
            </AppText>
          </Pressable>

          <View style={{ flex: 1 }}>
            <AppText style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>Tempo · {tempo} BPM</AppText>
            <Slider
              testID="studio-tempo"
              style={{ height: 32 }}
              minimumValue={60}
              maximumValue={160}
              step={1}
              value={tempo}
              onValueChange={onTempo}
              minimumTrackTintColor={colors.brand}
              maximumTrackTintColor={colors.surfaceTertiary}
              thumbTintColor={colors.brand}
            />
          </View>
        </View>
      </BlurView>

      {/* Permission modal */}
      <Modal visible={permModal !== null} transparent animationType="fade" onRequestClose={() => setPermModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surfaceSecondary }]}>
            <View style={[styles.modalIcon, { backgroundColor: colors.brand }]}>
              <Ionicons name="mic" size={26} color={colors.onBrand} />
            </View>
            <AppText display weight="bold" style={{ fontSize: 18, marginTop: SPACING.md }}>
              Microphone access
            </AppText>
            <AppText style={{ color: colors.onSurfaceTertiary, textAlign: "center", marginVertical: SPACING.sm }}>
              {permModal === "blocked"
                ? "Enable microphone in Settings to record your loops."
                : "Studio uses your microphone to record audio loops."}
            </AppText>
            {permModal === "blocked" ? (
              <Button testID="perm-open-settings" title="Open Settings" onPress={() => { setPermModal(null); Linking.openSettings(); }} style={{ alignSelf: "stretch" }} />
            ) : (
              <Button testID="perm-allow" title="Allow microphone" onPress={requestNow} style={{ alignSelf: "stretch" }} />
            )}
            <Pressable onPress={() => setPermModal(null)} style={{ paddingVertical: SPACING.sm, marginTop: 4 }}>
              <AppText style={{ color: colors.onSurfaceTertiary }}>Not now</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACING.lg, marginBottom: SPACING.md },
  trackTop: { flexDirection: "row", alignItems: "center", marginBottom: SPACING.md, gap: SPACING.sm },
  trackDot: { width: 10, height: 10, borderRadius: 5 },
  trackControls: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  recBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  muteBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  transport: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  transportRow: { flexDirection: "row", alignItems: "center", gap: SPACING.lg },
  playAll: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, height: 52, borderRadius: RADIUS.md },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  modalCard: { width: "100%", borderRadius: RADIUS.xl, padding: SPACING.xl, alignItems: "center" },
  modalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
});
