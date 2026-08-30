"""Backend API test suite for AI + Music Hub (password auth + email OTP at sign-up)."""
import random
import string
import pytest
import requests
from conftest import (
    BASE_URL, seed_signup_code, seed_reset_code, pending_exists, reset_exists,
    cleanup_email, make_test_wav,
)


def _rand_email(prefix="test"):
    tag = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"{prefix}_{tag}@example.com"


# ---------------- Health ----------------
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "AI + Music Hub" in r.json().get("message", "")


# ---------------- Auth: Signup + Verify ----------------
class TestSignup:
    def test_signup_password_too_short(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"full_name": "X", "email": _rand_email(), "password": "short1"})
        assert r.status_code == 422

    def test_signup_invalid_email(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"full_name": "X", "email": "not-an-email", "password": "testpass123"})
        assert r.status_code == 422

    def test_signup_empty_name(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"full_name": "   ", "email": _rand_email(), "password": "testpass123"})
        assert r.status_code == 422

    def test_signup_creates_pending_and_verify_creates_user(self, api):
        email = _rand_email("signup")
        try:
            r = api.post(f"{BASE_URL}/api/auth/signup",
                         json={"full_name": "Alice A", "email": email, "password": "testpass123"})
            assert r.status_code in (200, 502), r.text  # email may 502 for @example.com
            assert pending_exists(email)
            # No user yet
            seed_signup_code(email, "123456")
            v = api.post(f"{BASE_URL}/api/auth/verify-signup", json={"email": email, "code": "123456"})
            assert v.status_code == 200, v.text
            j = v.json()
            assert "token" in j and j["user"]["email"] == email.lower()
            assert j["user"]["name"] == "Alice A"
            # pending cleaned up
            assert not pending_exists(email)
        finally:
            cleanup_email(email)

    def test_signup_duplicate_existing_user_409(self, api, test_user):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"full_name": "Dup", "email": test_user["email"], "password": "testpass123"})
        assert r.status_code == 409

    def test_verify_signup_wrong_code_and_attempt_lockout(self, api):
        email = _rand_email("lockout")
        try:
            r = api.post(f"{BASE_URL}/api/auth/signup",
                         json={"full_name": "Bob", "email": email, "password": "testpass123"})
            assert r.status_code in (200, 502)
            seed_signup_code(email, "123456")
            # 5 wrong attempts
            for i in range(5):
                v = api.post(f"{BASE_URL}/api/auth/verify-signup",
                             json={"email": email, "code": "000000"})
                assert v.status_code == 400
                assert "Incorrect" in v.json().get("detail", "")
            # 6th attempt should be blocked (attempts >= 5) — even with correct code
            v6 = api.post(f"{BASE_URL}/api/auth/verify-signup",
                          json={"email": email, "code": "123456"})
            assert v6.status_code == 400
            assert "Too many" in v6.json().get("detail", "") or "sign up again" in v6.json().get("detail", "").lower()
            # And pending should be cleared
            assert not pending_exists(email)
        finally:
            cleanup_email(email)

    def test_verify_signup_no_pending(self, api):
        r = api.post(f"{BASE_URL}/api/auth/verify-signup",
                     json={"email": "nobody_test_xyz@example.com", "code": "123456"})
        assert r.status_code == 400


# ---------------- Auth: Login ----------------
class TestLogin:
    def test_login_success(self, api, test_user):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": test_user["email"], "password": test_user["password"]})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j
        assert j["user"]["email"] == test_user["email"].lower()

    def test_login_wrong_password_401(self, api, test_user):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": test_user["email"], "password": "wrongpassword"})
        assert r.status_code == 401
        assert r.json()["detail"] == "Invalid email or password"

    def test_login_unknown_email_401_generic(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": "unknown_nobody_xyz@example.com", "password": "whatever12"})
        assert r.status_code == 401
        assert r.json()["detail"] == "Invalid email or password"


# ---------------- Auth: Forgot + Reset ----------------
class TestForgotReset:
    def test_forgot_unknown_email_returns_200_generic(self, api):
        r = api.post(f"{BASE_URL}/api/auth/forgot-password",
                     json={"email": "nobody_forgot_xyz@example.com"})
        assert r.status_code == 200
        assert r.json().get("status") == "sent"
        # No reset doc created for unknown user
        assert not reset_exists("nobody_forgot_xyz@example.com")

    def test_forgot_and_reset_flow(self, api):
        # Create a fresh user first
        from conftest import create_user_via_flow
        email = _rand_email("reset")
        try:
            create_user_via_flow(api, BASE_URL, email, "oldpass123")
            # Forgot
            r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
            # Might be 200 or 502 on email send failure — server returns 200 even before send in code path; but send failure raises 500/502.
            # Regardless, password_resets doc should exist because it's written before send.
            assert reset_exists(email), f"reset doc missing for {email} (status={r.status_code} {r.text})"
            seed_reset_code(email, "123456")
            # Reset with too-short password
            bad = api.post(f"{BASE_URL}/api/auth/reset-password",
                           json={"email": email, "code": "123456", "password": "short"})
            assert bad.status_code == 422
            # Reset with wrong code
            wc = api.post(f"{BASE_URL}/api/auth/reset-password",
                          json={"email": email, "code": "000000", "password": "newpass123"})
            assert wc.status_code == 400
            # Correct reset
            ok = api.post(f"{BASE_URL}/api/auth/reset-password",
                          json={"email": email, "code": "123456", "password": "newpass123"})
            assert ok.status_code == 200, ok.text
            # Old password fails
            l1 = api.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "oldpass123"})
            assert l1.status_code == 401
            # New password works
            l2 = api.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "newpass123"})
            assert l2.status_code == 200
            # Reset doc cleaned up
            assert not reset_exists(email)
        finally:
            cleanup_email(email)


# ---------------- Auth: Me / Profile ----------------
class TestMeProfile:
    def test_me_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_bad_token(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me",
                    headers={"Authorization": "Bearer garbage.token.value"})
        assert r.status_code == 401

    def test_me_success(self, api, auth_headers, test_user):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["user"]["id"] == test_user["user"]["id"]

    def test_update_profile_persists(self, api, auth_headers):
        r = api.put(f"{BASE_URL}/api/auth/profile", headers=auth_headers,
                    json={"name": "Tester Renamed"})
        assert r.status_code == 200
        assert r.json()["user"]["name"] == "Tester Renamed"
        r2 = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r2.json()["user"]["name"] == "Tester Renamed"


# ---------------- Chat ----------------
class TestChat:
    def test_history_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/chat/history")
        assert r.status_code == 401

    def test_send_message_persists(self, api, auth_headers):
        api.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
        r = api.post(f"{BASE_URL}/api/chat/message",
                     headers=auth_headers, json={"text": "Say hi in 3 words"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["role"] == "assistant" and isinstance(j["text"], str) and len(j["text"]) > 0
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
        assert isinstance(j["result"], str) and len(j["result"]) > 20

    def test_empty_song_rejected(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notes/from-song",
                     headers=auth_headers, json={"song": "  ", "instrument": "Piano"})
        assert r.status_code == 400


# ---------------- Notes Melody Detection ----------------
class TestNotesDetect:
    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/notes/detect",
                          files={"file": ("t.wav", b"x", "audio/wav")})
        assert r.status_code == 401

    def test_detect_synthetic_a4(self, test_user):
        wav = make_test_wav(freq_hz=440.0, seconds=1.5)
        headers = {"Authorization": f"Bearer {test_user['token']}"}
        r = requests.post(f"{BASE_URL}/api/notes/detect",
                          headers=headers,
                          files={"file": ("tone.wav", wav, "audio/wav")})
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j["notes"], list)
        assert "A4" in j["notes"], f"Expected A4 in {j['notes']}"

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
        assert p["likes"] == 0 and p["liked_by_me"] is False
        r2 = api.get(f"{BASE_URL}/api/posts", headers=auth_headers)
        assert any(x["id"] == p["id"] for x in r2.json()["posts"])
        for x in r2.json()["posts"]:
            assert "_id" not in x

    def test_empty_post_rejected(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/posts", headers=auth_headers, json={"text": "  "})
        assert r.status_code == 400

    def test_like_toggle(self, api, auth_headers, second_auth_headers):
        r = api.post(f"{BASE_URL}/api/posts", headers=second_auth_headers,
                     json={"text": "TEST_like_post"})
        pid = r.json()["post"]["id"]
        r1 = api.post(f"{BASE_URL}/api/posts/{pid}/like", headers=auth_headers)
        assert r1.status_code == 200
        assert r1.json()["likes"] == 1 and r1.json()["liked_by_me"] is True
        r2 = api.post(f"{BASE_URL}/api/posts/{pid}/like", headers=auth_headers)
        assert r2.json()["likes"] == 0 and r2.json()["liked_by_me"] is False

    def test_comments_flow(self, api, auth_headers, second_auth_headers):
        r = api.post(f"{BASE_URL}/api/posts", headers=auth_headers,
                     json={"text": "TEST_comment_post"})
        pid = r.json()["post"]["id"]
        rc = api.post(f"{BASE_URL}/api/posts/{pid}/comments",
                      headers=second_auth_headers, json={"text": "TEST_first_comment"})
        assert rc.status_code == 200
        rl = api.get(f"{BASE_URL}/api/posts/{pid}/comments", headers=auth_headers)
        assert any(x["text"] == "TEST_first_comment" for x in rl.json()["comments"])
