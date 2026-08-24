"""Shared fixtures for backend tests."""
import os
import io
import wave
import struct
import math
import random
import string
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from passlib.context import CryptContext
from dotenv import load_dotenv
from pathlib import Path

# Load backend env for MONGO_URL / DB_NAME
load_dotenv(Path(__file__).resolve().parents[1] / '.env')

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') if os.environ.get('EXPO_PUBLIC_BACKEND_URL') else None
if not BASE_URL:
    # Read from frontend/.env fallback
    with open(Path(__file__).resolve().parents[2] / 'frontend' / '.env') as f:
        for line in f:
            if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                BASE_URL = line.strip().split('=', 1)[1].rstrip('/')
                break

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


async def _seed_otp(email: str, code: str = "123456"):
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    db.otps.delete_many({"email": email})
    db.otps.insert_one({
        "email": email,
        "code_hash": pwd_ctx.hash(code),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc),
    })
    client.close()


def seed_otp(email, code="123456"):
    import asyncio as _a
    # kept function name compatible; run sync
    _seed_otp_sync(email, code)


def _seed_otp_sync(email: str, code: str = "123456"):
    email = email.lower().strip()
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    db.otps.delete_many({"email": email})
    db.otps.insert_one({
        "email": email,
        "code_hash": pwd_ctx.hash(code),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc),
    })
    client.close()


def _cleanup_sync(email):
    from bson import ObjectId  # noqa
    email = email.lower().strip()
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    user = db.users.find_one({"email": email})
    if user:
        uid = str(user["_id"])
        db.chat_messages.delete_many({"user_id": uid})
        db.note_lookups.delete_many({"user_id": uid})
        db.posts.delete_many({"author_id": uid})
        db.comments.delete_many({"author_id": uid})
        db.users.delete_one({"_id": user["_id"]})
    db.otps.delete_many({"email": email})
    client.close()


def cleanup_email(email):
    _cleanup_sync(email)


@pytest.fixture(scope="session")
def test_user(api, base_url):
    """Provision a real user via seeded OTP -> verify-otp. Yields dict {email,token,user}."""
    email = f"test_{_rand_email()}"
    seed_otp(email, "123456")
    r = api.post(f"{base_url}/api/auth/verify-otp", json={"email": email, "code": "123456"})
    assert r.status_code == 200, f"verify-otp failed: {r.status_code} {r.text}"
    data = r.json()
    yield {"email": email, "token": data["token"], "user": data["user"]}
    cleanup_email(email)


@pytest.fixture(scope="session")
def auth_headers(test_user):
    return {"Authorization": f"Bearer {test_user['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def second_user(api, base_url):
    email = f"test2_{_rand_email()}"
    seed_otp(email, "123456")
    r = api.post(f"{base_url}/api/auth/verify-otp", json={"email": email, "code": "123456"})
    assert r.status_code == 200
    data = r.json()
    yield {"email": email, "token": data["token"], "user": data["user"]}
    cleanup_email(email)


@pytest.fixture(scope="session")
def second_auth_headers(second_user):
    return {"Authorization": f"Bearer {second_user['token']}", "Content-Type": "application/json"}


def make_test_wav(freq_hz=440.0, seconds=1.5, sr=22050):
    """Generate a synthetic sine-wave WAV for pitch-detect endpoint."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        for i in range(int(sr * seconds)):
            val = int(0.5 * 32767 * math.sin(2 * math.pi * freq_hz * i / sr))
            wf.writeframes(struct.pack('<h', val))
    return buf.getvalue()
