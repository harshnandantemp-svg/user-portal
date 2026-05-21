from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

BASE_DIR = Path(__file__).resolve().parent

# This demo uses JSON files so the magic-link flow stays portable. In a real
# deployment these two files should become database tables.
MAGIC_TOKENS_FILE = Path(os.getenv('MAGIC_TOKENS_FILE', BASE_DIR / 'data' / 'magic_tokens.json'))
SESSIONS_FILE = Path(os.getenv('MAGIC_SESSIONS_FILE', BASE_DIR / 'data' / 'magic_sessions.json'))

# Keep these values in env so demos can use longer expiry, while production can
# reduce the magic-link lifetime without touching code.
MAGIC_LINK_EXPIRE_MINUTES = int(os.getenv('MAGIC_LINK_EXPIRE_MINUTES', '1440'))
MAGIC_LINK_RATE_LIMIT_COUNT = int(os.getenv('MAGIC_LINK_RATE_LIMIT_COUNT', '3'))
MAGIC_LINK_RATE_LIMIT_WINDOW_MINUTES = int(os.getenv('MAGIC_LINK_RATE_LIMIT_WINDOW_MINUTES', '15'))
SESSION_EXPIRE_MINUTES = int(os.getenv('MAGIC_SESSION_EXPIRE_MINUTES', '1440'))
FRONTEND_MAGIC_LINK_URL = os.getenv('FRONTEND_MAGIC_LINK_URL', 'https://portal.demoopwr.in/?token=')
REQUIRE_MAGIC_AUTH = os.getenv('REQUIRE_MAGIC_AUTH', 'true').strip().lower() not in {'0', 'false', 'no'}
JSON_WRITE_RETRY_COUNT = int(os.getenv('JSON_WRITE_RETRY_COUNT', '5'))
JSON_WRITE_RETRY_DELAY_SECONDS = float(os.getenv('JSON_WRITE_RETRY_DELAY_SECONDS', '0.08'))

# FastAPI runs sync route handlers in a thread pool. Without a lock, two token
# verify calls can read/write the same JSON files at the same time, which is
# especially fragile on Windows.
_JSON_LOCK = threading.RLock()


def normalize_email(email: str | None) -> str:
    return str(email or '').strip().lower()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def hash_token(token: str) -> str:
    # Store only a one-way hash. The raw token should exist only in the URL sent
    # to the user and in the verification request.
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _load_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    # utf-8-sig prevents Windows-edited JSON files with a BOM from crashing the
    # demo backend.
    with path.open('r', encoding='utf-8-sig') as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise HTTPException(status_code=500, detail=f'{path.name} must contain a JSON array')
    return payload


def _save_json_list(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_file = path.with_name(f'{path.stem}.{secrets.token_hex(8)}.tmp')

    try:
        with _JSON_LOCK:
            with temp_file.open('w', encoding='utf-8') as handle:
                json.dump(items, handle, indent=2)

            for attempt in range(JSON_WRITE_RETRY_COUNT):
                try:
                    temp_file.replace(path)
                    return
                except PermissionError:
                    if attempt == JSON_WRITE_RETRY_COUNT - 1:
                        raise
                    time.sleep(JSON_WRITE_RETRY_DELAY_SECONDS)
    finally:
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def session_email_from_token(session_token: str | None) -> str | None:
    # The session token may arrive from an HttpOnly cookie or, for backward
    # compatibility with older demos, from an Authorization bearer header.
    clean_token = str(session_token or '').strip()
    if not clean_token:
        return None

    token_hash = hash_token(clean_token)
    now = _now()
    sessions = _load_json_list(SESSIONS_FILE)
    for session in sessions:
        if session.get('token_hash') != token_hash:
            continue
        expires_at = parse_datetime(session.get('expires_at'))
        if not expires_at or expires_at <= now:
            return None
        return normalize_email(session.get('email'))
    return None


def session_email(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith('bearer '):
        return None
    return session_email_from_token(authorization.split(' ', 1)[1].strip())


def create_magic_link(email: str, allowed_emails: set[str], ip_address: str | None = None) -> dict[str, Any]:
    normalized_email = normalize_email(email)
    generic_message = 'If this email is allowed, a login link has been sent.'
    if not normalized_email:
        raise HTTPException(status_code=422, detail='email is required')

    # Do not reveal whether an email exists. Unknown emails receive the same
    # response without creating a token.
    if normalized_email not in allowed_emails:
        return {'success': True, 'message': generic_message}

    with _JSON_LOCK:
        now = _now()
        window_start = now - timedelta(minutes=MAGIC_LINK_RATE_LIMIT_WINDOW_MINUTES)
        tokens = _load_json_list(MAGIC_TOKENS_FILE)
        recent_requests = [
            item for item in tokens
            if normalize_email(item.get('email')) == normalized_email
            and (parse_datetime(item.get('created_at')) or datetime.min.replace(tzinfo=timezone.utc)) >= window_start
        ]
        if len(recent_requests) >= MAGIC_LINK_RATE_LIMIT_COUNT:
            raise HTTPException(status_code=429, detail='Too many magic links requested. Please try again later.')

        # The raw token is the secret that goes into the URL. We store only its
        # hash, so a leaked token store cannot be used directly to log in.
        raw_token = secrets.token_urlsafe(32)
        expires_at = now + timedelta(minutes=MAGIC_LINK_EXPIRE_MINUTES)
        tokens.append({
            'email': normalized_email,
            'token_hash': hash_token(raw_token),
            'created_at': _iso(now),
            'expires_at': _iso(expires_at),
            'used_at': None,
            'ip_address': ip_address,
        })
        _save_json_list(MAGIC_TOKENS_FILE, tokens)

    # Demo behavior: print the link in the backend terminal. Production should
    # send this URL by email and keep it out of API responses/log aggregation.
    magic_link = f'{FRONTEND_MAGIC_LINK_URL}{raw_token}'
    print('\n[magic-link-demo]')
    print(f'Email: {normalized_email}')
    print(f'Open this frontend link: {magic_link}\n')

    return {
        'success': True,
        'message': 'Magic link generated. Check the backend terminal and open the printed link.',
        'expires_in_minutes': MAGIC_LINK_EXPIRE_MINUTES,
    }


def verify_magic_link(raw_token: str) -> dict[str, Any]:
    clean_token = str(raw_token or '').strip()
    if not clean_token:
        raise HTTPException(status_code=422, detail='token is required')

    with _JSON_LOCK:
        # Hash the URL token and compare hash-to-hash with storage. This mirrors
        # how passwords are verified without storing the original secret.
        token_hash = hash_token(clean_token)
        now = _now()
        tokens = _load_json_list(MAGIC_TOKENS_FILE)
        matched_token: dict[str, Any] | None = None

        for item in tokens:
            if item.get('token_hash') != token_hash:
                continue
            matched_token = item
            break

        if not matched_token:
            raise HTTPException(status_code=401, detail='Invalid magic link')
        if matched_token.get('used_at'):
            raise HTTPException(status_code=401, detail='Magic link has already been used')

        expires_at = parse_datetime(matched_token.get('expires_at'))
        if not expires_at or expires_at <= now:
            raise HTTPException(status_code=401, detail='Magic link has expired')

        # One-time-use protection: after this line, opening the same link in
        # private mode or another device must fail.
        matched_token['used_at'] = _iso(now)
        _save_json_list(MAGIC_TOKENS_FILE, tokens)

        # After verification, create a separate session token. The magic-link
        # token logs the user in once; the session token authorizes later
        # dashboard calls.
        session_token = secrets.token_urlsafe(32)
        session_expires_at = now + timedelta(minutes=SESSION_EXPIRE_MINUTES)
        sessions = _load_json_list(SESSIONS_FILE)
        sessions.append({
            'email': normalize_email(matched_token.get('email')),
            'token_hash': hash_token(session_token),
            'created_at': _iso(now),
            'expires_at': _iso(session_expires_at),
        })
        _save_json_list(SESSIONS_FILE, sessions)

        return {
            'success': True,
            'access_token': session_token,
            'token_type': 'bearer',
            'email': normalize_email(matched_token.get('email')),
            'expires_at': _iso(session_expires_at),
        }

