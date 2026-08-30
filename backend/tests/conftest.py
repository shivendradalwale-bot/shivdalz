"""Shared fixtures for backend tests (password + OTP sign-up)."""
import os
import io
import wave
import struct
import math
import random
import string
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient
from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

BASE_URL = None
for line in open(Path(__file__).resolve().parents[2] / 'frontend' / '.env'):
    if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
        BASE_URL = line.strip().split('=', 1)[1].strip().strip('"').rstrip('/')
        break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not found in frontend/.env"

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _rand_email():
    tag = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"test_{tag}@example.com"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _db():
    return MongoClient(MONGO_URL)[DB_NAME]


def seed_signup_code(email: str, code: str = "123456"):
    """Override the bcrypt code_hash for a pending signup so we can verify with a known code."""
    email = email.lower().strip()
    db = _db()
    db.pending_signups.update_one(
        {"email": email},
        {"$set": {"code_hash": pwd_ctx.hash(code),
                   "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                   "attempts": 0}},
    )


def seed_reset_code(email: str, code: str = "123456"):
    email = email.lower().strip()
    db = _db()
    db.password_resets.update_one(
        {"email": email},
        {"$set": {"code_hash": pwd_ctx.hash(code),
                   "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
                   "attempts": 0, "used": False}},
    )


def pending_exists(email: str) -> bool:
    return _db().pending_signups.find_one({"email": email.lower()}) is not None


def reset_exists(email: str) -> bool:
    return _db().password_resets.find_one({"email": email.lower()}) is not None


def cleanup_email(email: str):
    email = email.lower().strip()
    db = _db()
    user = db.users.find_one({"email": email})
    if user:
        uid = str(user["_id"])
        db.chat_messages.delete_many({"user_id": uid})
        db.note_lookups.delete_many({"user_id": uid})
        db.posts.delete_many({"author_id": uid})
        db.comments.delete_many({"author_id": uid})
        db.users.delete_one({"_id": user["_id"]})
    db.pending_signups.delete_many({"email": email})
    db.password_resets.delete_many({"email": email})


def create_user_via_flow(api_s, base, email: str, password: str, name: str = "Test User") -> dict:
    """Signup -> seed known code -> verify. Handles email 422 as expected."""
    cleanup_email(email)
    r = api_s.post(f"{base}/api/auth/signup", json={"full_name": name, "email": email, "password": password})
    # 200 or 502 (email undeliverable) both leave pending_signups doc — check.
    assert r.status_code in (200, 502), f"signup unexpected: {r.status_code} {r.text}"
    assert pending_exists(email), f"pending_signups doc missing for {email}"
    seed_signup_code(email, "123456")
    v = api_s.post(f"{base}/api/auth/verify-signup", json={"email": email, "code": "123456"})
    assert v.status_code == 200, f"verify-signup failed: {v.status_code} {v.text}"
    return v.json()


@pytest.fixture(scope="session")
def test_user(api, base_url):
    email = _rand_email()
    password = "testpass123"
    data = create_user_via_flow(api, base_url, email, password)
    yield {"email": email, "password": password, "token": data["token"], "user": data["user"]}
    cleanup_email(email)


@pytest.fixture(scope="session")
def auth_headers(test_user):
    return {"Authorization": f"Bearer {test_user['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def second_user(api, base_url):
    email = _rand_email()
    password = "testpass456"
    data = create_user_via_flow(api, base_url, email, password, name="Second User")
    yield {"email": email, "password": password, "token": data["token"], "user": data["user"]}
    cleanup_email(email)


@pytest.fixture(scope="session")
def second_auth_headers(second_user):
    return {"Authorization": f"Bearer {second_user['token']}", "Content-Type": "application/json"}


def make_test_wav(freq_hz=440.0, seconds=1.5, sr=22050):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        for i in range(int(sr * seconds)):
            val = int(0.5 * 32767 * math.sin(2 * math.pi * freq_hz * i / sr))
            wf.writeframes(struct.pack('<h', val))
    return buf.getvalue()
