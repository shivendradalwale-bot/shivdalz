# AI + Music Hub — PRD

## Original problem statement
Mobile app with a clean home page with 4 options: "Chat with AI", "Studio", "Musical Notes", "Public Channel", coloured in abstract solid colors. Multi-user with OTP login (email + phone). Keep it simple.

## User choices (confirmed)
- Chat with AI → Claude Sonnet 4.6
- Studio → Looper studio (record/loop/stack audio layers, volume + tempo). True real-time EQ/reverb not feasible in Expo Go (explained to user).
- Musical Notes → (a) hum a melody → backend pitch detection returns note names; (b) type a song name + pick instrument → Claude returns notes/chords.
- Public Channel → shared social feed (posts, likes, comments).
- Login → Email OTP now (Emergent-managed email). Phone SMS OTP deferred until user provides Twilio keys.
- Theme → light/dark toggle in Settings.

## Architecture
- Frontend: Expo Router (stack-only, hub-and-spoke). React Native, expo-audio, @react-native-community/slider, expo-blur, reanimated, react-native-keyboard-controller. Custom fonts Outfit + Figtree via expo-font.
- Backend: FastAPI, MongoDB (motor). JWT bearer auth. Emergent-managed email (Resend proxy) for OTP. emergentintegrations LlmChat (Claude Sonnet 4.6). numpy + pydub/ffmpeg for melody pitch detection (autocorrelation).
- Theme: ThemeProvider (light/dark palettes from design_guidelines.json), persisted via storage util.

## Chat lyrics + clean formatting (2026-08-30)
- Aria now returns real song lyrics by fetching from the lyrics.ovh public lyrics API when a message asks for lyrics (Claude only extracts song+artist; the LLM no longer refuses). Falls back gracefully when a song can't be found.
- Added a lightweight `RichText` renderer (src/components/ui.tsx): renders **bold**, headings, bullets and dividers so replies/notes look clean — no raw `**` or `---`. Prompts tuned to avoid horizontal rules/tables.
- Note: lyrics.ovh is a free public source suitable for a prototype; a licensed lyrics provider should be used before commercial launch (backend interface can stay the same).

## Auth (updated 2026-08-30): password-based with email OTP verification at sign-up
- Sign up: full name + email + password + confirm → 6-digit email OTP verifies email → account created + JWT.
- Login: email + password only (no OTP after signup).
- Forgot password: 6-digit reset code emailed → set new password.
- Passwords bcrypt-hashed (min 8 chars). Pending signups in `pending_signups`, reset codes in `password_resets` (both single-use, time-limited, hashed). Existing `users`/JWT/`get_current_user` preserved so chat/posts/notes keep working. 32/32 backend tests + all auth frontend flows pass.
- Audio decoding uses pip-bundled `imageio-ffmpeg` (no system ffmpeg dependency; survives restarts/deploy).

## Implemented (2026-06 / build date 2026-08-24)
- Email OTP auth: request-otp, verify-otp (creates user on first verify), me, profile update. JWT 30-day tokens, secure-store on device.
- Chat with AI (Claude): history persistence, send message, clear. Typewriter/typing indicator UX.
- Musical Notes AI: song + instrument → Claude structured breakdown (Key/Chords/Melody/Tips).
- Musical Notes melody detection: multipart audio upload → autocorrelation pitch tracking → note-name sequence (verified A4/C5/E5).
- Public Channel: feed list, compose, like toggle, comments screen with count.
- Settings: dark/light toggle, edit name, logout.
- Permissions: contextual mic permission flow (ask → settings fallback) in Studio & Notes.
- Testing: 30/30 backend tests pass; all frontend flows verified.

## Backlog / remaining
- P1: Phone SMS OTP (needs Twilio keys from user).
- P2: Studio — save/export loop sessions to Object Storage; share loops to Public Channel.
- P2: Musical Notes — export detected melody as shareable notes card; play back detected notes.
- P2: Public Channel — attach audio/loops to posts; user profiles.
- P3: Polish — migrate deprecated RN Web shadow* styles; compose modal keyboard offset tweak.

## Notes
- Studio mic recording & playback are native-device features — validate on a real build / Expo Go, not web preview.
- No seeded accounts; users self-create via OTP. See /app/memory/test_credentials.md for test method.
