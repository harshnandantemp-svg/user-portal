from __future__ import annotations

import json
import os
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Cookie, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from magic_link_auth import (
    REQUIRE_MAGIC_AUTH,
    create_magic_link,
    normalize_email,
    parse_datetime,
    session_email,
    session_email_from_token,
    verify_magic_link as verify_magic_link_token,
)

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = Path(os.getenv('QUARANTINE_DATA_FILE', BASE_DIR / 'data' / 'quarantine_messages.json'))
SESSION_COOKIE_NAME = os.getenv('SESSION_COOKIE_NAME', 'quarantine_session')
SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'true').strip().lower() not in {'0', 'false', 'no'}
SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'lax')

DEFAULT_MESSAGES = [
    {
        'id': 1798,
        'qTime': '2026-05-15T11:03:12.549696+00:00',
        'subject': 'New device detected - Verify instantly',
        'recipient': 'raiprerna144@gmail.com',
        'sender': 'hemant505105@gmail.com',
        'emailDate': '2026-05-15',
        'status': 'quarantined',
    },
    {
        'id': 1796,
        'qTime': '2026-05-15T10:30:25.727339+00:00',
        'subject': 'Your password expires today',
        'recipient': 'raiprerna144@gmail.com',
        'sender': 'hemant505105@gmail.com',
        'emailDate': '2026-05-15',
        'status': 'quarantined',
    },
    {
        'id': 1792,
        'qTime': '2026-05-15T10:00:21.000592+00:00',
        'subject': 'Your package could not be delivered',
        'recipient': 'raiprerna144@gmail.com',
        'sender': 'hemant505105@gmail.com',
        'emailDate': '2026-05-15',
        'status': 'quarantined',
    },
]


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(',') if item.strip()]


def _load_messages() -> list[dict[str, Any]]:
    if not DATA_FILE.exists():
        _save_messages(DEFAULT_MESSAGES)
        return [item.copy() for item in DEFAULT_MESSAGES]

    # utf-8-sig accepts normal UTF-8 and also files saved by Windows tools with
    # a BOM, which keeps the demo data editable from PowerShell/Notepad.
    with DATA_FILE.open('r', encoding='utf-8-sig') as handle:
        payload = json.load(handle)

    if not isinstance(payload, list):
        raise HTTPException(status_code=500, detail='Quarantine data file must contain a JSON array')
    return payload


def _save_messages(messages: list[dict[str, Any]]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = DATA_FILE.with_suffix('.tmp')
    with temp_file.open('w', encoding='utf-8') as handle:
        json.dump(messages, handle, indent=2)
    temp_file.replace(DATA_FILE)


def _allowed_emails() -> set[str]:
    # Demo allow-list: any recipient in the quarantine JSON can request a magic
    # link. In production this should come from your users/mailbox mapping table.
    return {
        normalize_email(item.get('recipient'))
        for item in _load_messages()
        if normalize_email(item.get('recipient'))
    }


def _parse_date(value: str | None, field_name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f'{field_name} must be YYYY-MM-DD') from exc


def _parse_datetime(value: str | None) -> datetime | None:
    return parse_datetime(value)


def _message_date(message: dict[str, Any]) -> datetime:
    parsed = _parse_datetime(str(message.get('qTime') or ''))
    if parsed:
        return parsed
    email_date = _parse_date(str(message.get('emailDate') or ''), 'emailDate')
    if email_date:
        return datetime.combine(email_date, time.min, timezone.utc)
    return datetime.min.replace(tzinfo=timezone.utc)


def _extract_ids(payload: dict[str, Any]) -> list[int]:
    raw_ids = (
        payload.get('ids')
        or payload.get('message_ids')
        or payload.get('messageIds')
        or payload.get('quarantine_ids')
        or payload.get('quarantineIds')
    )

    if raw_ids is None:
        raw_ids = [
            payload.get('id')
            or payload.get('message_id')
            or payload.get('messageId')
            or payload.get('quarantine_message_id')
            or payload.get('quarantineMessageId')
        ]

    if not isinstance(raw_ids, list):
        raw_ids = [raw_ids]

    ids: list[int] = []
    for value in raw_ids:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return ids


app = FastAPI(title='User Quarantine Dashboard API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=_split_csv(
        os.getenv(
            'CORS_ALLOWED_ORIGINS',
            'https://portal.demoopwr.in,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173',
        )
    ),
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/api/v1/quarantine/auth/magic/request')
def request_magic_link(request: Request, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    # Route wrapper only: the reusable token/session logic lives in
    # magic_link_auth.py so another project can copy that file easily.
    return create_magic_link(
        email=payload.get('email'),
        allowed_emails=_allowed_emails(),
        ip_address=request.client.host if request.client else None,
    )


@app.post('/api/v1/quarantine/auth/magic/verify')
def verify_magic_link(response: Response, payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    # The frontend sends the raw token from ?token=... here. The service hashes
    # it, checks expiry/one-time-use, and creates a short session token.
    result = verify_magic_link_token(payload.get('token'))
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=result['access_token'],
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,
        max_age=max(0, int((parse_datetime(result['expires_at']) - datetime.now(timezone.utc)).total_seconds())),
        path='/',
    )

    # Do not return the session token to JavaScript. The browser stores it as an
    # HttpOnly cookie and sends it automatically with credentials: 'include'.
    return {
        'success': True,
        'email': result['email'],
        'expires_at': result['expires_at'],
        'auth_mode': 'httponly_cookie',
    }


@app.get('/api/v1/quarantine/auth/session')
def get_auth_session(
    authorization: str | None = Header(default=None),
    quarantine_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict[str, Any]:
    email = session_email_from_token(quarantine_session) or session_email(authorization)
    if REQUIRE_MAGIC_AUTH and not email:
        raise HTTPException(status_code=401, detail='Valid magic-link session is required')
    return {'authenticated': True, 'email': email}


@app.post('/api/v1/quarantine/auth/logout')
def logout(response: Response) -> dict[str, Any]:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path='/',
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,
    )
    return {'success': True}


@app.get('/api/v1/quarantine/user')
def list_user_quarantine(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    sender: str | None = Query(default=None),
    recipient: str | None = Query(default=None),
    emailDate: str | None = Query(default=None),
    startDate: str | None = Query(default=None),
    endDate: str | None = Query(default=None),
    user_email: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    quarantine_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict[str, Any]:
    messages = [
        item for item in _load_messages()
        if str(item.get('status') or 'quarantined').lower() in {'quarantined', 'blocked', 'requested', 'denied'}
    ]

    session_scoped_email = session_email_from_token(quarantine_session) or session_email(authorization)
    if REQUIRE_MAGIC_AUTH and not session_scoped_email:
        raise HTTPException(status_code=401, detail='Valid magic-link session is required')

    # Security boundary: when magic auth is enabled, the session decides the
    # mailbox scope. Do not trust user_email from the browser for access control.
    scoped_email = session_scoped_email or normalize_email(user_email)
    if scoped_email:
        messages = [
            item for item in messages
            if scoped_email in str(item.get('recipient') or '').lower()
        ]

    normalized_search = (search or '').strip().lower()
    if normalized_search:
        messages = [
            item for item in messages
            if normalized_search in str(item.get('sender') or '').lower()
            or normalized_search in str(item.get('recipient') or '').lower()
            or normalized_search in str(item.get('subject') or '').lower()
        ]

    # Field-specific filters used by the quick-filter UI. These can be combined
    # with date range and pagination without downloading the full queue.
    subject_filter = (subject or '').strip().lower()
    if subject_filter:
        messages = [
            item for item in messages
            if subject_filter in str(item.get('subject') or '').lower()
        ]

    sender_filter = (sender or '').strip().lower()
    if sender_filter:
        messages = [
            item for item in messages
            if sender_filter in str(item.get('sender') or '').lower()
        ]

    recipient_filter = (recipient or '').strip().lower()
    if recipient_filter:
        messages = [
            item for item in messages
            if recipient_filter in str(item.get('recipient') or '').lower()
        ]

    email_date = _parse_date(emailDate, 'emailDate')
    if email_date:
        messages = [
            item for item in messages
            if _message_date(item).date() == email_date
        ]

    start_date = _parse_date(startDate, 'startDate')
    if start_date:
        start_bound = datetime.combine(start_date, time.min, timezone.utc)
        messages = [item for item in messages if _message_date(item) >= start_bound]

    end_date = _parse_date(endDate, 'endDate')
    if end_date:
        end_bound = datetime.combine(end_date + timedelta(days=1), time.min, timezone.utc)
        messages = [item for item in messages if _message_date(item) < end_bound]

    messages.sort(key=_message_date, reverse=True)
    total = len(messages)
    offset = (page - 1) * limit
    items = messages[offset:offset + limit]
    total_pages = (total + limit - 1) // limit if total else 0

    return {
        'items': items,
        'page': page,
        'limit': limit,
        'total': total,
        'totalPages': total_pages,
    }


@app.post('/api/v1/quarantine/restore')
def restore_quarantine_messages(
    payload: dict[str, Any] = Body(default_factory=dict),
    authorization: str | None = Header(default=None),
    quarantine_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict[str, Any]:
    message_ids = _extract_ids(payload)
    if not message_ids:
        raise HTTPException(status_code=422, detail='Send id, ids, message_id, or message_ids')

    action = str(payload.get('action') or 'release').strip().lower()
    allowed_actions = {'release', 'release_and_allow_sender', 'release_and_allow_domain', 'block_sender'}
    if action not in allowed_actions:
        raise HTTPException(status_code=422, detail=f'action must be one of: {", ".join(sorted(allowed_actions))}')

    messages = _load_messages()
    matched_ids: list[int] = []
    released_at = datetime.now(timezone.utc).isoformat()

    session_scoped_email = session_email_from_token(quarantine_session) or session_email(authorization)
    if REQUIRE_MAGIC_AUTH and not session_scoped_email:
        raise HTTPException(status_code=401, detail='Valid magic-link session is required')

    # Release/block actions are scoped to the logged-in recipient. This prevents
    # a user from posting another message ID and releasing someone else's mail.
    scoped_email = session_scoped_email or normalize_email(payload.get('user_email'))
    for item in messages:
        item_id = int(item.get('id') or 0)
        if item_id not in message_ids:
            continue
        if scoped_email and scoped_email not in str(item.get('recipient') or '').lower():
            continue

        matched_ids.append(item_id)
        item['lastAction'] = action
        item['updatedAt'] = released_at
        if action == 'block_sender':
            item['status'] = 'blocked'
        else:
            item['status'] = 'released'
            item['releasedAt'] = released_at

    if not matched_ids:
        raise HTTPException(status_code=404, detail='No quarantine messages found for supplied ids')

    _save_messages(messages)
    return {
        'success': True,
        'action': action,
        'ids': matched_ids,
        'released': action != 'block_sender',
    }
