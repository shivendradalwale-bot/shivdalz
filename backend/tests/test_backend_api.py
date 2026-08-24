"""Backend API test suite for AI + Music Hub."""
import os
import time
import pytest
import requests
from conftest import BASE_URL, seed_otp, make_test_wav


# ---------------- Health ----------------
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "AI + Music Hub" in r.json().get("message", "")


# ---------------- Auth ----------------
class TestAuth:
    def test_request_otp_valid_email(self, api):
        # Uses Emergent email; delivered@resend.dev is a black-hole sink.
        r = api.post(f"{BASE_URL}/api/auth/request-otp", json={"email": "delivered@resend.dev"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("status") == "sent"
        assert j.get("email") == "delivered@resend.dev"

    def test_request_otp_invalid_email(self, api):
        r = api.post(f"{BASE_URL}/api/auth/request-otp", json={"email": "not-an-email"})
        assert r.status_code == 422

    def test_verify_otp_no_request(self, api):
        r = api.post(f"{BASE_URL}/api/auth/verify-otp",
                     json={"email": "nobody_test@example.com", "code": "000000"})
        assert r.status_code == 400
        assert "No code" in r.json().get("detail", "")

    def test_verify_otp_wrong_code(self, api):
        email = "test_wrong_code@example.com"
        seed_otp(email, "111111")
        r = api.post(f"{BASE_URL}/api/auth/verify-otp",
                     json={"email": email, "code": "999999"})
        assert r.status_code == 400
        assert "Incorrect" in r.json().get("detail", "")

    def test_verify_otp_success_returns_token_and_user(self, test_user):
        assert test_user["token"]
        assert test_user["user"]["email"] == test_user["email"].lower()
        assert "id" in test_user["user"]
        assert "initials" in test_user["user"]

    def test_me_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_with_bad_token(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me",
                    headers={"Authorization": "Bearer garbage.token.value"})
        assert r.status_code == 401

    def test_me_success(self, api, auth_headers, test_user):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["user"]["id"] == test_user["user"]["id"]

    def test_update_profile(self, api, auth_headers):
        r = api.put(f"{BASE_URL}/api/auth/profile",
                    headers=auth_headers, json={"name": "Tester One"})
        assert r.status_code == 200
        assert r.json()["user"]["name"] == "Tester One"
        # Verify persistence via GET /me
        r2 = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r2.json()["user"]["name"] == "Tester One"


# ---------------- Chat ----------------
class TestChat:
    def test_history_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/chat/history")
        assert r.status_code == 401

    def test_history_empty(self, api, auth_headers):
        # Ensure clean state
        api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        r = api.get(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["messages"] == []

    def test_send_message_and_persist(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers, json={"text": "Say hi in 3 words"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["role"] == "assistant"
        assert isinstance(j["text"], str) and len(j["text"]) > 0

        # Verify via history: should contain both user and assistant messages
        r2 = api.get(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        msgs = r2.json()["messages"]
        assert any(m["role"] == "user" for m in msgs)
        assert any(m["role"] == "assistant" for m in msgs)

    def test_empty_message_rejected(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers, json={"text": "   "})
        assert r.status_code == 400

    def test_clear_history(self, api, auth_headers):
        r = api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        assert r.status_code == 200
        r2 = api.get(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        assert r2.json()["messages"] == []


# ---------------- Notes AI ----------------
class TestNotesFromSong:
    def test_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/notes/from-song",
                     json={"song": "Happy Birthday", "instrument": "Piano"})
        assert r.status_code == 401

    def test_from_song_returns_result(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notes/from-song",
                     headers=auth_headers,
                     json={"song": "Twinkle Twinkle Little Star", "instrument": "Piano"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["song"] == "Twinkle Twinkle Little Star"
        assert j["instrument"] == "Piano"
        assert isinstance(j["result"], str) and len(j["result"]) > 20

    def test_empty_song_rejected(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notes/from-song",
                     headers=auth_headers, json={"song": "  ", "instrument": "Piano"})
        assert r.status_code == 400


# ---------------- Notes Melody Detection ----------------
class TestNotesDetect:
    def test_requires_auth(self, api):
        r = requests.post(f"{BASE_URL}/api/notes/detect", files={"file": ("t.wav", b"x", "audio/wav")})
        assert r.status_code == 401

    def test_detect_synthetic_a4(self, api, test_user):
        wav = make_test_wav(freq_hz=440.0, seconds=1.5)
        headers = {"Authorization": f"Bearer {test_user['token']}"}
        r = requests.post(f"{BASE_URL}/api/notes/detect",
                          headers=headers,
                          files={"file": ("tone.wav", wav, "audio/wav")})
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j["notes"], list)
        # A4 should be in the detected notes
        assert "A4" in j["notes"], f"Expected A4 in {j['notes']}"

    def test_detect_too_short(self, test_user):
        wav = make_test_wav(freq_hz=440.0, seconds=0.05)
        headers = {"Authorization": f"Bearer {test_user['token']}"}
        r = requests.post(f"{BASE_URL}/api/notes/detect",
                          headers=headers,
                          files={"file": ("tone.wav", wav, "audio/wav")})
        assert r.status_code == 400

    def test_detect_empty_file(self, test_user):
        headers = {"Authorization": f"Bearer {test_user['token']}"}
        r = requests.post(f"{BASE_URL}/api/notes/detect",
                          headers=headers,
                          files={"file": ("tone.wav", b"", "audio/wav")})
        assert r.status_code == 400


# ---------------- Public Channel ----------------
class TestChannel:
    def test_list_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/posts")
        assert r.status_code == 401

    def test_create_and_list_post(self, api, auth_headers, test_user):
        r = api.post(f"{BASE_URL}/api/posts",
                     headers=auth_headers, json={"text": "TEST_POST_hello_world"})
        assert r.status_code == 200, r.text
        p = r.json()["post"]
        assert p["text"] == "TEST_POST_hello_world"
        assert p["likes"] == 0
        assert p["liked_by_me"] is False
        assert p["comment_count"] == 0
        assert p["author"]["id"] == test_user["user"]["id"]

        # List and confirm present
        r2 = api.get(f"{BASE_URL}/api/posts", headers=auth_headers)
        assert r2.status_code == 200
        assert any(x["id"] == p["id"] for x in r2.json()["posts"])
        # Ensure no _id leaks
        for x in r2.json()["posts"]:
            assert "_id" not in x

    def test_empty_post_rejected(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/posts", headers=auth_headers, json={"text": "  "})
        assert r.status_code == 400

    def test_like_toggle(self, api, auth_headers, second_auth_headers):
        # user2 creates post; user1 likes it
        r = api.post(f"{BASE_URL}/api/posts", headers=second_auth_headers,
                     json={"text": "TEST_like_post"})
        pid = r.json()["post"]["id"]

        r1 = api.post(f"{BASE_URL}/api/posts/{pid}/like", headers=auth_headers)
        assert r1.status_code == 200
        j1 = r1.json()
        assert j1["likes"] == 1
        assert j1["liked_by_me"] is True

        # Toggle off
        r2 = api.post(f"{BASE_URL}/api/posts/{pid}/like", headers=auth_headers)
        j2 = r2.json()
        assert j2["likes"] == 0
        assert j2["liked_by_me"] is False

    def test_like_invalid_post(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/posts/not_a_valid_id/like", headers=auth_headers)
        assert r.status_code == 404
        r2 = api.post(f"{BASE_URL}/api/posts/507f1f77bcf86cd799439011/like", headers=auth_headers)
        assert r2.status_code == 404

    def test_comments_flow(self, api, auth_headers, second_auth_headers):
        r = api.post(f"{BASE_URL}/api/posts", headers=auth_headers,
                     json={"text": "TEST_comment_post"})
        pid = r.json()["post"]["id"]

        rc = api.post(f"{BASE_URL}/api/posts/{pid}/comments",
                      headers=second_auth_headers, json={"text": "TEST_first_comment"})
        assert rc.status_code == 200, rc.text
        c = rc.json()["comment"]
        assert c["text"] == "TEST_first_comment"
        assert "initials" in c["author"]

        rl = api.get(f"{BASE_URL}/api/posts/{pid}/comments", headers=auth_headers)
        assert rl.status_code == 200
        comments = rl.json()["comments"]
        assert any(x["text"] == "TEST_first_comment" for x in comments)

        # comment_count should update on the post
        posts = api.get(f"{BASE_URL}/api/posts", headers=auth_headers).json()["posts"]
        target = next(p for p in posts if p["id"] == pid)
        assert target["comment_count"] >= 1

    def test_comment_empty_rejected(self, api, auth_headers):
        # create post then try empty comment
        r = api.post(f"{BASE_URL}/api/posts", headers=auth_headers, json={"text": "TEST_empty_c"})
        pid = r.json()["post"]["id"]
        rc = api.post(f"{BASE_URL}/api/posts/{pid}/comments",
                      headers=auth_headers, json={"text": " "})
        assert rc.status_code == 400

    def test_comment_invalid_post(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/posts/507f1f77bcf86cd799439011/comments",
                     headers=auth_headers, json={"text": "hi"})
        assert r.status_code == 404
