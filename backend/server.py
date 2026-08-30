import os
import re
import io
import json
import random
import logging
import ipaddress
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Annotated
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse, quote

import jwt
import httpx
import numpy as np
from pydub import AudioSegment

# Use the pip-bundled ffmpeg binary so audio decoding works everywhere
# (survives pod restarts and deployment, no system package needed).
try:
    import imageio_ffmpeg
    AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    pass
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Header
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"
JWT_TTL_DAYS = 30

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI()
api_router = APIRouter(prefix="/api")


def now_utc():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Email guardrail gate (from playbook — do not weaken)
# ---------------------------------------------------------------------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Failed to send verification email")
    except Exception as e:
        logger.error(f"Email send error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to send verification email")


def code_email_html(intro: str, code: str, expiry_min: int) -> str:
    return (
        '<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;'
        'font-family:Arial,Helvetica,sans-serif"><tr><td style="padding:28px 24px">'
        f'<h1 style="font-size:20px;color:#1C1C1E;margin:0 0 8px">AI + Music Hub</h1>'
        f'<p style="font-size:15px;color:#3a3a3c;margin:0 0 20px">{escape(intro)} '
        f'This code expires in {expiry_min} minutes.</p>'
        f'<div style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#2D6A4F;'
        f'background:#F0F5F2;border-radius:12px;padding:18px 0;text-align:center">{escape(code)}</div>'
        '<p style="font-size:12px;color:#8E8E93;margin:22px 0 0">If you did not request this, '
        'you can safely ignore this email. Keep this code private.</p>'
        f'<p style="font-size:12px;color:#8E8E93;margin:14px 0 0">Sent by {escape(EMAIL_FROM_NAME)}.</p>'
        '</td></tr></table>'
    )


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def create_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": now_utc() + timedelta(days=JWT_TTL_DAYS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def public_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "name": user.get("name") or user["email"].split("@")[0],
        "initials": (user.get("name") or user["email"])[:2].upper(),
    }


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
MIN_PASSWORD_LEN = 8


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_ctx.verify(password, password_hash)
    except Exception:
        return False


def validate_password(password: str):
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=422, detail=f"Password must be at least {MIN_PASSWORD_LEN} characters")
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password is too long")


class SignupBody(BaseModel):
    full_name: str
    email: EmailStr
    password: str


class VerifySignupBody(BaseModel):
    email: EmailStr
    code: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ForgotBody(BaseModel):
    email: EmailStr


class ResetBody(BaseModel):
    email: EmailStr
    code: str
    password: str


class UpdateProfileBody(BaseModel):
    name: str


class ChatMessageBody(BaseModel):
    text: str


class NotesFromSongBody(BaseModel):
    song: str
    instrument: str


class CreatePostBody(BaseModel):
    text: str


class CommentBody(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/signup")
async def signup(body: SignupBody):
    email = body.email.lower().strip()
    full_name = body.full_name.strip()[:120]
    if not full_name:
        raise HTTPException(status_code=422, detail="Please enter your full name")
    validate_password(body.password)

    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="An account already exists for this email. Please log in.")

    code = f"{random.randint(0, 999999):06d}"
    await db.pending_signups.replace_one(
        {"email": email},
        {
            "email": email,
            "name": full_name,
            "password_hash": hash_password(body.password),
            "code_hash": pwd_ctx.hash(code),
            "expires_at": now_utc() + timedelta(minutes=10),
            "attempts": 0,
            "created_at": now_utc(),
        },
        upsert=True,
    )
    await send_email(
        to=email,
        subject="Verify your email for AI + Music Hub",
        html=code_email_html("Use this code to verify your email and finish creating your account.", code, 10),
    )
    return {"status": "sent", "email": email}


@api_router.post("/auth/verify-signup")
async def verify_signup(body: VerifySignupBody):
    email = body.email.lower().strip()
    rec = await db.pending_signups.find_one({"email": email})
    if not rec:
        raise HTTPException(status_code=400, detail="No pending sign-up found. Please sign up again.")
    if rec["expires_at"].replace(tzinfo=timezone.utc) < now_utc():
        await db.pending_signups.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Code expired. Please sign up again.")
    if rec.get("attempts", 0) >= 5:
        await db.pending_signups.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Too many attempts. Please sign up again.")
    if not pwd_ctx.verify(body.code.strip(), rec["code_hash"]):
        await db.pending_signups.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect code. Try again.")

    existing = await db.users.find_one({"email": email})
    if existing:
        await db.pending_signups.delete_many({"email": email})
        raise HTTPException(status_code=409, detail="An account already exists for this email. Please log in.")

    res = await db.users.insert_one({
        "email": email,
        "name": rec["name"],
        "password_hash": rec["password_hash"],
        "is_active": True,
        "email_verified": True,
        "created_at": now_utc(),
    })
    await db.pending_signups.delete_many({"email": email})
    user = await db.users.find_one({"_id": res.inserted_id})
    token = create_token(str(user["_id"]))
    return {"token": token, "user": public_user(user)}


@api_router.post("/auth/login")
async def login(body: LoginBody):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(str(user["_id"]))
    return {"token": token, "user": public_user(user)}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotBody):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        code = f"{random.randint(0, 999999):06d}"
        await db.password_resets.replace_one(
            {"email": email},
            {
                "email": email,
                "code_hash": pwd_ctx.hash(code),
                "expires_at": now_utc() + timedelta(minutes=15),
                "attempts": 0,
                "used": False,
                "created_at": now_utc(),
            },
            upsert=True,
        )
        await send_email(
            to=email,
            subject="Reset your AI + Music Hub password",
            html=code_email_html("Use this code to reset your password.", code, 15),
        )
    return {"status": "sent", "email": email}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetBody):
    email = body.email.lower().strip()
    validate_password(body.password)
    rec = await db.password_resets.find_one({"email": email})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="No reset request found. Please try again.")
    if rec["expires_at"].replace(tzinfo=timezone.utc) < now_utc():
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Reset code expired. Please request a new one.")
    if rec.get("attempts", 0) >= 5:
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new code.")
    if not pwd_ctx.verify(body.code.strip(), rec["code_hash"]):
        await db.password_resets.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect code. Try again.")

    await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(body.password)}})
    await db.password_resets.delete_many({"email": email})
    return {"status": "reset"}


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return {"user": public_user(user)}


@api_router.put("/auth/profile")
async def update_profile(body: UpdateProfileBody, user=Depends(get_current_user)):
    name = body.name.strip()[:40] or user["email"].split("@")[0]
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"name": name}})
    user["name"] = name
    return {"user": public_user(user)}


# ---------------------------------------------------------------------------
# Chat with AI
# ---------------------------------------------------------------------------
CHAT_SYSTEM = (
    "You are Aria, the friendly AI assistant inside the AI + Music Hub app. "
    "You help users with anything creative or general. Keep answers clear, warm and concise. "
    "You are especially knowledgeable about music, songwriting, instruments and production.\n\n"
    "Formatting rules (important): write clean, presentable replies for a mobile chat. "
    "Use short paragraphs. You may use **bold** sparingly for key terms or short section labels. "
    "Do NOT use horizontal rules ('---'), markdown tables, or code fences. "
    "For lists, put each item on its own line starting with '- '."
)

LYRICS_EXTRACT_SYSTEM = (
    "You extract song information from a user's request. "
    "Reply with ONLY compact JSON of the form {\"artist\": \"\", \"title\": \"\"}. "
    "Identify the song title and its most likely well-known recording artist. "
    "If the user named an artist, use it; otherwise infer the most famous artist for that song. "
    "If you cannot identify a specific song, return empty strings. No other text."
)


async def extract_song(text: str):
    try:
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id="lyrics-extract",
                       system_message=LYRICS_EXTRACT_SYSTEM).with_model("anthropic", "claude-sonnet-4-6")
        raw = await chat.send_message(UserMessage(text=text))
        m = re.search(r"\{.*\}", raw or "", re.S)
        if not m:
            return "", ""
        j = json.loads(m.group(0))
        return (j.get("artist") or "").strip(), (j.get("title") or "").strip()
    except Exception as e:
        logger.error(f"extract_song error: {e}")
        return "", ""


async def fetch_lyrics(artist: str, title: str):
    if not artist or not title:
        return None
    url = f"https://api.lyrics.ovh/v1/{quote(artist, safe='')}/{quote(title, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url)
    except Exception as e:
        logger.error(f"lyrics fetch error: {e}")
        return None
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    lyr = (data.get("lyrics") or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    # Some responses prefix with a French "Paroles de la chanson ... par ..." header line.
    lyr = re.sub(r"^paroles de la chanson.*?\n", "", lyr, flags=re.I).strip()
    # Collapse 3+ blank lines
    lyr = re.sub(r"\n{3,}", "\n\n", lyr)
    return lyr or None


@api_router.get("/chat/history")
async def chat_history(user=Depends(get_current_user)):
    msgs = await db.chat_messages.find({"user_id": str(user["_id"])}).sort("created_at", 1).to_list(500)
    return {"messages": [
        {"id": str(m["_id"]), "role": m["role"], "text": m["text"],
         "created_at": m["created_at"].isoformat()}
        for m in msgs
    ]}


@api_router.delete("/chat/history")
async def clear_chat(user=Depends(get_current_user)):
    await db.chat_messages.delete_many({"user_id": str(user["_id"])})
    return {"status": "cleared"}


@api_router.post("/chat/message")
async def chat_message(body: ChatMessageBody, user=Depends(get_current_user)):
    uid = str(user["_id"])
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    prior = await db.chat_messages.find({"user_id": uid}).sort("created_at", 1).to_list(500)
    now = now_utc()
    await db.chat_messages.insert_one({"user_id": uid, "role": "user", "text": text, "created_at": now})

    # Lyrics requests: fetch real lyrics from a lyrics provider instead of the LLM
    # (which is trained to refuse reproducing full copyrighted lyrics).
    if "lyric" in text.lower():
        artist, title = await extract_song(text)
        if title:
            lyrics = await fetch_lyrics(artist, title)
            if lyrics:
                header = f"🎵 **{title}**" + (f" — {artist}" if artist else "")
                reply = f"{header}\n\n{lyrics}"
            elif artist:
                reply = (f"I couldn't find the lyrics for **{title}** by {artist}. "
                         "Double-check the spelling, or try another song.")
            else:
                reply = (f"I found the song **{title}**, but I need the artist to look up the lyrics. "
                         f"Try asking like: \"lyrics of {title} by <artist>\".")
            saved = await db.chat_messages.insert_one(
                {"user_id": uid, "role": "assistant", "text": reply, "created_at": now_utc()})
            return {"id": str(saved.inserted_id), "role": "assistant", "text": reply}
        # No song identified — fall through to a normal chat reply.

    history_text = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Aria'}: {m['text']}" for m in prior[-20:])
    system = CHAT_SYSTEM
    if history_text:
        system += "\n\nConversation so far:\n" + history_text

    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"chat-{uid}", system_message=system).with_model(
        "anthropic", "claude-sonnet-4-6")
    try:
        reply = await chat.send_message(UserMessage(text=text))
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=502, detail="AI is unavailable right now. Please try again.")

    reply = (reply or "").strip()
    saved = await db.chat_messages.insert_one(
        {"user_id": uid, "role": "assistant", "text": reply, "created_at": now_utc()})
    return {"id": str(saved.inserted_id), "role": "assistant", "text": reply}


# ---------------------------------------------------------------------------
# Musical Notes — AI (song name -> notes/chords for an instrument)
# ---------------------------------------------------------------------------
@api_router.post("/notes/from-song")
async def notes_from_song(body: NotesFromSongBody, user=Depends(get_current_user)):
    song = body.song.strip()
    instrument = body.instrument.strip() or "Piano"
    if not song:
        raise HTTPException(status_code=400, detail="Please enter a song name")

    system = (
        "You are a music teacher. When given a song name and an instrument, provide a clear, "
        "beginner-friendly breakdown for playing that song on that instrument. "
        "Structure the answer with these bold section labels, each followed by its content on the next line:\n"
        "**Key & Time** - the key and time signature.\n"
        "**Main Chords** - the chord progression (e.g. C - G - Am - F).\n"
        "**Melody Notes** - the opening melody as note names (e.g. E E F G G F E D).\n"
        "**Tips** - one or two short playing tips for this instrument.\n"
        "Do NOT use horizontal rules ('---'), markdown tables, headings ('#'), or code fences. "
        "If you are unsure of the exact song, give the most likely well-known version and say so briefly. "
        "Keep it concise and clean."
    )
    prompt = f"Song: {song}\nInstrument: {instrument}\nGive the playable notes and chords."
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"notes-{user['_id']}", system_message=system).with_model(
        "anthropic", "claude-sonnet-4-6")
    try:
        result = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"Notes AI error: {e}")
        raise HTTPException(status_code=502, detail="Could not generate notes right now. Try again.")

    await db.note_lookups.insert_one({
        "user_id": str(user["_id"]), "song": song, "instrument": instrument,
        "result": result, "created_at": now_utc(),
    })
    return {"song": song, "instrument": instrument, "result": (result or "").strip()}


# ---------------------------------------------------------------------------
# Musical Notes — melody detection (autocorrelation pitch tracking)
# ---------------------------------------------------------------------------
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def freq_to_note(freq: float):
    if not freq or freq <= 0:
        return None
    midi = int(round(69 + 12 * np.log2(freq / 440.0)))
    if midi < 24 or midi > 108:
        return None
    name = _NOTE_NAMES[midi % 12]
    octave = midi // 12 - 1
    return f"{name}{octave}"


def detect_pitch_autocorr(frame: np.ndarray, sr: int):
    frame = frame - np.mean(frame)
    if np.sqrt(np.mean(frame ** 2)) < 0.01:  # silence
        return None
    corr = np.correlate(frame, frame, mode="full")
    corr = corr[len(corr) // 2:]
    min_lag = int(sr / 1200)
    max_lag = int(sr / 70)
    if max_lag >= len(corr):
        max_lag = len(corr) - 1
    if min_lag >= max_lag:
        return None
    segment = corr[min_lag:max_lag]
    peak = int(np.argmax(segment)) + min_lag
    if corr[peak] <= 0:
        return None
    return sr / peak


@api_router.post("/notes/detect")
async def detect_notes(file: UploadFile = File(...), user=Depends(get_current_user)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty recording")
    try:
        seg = AudioSegment.from_file(io.BytesIO(raw))
    except Exception as e:
        logger.error(f"Audio decode failed: {e}")
        raise HTTPException(status_code=400, detail="Could not read the recording. Try again.")

    seg = seg.set_channels(1).set_frame_rate(22050)
    sr = seg.frame_rate
    samples = np.array(seg.get_array_of_samples()).astype(np.float32)
    if seg.sample_width == 2:
        samples /= 32768.0
    elif seg.sample_width == 4:
        samples /= 2147483648.0
    if samples.size < sr // 4:
        raise HTTPException(status_code=400, detail="Recording too short. Hum a little longer.")

    frame_size = 2048
    hop = 1024
    detected = []
    for start in range(0, len(samples) - frame_size, hop):
        frame = samples[start:start + frame_size]
        freq = detect_pitch_autocorr(frame, sr)
        detected.append(freq_to_note(freq) if freq else None)

    sequence = []
    i = 0
    while i < len(detected):
        note = detected[i]
        run = 1
        while i + run < len(detected) and detected[i + run] == note:
            run += 1
        if note and run >= 2:
            if not sequence or sequence[-1] != note:
                sequence.append(note)
        i += run

    await db.note_lookups.insert_one({
        "user_id": str(user["_id"]), "type": "melody",
        "notes": sequence, "created_at": now_utc(),
    })
    if not sequence:
        return {"notes": [], "message": "Couldn't detect a clear melody. Hum one steady note at a time."}
    return {"notes": sequence, "message": f"Detected {len(sequence)} notes."}


# ---------------------------------------------------------------------------
# Public Channel
# ---------------------------------------------------------------------------
def serialize_post(p: dict, uid: str, author: dict) -> dict:
    return {
        "id": str(p["_id"]),
        "text": p["text"],
        "author": {"id": str(author["_id"]), "name": author.get("name") or author["email"].split("@")[0],
                   "initials": (author.get("name") or author["email"])[:2].upper()},
        "likes": len(p.get("liked_by", [])),
        "liked_by_me": uid in p.get("liked_by", []),
        "comment_count": p.get("comment_count", 0),
        "created_at": p["created_at"].isoformat(),
    }


@api_router.get("/posts")
async def list_posts(user=Depends(get_current_user)):
    uid = str(user["_id"])
    posts = await db.posts.find().sort("created_at", -1).to_list(200)
    author_ids = list({p["author_id"] for p in posts})
    authors = {}
    for aid in author_ids:
        try:
            a = await db.users.find_one({"_id": ObjectId(aid)})
        except Exception:
            a = None
        if a:
            authors[aid] = a
    out = [serialize_post(p, uid, authors[p["author_id"]]) for p in posts if p["author_id"] in authors]
    return {"posts": out}


@api_router.post("/posts")
async def create_post(body: CreatePostBody, user=Depends(get_current_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Post cannot be empty")
    text = text[:1000]
    res = await db.posts.insert_one({
        "author_id": str(user["_id"]),
        "text": text,
        "liked_by": [],
        "comment_count": 0,
        "created_at": now_utc(),
    })
    p = await db.posts.find_one({"_id": res.inserted_id})
    return {"post": serialize_post(p, str(user["_id"]), user)}


@api_router.post("/posts/{post_id}/like")
async def toggle_like(post_id: str, user=Depends(get_current_user)):
    uid = str(user["_id"])
    try:
        oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Post not found")
    post = await db.posts.find_one({"_id": oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    liked = uid in post.get("liked_by", [])
    op = "$pull" if liked else "$addToSet"
    await db.posts.update_one({"_id": oid}, {op: {"liked_by": uid}})
    post = await db.posts.find_one({"_id": oid})
    return {"likes": len(post.get("liked_by", [])), "liked_by_me": not liked}


@api_router.get("/posts/{post_id}/comments")
async def list_comments(post_id: str, user=Depends(get_current_user)):
    comments = await db.comments.find({"post_id": post_id}).sort("created_at", 1).to_list(500)
    out = []
    for c in comments:
        try:
            a = await db.users.find_one({"_id": ObjectId(c["author_id"])})
        except Exception:
            a = None
        if not a:
            continue
        out.append({
            "id": str(c["_id"]),
            "text": c["text"],
            "author": {"name": a.get("name") or a["email"].split("@")[0],
                       "initials": (a.get("name") or a["email"])[:2].upper()},
            "created_at": c["created_at"].isoformat(),
        })
    return {"comments": out}


@api_router.post("/posts/{post_id}/comments")
async def add_comment(post_id: str, body: CommentBody, user=Depends(get_current_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    try:
        oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Post not found")
    post = await db.posts.find_one({"_id": oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    res = await db.comments.insert_one({
        "post_id": post_id,
        "author_id": str(user["_id"]),
        "text": text[:500],
        "created_at": now_utc(),
    })
    await db.posts.update_one({"_id": oid}, {"$inc": {"comment_count": 1}})
    return {"comment": {
        "id": str(res.inserted_id),
        "text": text[:500],
        "author": {"name": user.get("name") or user["email"].split("@")[0],
                   "initials": (user.get("name") or user["email"])[:2].upper()},
        "created_at": now_utc().isoformat(),
    }}


@api_router.get("/")
async def root():
    return {"message": "AI + Music Hub API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
