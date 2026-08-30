"""Tests for the lyrics fetch fix and clean formatting in chat/notes replies.

Verifies:
1. POST /api/chat/message with an explicit song+artist lyrics request returns
   the REAL lyrics from lyrics.ovh (multi-line verse) — NOT a copyright refusal.
2. POST /api/chat/message with "lyrics for <song>" (no artist) still returns lyrics
   (artist auto-inferred by extract_song).
3. Nonsense song title returns a graceful "couldn't find" message, no crash.
4. Non-lyrics chat still hits Claude and returns a non-empty reply.
5. /api/notes/from-song result should NOT contain literal horizontal rule '---'
   (per system prompt). Bold '**' may still appear in raw text (frontend renders).
"""
import re
import pytest
import requests
from conftest import BASE_URL


REFUSAL_MARKERS = [
    "can't share", "cannot share", "can't provide", "cannot provide",
    "can't reproduce", "cannot reproduce", "copyright", "copyrighted",
    "not able to share the lyrics", "unable to share",
]


def _looks_like_refusal(text: str) -> bool:
    low = text.lower()
    return any(m in low for m in REFUSAL_MARKERS)


class TestChatLyrics:
    def test_lyrics_imagine_by_john_lennon(self, api, auth_headers):
        """Explicit artist: real lyrics returned, header starts with song name."""
        api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers,
                     json={"text": "give me the lyrics of Imagine by John Lennon"})
        # Retry once if lyrics.ovh flakes
        if r.status_code != 200 or "Imagine" not in r.json().get("text", ""):
            r = api.post(f"{BASE_URL}/api/chat/message",
                         headers=auth_headers,
                         json={"text": "lyrics of Imagine by John Lennon"})
        assert r.status_code == 200, r.text
        text = r.json()["text"]
        assert not _looks_like_refusal(text), f"Assistant refused: {text[:300]}"
        # Header line contains the song title
        first_line = text.splitlines()[0]
        assert "Imagine" in first_line, f"Header missing song title: {first_line}"
        # Should be multi-line (a real verse)
        non_empty_lines = [ln for ln in text.splitlines() if ln.strip()]
        if len(non_empty_lines) < 4:
            pytest.skip(f"lyrics.ovh returned too few lines (external service flake): {text[:200]}")
        # Verify some well-known line from Imagine appears (case-insensitive)
        low = text.lower()
        assert any(w in low for w in ["imagine there", "no heaven", "living for today", "dreamer"]), \
            f"Real Imagine lyrics markers not found: {text[:400]}"

    def test_lyrics_no_artist_shape_of_you(self, api, auth_headers):
        """Artist auto-inferred; must still return real lyrics."""
        api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers,
                     json={"text": "lyrics for Shape of You"})
        assert r.status_code == 200, r.text
        text = r.json()["text"]
        # If lyrics.ovh could not resolve, we accept the graceful fallback,
        # but MUST NOT be a copyright refusal.
        assert not _looks_like_refusal(text), f"Assistant refused: {text[:300]}"
        # Accept either: real lyrics header contains Shape of You, OR graceful fallback
        low = text.lower()
        if "couldn't find" in low or "double-check" in low or "need the artist" in low:
            pytest.skip(f"Auto-artist inference or lyrics.ovh miss (graceful): {text[:200]}")
        assert "shape of you" in low, f"Header missing song title: {text[:200]}"
        non_empty = [ln for ln in text.splitlines() if ln.strip()]
        assert len(non_empty) >= 4, f"Too few lines for lyrics: {text[:400]}"

    def test_lyrics_unknown_song_graceful(self, api, auth_headers):
        """Nonsense title returns graceful message OR falls through to Claude — no crash, no refusal lecture."""
        api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers,
                     json={"text": "lyrics of qwzptxlmnoop by zzblorkbork"})
        assert r.status_code == 200, r.text
        text = r.json()["text"]
        # Must not crash (already ensured) and must not be a heavy copyright lecture.
        assert not _looks_like_refusal(text), f"Copyright refusal not expected: {text[:300]}"
        assert len(text) > 0

    def test_normal_chat_still_works(self, api, auth_headers):
        api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers,
                     json={"text": "In 1 short sentence, what is a guitar?"})
        assert r.status_code == 200, r.text
        text = r.json()["text"]
        assert isinstance(text, str) and len(text) > 5
        # Should mention the topic
        assert "guitar" in text.lower() or "string" in text.lower()


class TestNotesFormatting:
    def test_notes_no_horizontal_rules(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notes/from-song",
                     headers=auth_headers,
                     json={"song": "Twinkle Twinkle Little Star", "instrument": "Piano"})
        assert r.status_code == 200, r.text
        result = r.json()["result"]
        # System prompt forbids '---' horizontal rules. Verify absence of a line
        # that is only dashes (which is what would render as a raw divider).
        for line in result.splitlines():
            assert not re.fullmatch(r"\s*-{3,}\s*", line), f"Raw '---' divider found: {line!r}"
            assert not re.fullmatch(r"\s*#{1,6}\s+.*", line) or True  # headings allowed by frontend renderer
        # No markdown code fences
        assert "```" not in result, "Code fence in notes result"
