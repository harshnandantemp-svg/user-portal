# User Quarantine Dashboard API

Minimal FastAPI backend for the standalone user quarantine dashboard.

## Routes

- `GET /health`
- `POST /api/v1/quarantine/auth/magic/request`
- `POST /api/v1/quarantine/auth/magic/verify`
- `GET /api/v1/quarantine/user?page=1&limit=10&subject=invoice&sender=alerts@example.com&recipient=user@example.com&emailDate=2026-05-16`
- `GET /api/v1/quarantine/user?page=1&limit=10&startDate=2026-05-01&endDate=2026-05-16`
- `POST /api/v1/quarantine/restore`

## Magic link testing

Request a link:

```json
{ "email": "raiprerna144@gmail.com" }
```

The demo backend prints the magic link in the backend terminal instead of
sending email. Click/open the printed `https://portal.demoopwr.in/?token=...` link to
enter the frontend.

Verify link token:

```json
{ "token": "token-from-url" }
```

Tokens are one-time-use. For local testing, expiry is controlled by:

```env
MAGIC_LINK_EXPIRE_MINUTES=1440
MAGIC_SESSION_EXPIRE_MINUTES=1440
MAGIC_LINK_RATE_LIMIT_COUNT=3
MAGIC_LINK_RATE_LIMIT_WINDOW_MINUTES=15
```

The `GET /user` and `POST /restore` routes require the returned bearer token by
default:

```http
Authorization: Bearer <access_token>
```

For quick local-only demos you can disable that with `REQUIRE_MAGIC_AUTH=false`,
but keep it enabled when users can access the API.

## Restore body examples

```json
{ "id": 1798, "action": "release" }
```

```json
{ "ids": [1798, 1796], "action": "release_and_allow_sender" }
```

## Run

```powershell
cd "C:\Users\Admin\Documents\user quarantine user quarantine portal\backend"
& "C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
```

