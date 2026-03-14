# Slack-Style Authentication Redesign

## Context

Team9 currently renders separate `/login` and `/register` pages in both the web client and the Tauri desktop client. This spec refactors auth toward a Slack-style flow:

- The desktop app delegates authentication to the system browser.
- The browser uses a unified sign-in page.
- Email auth uses one-time verification codes instead of magic links.
- The desktop app receives credentials back through the existing poll-login mechanism plus a deeplink wake-up.

This revision intentionally avoids any dependency on browser `sessionStorage` for desktop auth completion. The previous link-based approach was too fragile across email clients, tabs, and desktop app cold starts.

## Goals

1. Desktop app shows only a minimal landing page with a `Sign in with Browser` button.
2. All human authentication happens in the user's default browser.
3. Email auth uses short-lived verification codes, not email links.
4. Login and registration merge into one browser page: Google OAuth on top, email below, with a dynamic display-name field for new users.
5. Desktop auth can recover from both warm-start and cold-start deeplink callbacks.

## Non-Goals

- Changing the bot authentication flow.
- Removing the existing `/v1/auth/login`, `/v1/auth/register`, or `/v1/auth/verify-email` endpoints immediately.
- Redesigning the workspace invitation acceptance flow.

---

## Architecture

### New Backend Endpoints

#### `POST /v1/auth/start`

Unified entry point for email auth.

**Request:**

```typescript
{
  email: string;
  displayName?: string; // required only when the email does not map to an existing user
}
```

**Response:**

```typescript
{
  action: 'code_sent' | 'need_display_name';
  email: string;
  challengeId?: string;        // present when action === 'code_sent'
  expiresInSeconds?: number;   // present when action === 'code_sent'
  verificationCode?: string;   // dev mode only
}
```

**Logic:**
| Condition | Action |
|-----------|--------|
| Email exists, verified | Create login challenge, send email code, return `code_sent` |
| Email exists, not verified | Create verification challenge, send email code, return `code_sent` |
| Email not found, no `displayName` | Return `need_display_name` |
| Email not found, `displayName` provided | Create signup challenge, send email code, return `code_sent` |

Important behavior:

- For a new email, the first call must not create a user row yet.
- The server stores signup intent in the auth challenge and only creates the user after code verification succeeds.
- This avoids polluting the database with abandoned signups.

Rate limiting:

- Per email: 60 seconds between `start` requests.
- Per IP: global burst limit for abuse control.

#### `POST /v1/auth/verify-code`

Verifies the one-time email code and completes browser authentication.

**Request:**

```typescript
{
  email: string;
  challengeId: string;
  code: string;
}
```

**Response:**

```typescript
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  }
}
```

**Logic:**

- Validate challenge existence, email match, status `pending`, expiration, and remaining attempts.
- Existing verified user: log in directly.
- Existing unverified user: mark `emailVerified = true`, then log in.
- New user signup challenge: generate username from `displayName`, create user, mark email verified, emit the same registration events as today's successful registration path, then log in.

Challenge rules:

- Code TTL: 10 minutes.
- Max attempts: 5 per challenge.
- Successful verification consumes the challenge exactly once.

#### `POST /v1/auth/create-desktop-session`

Creates a polling session before opening the browser.

No authentication required.

**Response:**

```typescript
{
  sessionId: string;
  pairCode: string; // short human-readable code shown in desktop + browser
  expiresInSeconds: number; // 1800
}
```

Writes:

- `im:login_session:{sessionId}` -> `{ status: 'pending', pairCode }` with 30-minute TTL

Security requirements:

- Rate limit by IP and device fingerprint where available.
- Reject excessive concurrent pending desktop sessions from the same client.

#### `POST /v1/auth/complete-desktop-session`

Called by the authenticated browser after successful Google auth or email code verification.

Requires authentication.

**Request:**

```typescript
{
  sessionId: string;
  pairCode: string;
}
```

**Logic:**

- Load `im:login_session:{sessionId}`.
- Reject if not found, expired, or not `pending`.
- Reject if `pairCode` does not match.
- Generate a fresh token pair for the authenticated user.
- Write `{ status: 'verified', accessToken, refreshToken, user }` to the session key with 5-minute TTL.

Important:

- This endpoint must not create a session implicitly.
- It only upgrades an existing pending session to `verified`.

### Username Generation

The existing `generateUniqueUsername(email)` method in `AuthService` is generalized:

```typescript
generateUniqueUsername(base: string): string
```

Rules:

- If `base` contains `@`, use the email prefix for backward compatibility.
- Otherwise, use the full string.
- Sanitize: lowercase -> replace non-`[a-z0-9_]` with `_` -> collapse `_` -> trim leading/trailing `_`.
- Min length 3, max base length 26.
- On collision, append `_XXXX`, retry up to 5 times, then fall back to a UUID fragment.

Google login should prefer the Google profile `name` over email for username generation.

### Legacy Endpoints

The old endpoints remain during migration:

- `POST /v1/auth/login`
- `POST /v1/auth/register`
- `GET /v1/auth/verify-email`

They are retained for backward compatibility and gradual rollout, but the new `/login` UI must use the new code-based flow by default.

Outstanding email links generated before rollout should continue to work.

---

## Frontend

### Unified Auth Page (`/login`)

The page detects runtime environment and renders either browser mode or desktop mode.

#### Web Browser Mode

Layout remains close to Anthropic/Slack-style sign-in:

```text
┌─────────────────────────────┐
│         Team9 Logo          │
│      "Sign in to Team9"     │
│                             │
│  [ Continue with Google ]   │
│            OR               │
│  Email                      │
│  [ you@example.com       ]  │
│                             │
│  if new user:               │
│  Display Name               │
│  [ Jane Doe             ]   │
│                             │
│  [ Continue with Email ]    │
│                             │
│  after code sent:           │
│  Verification Code          │
│  [ 123456               ]   │
│  [ Verify and Sign In   ]   │
└─────────────────────────────┘
```

State machine:

```text
idle
  -> [submit email] -> calling_auth_start
  -> [action: need_display_name] -> awaiting_display_name
  -> [submit email + displayName] -> calling_auth_start
  -> [action: code_sent] -> awaiting_code
  -> [submit code] -> verifying_code
  -> [success] -> authenticated
```

Behavior:

- If the URL contains `desktopSessionId` and `pairCode`, the page shows a banner such as `Signing in to desktop app ABCD-12`.
- The page keeps `desktopSessionId`, `pairCode`, `invite`, and `redirect` in router state or URL params throughout the full auth flow.
- No auth step may depend on browser `sessionStorage` to complete desktop login.

#### Tauri Desktop Mode

Detected via `"__TAURI_INTERNALS__" in window`.

Desktop UI shows:

- Brand
- `Sign in with Browser` button
- Waiting state with spinner after the button is clicked
- Pair code while waiting
- Expired / retry state

Flow:

1. User clicks `Sign in with Browser`.
2. Call `POST /v1/auth/create-desktop-session`.
3. Persist `pending_desktop_session_id` and `pending_desktop_pair_code` in desktop `localStorage`.
4. Open system browser via `@tauri-apps/plugin-shell`:
   `${VITE_APP_URL}/login?desktopSessionId=${sessionId}&pairCode=${pairCode}`
5. Show spinner and pair code.
6. Start `useLoginPolling(sessionId, onSuccess)`.
7. On `verified`, store tokens, clear pending desktop session state, navigate to `/`.

Session expiry:

- If polling returns 404, clear pending desktop session state and show `Session expired` with retry.

Cold-start recovery:

- On app launch, the desktop login page checks `localStorage` for a pending desktop session and resumes polling automatically.
- If a deeplink provides a newer `sessionId`, it replaces the stored pending session.

### Google Login

Google login stays on `/v1/auth/google`.

After Google login succeeds:

- Web-only flow: store tokens and navigate normally.
- Browser-for-desktop flow: call `POST /v1/auth/complete-desktop-session` with `sessionId + pairCode`, then trigger `team9://auth-complete?sessionId=...`.

### Email Code Flow

After `/v1/auth/start` returns `code_sent`:

- Replace the email submit button with a code entry form.
- Show `Change email` action.
- Show resend countdown.

Resend behavior:

- Either reuse `POST /v1/auth/start` with the same payload or add `POST /v1/auth/resend-code`.
- The final implementation must pick one path explicitly; the UI must not guess.

Verification behavior:

- On successful `POST /v1/auth/verify-code`, store tokens for the browser session.
- If `desktopSessionId` is present, immediately call `complete-desktop-session`, then fire the deeplink.

### Deeplink Handler (`useDeepLink.ts`)

This file does need changes.

Expected behavior:

- Parse `team9://auth-complete?sessionId=XXX`
- Save the session ID to desktop `localStorage` as the active pending desktop session
- Navigate to `/login`

Compatibility:

- Bare `team9://auth-complete` may still be accepted for warm-start cases.
- The new flow should prefer the explicit `sessionId` query param to support cold starts reliably.

### Route Changes

| Route             | Change                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `/login`          | Rewrite as unified browser/desktop auth page                               |
| `/register`       | Redirect to `/login` and preserve `invite`, `redirect`, and desktop params |
| `/_authenticated` | Redirect unauthenticated users to `/login` instead of `/register`          |
| `/verify-email`   | Keep for backward compatibility only; not part of the new primary flow     |

### New Environment Variable

`VITE_APP_URL`

- Public web URL used by the desktop app to construct the browser auth URL.
- Added to `apps/client/.env.example`.

---

## Invitation And Redirect Behavior

The unified auth flow must preserve existing navigation behavior.

Required rules:

- `invite` query param survives all `/login` state transitions.
- `redirect` query param survives all `/login` state transitions.
- If signup/login completes while `invite` exists, keep the current `pending_invite_code` acceptance path unless deliberately redesigned in a separate spec.
- The unified page should continue to show invite context banner when an invite code is present.

This is explicitly required to avoid regressions relative to the current `/register` page.

---

## Data Model And Redis Keys

### Email Auth Challenge

Suggested Redis shape:

```typescript
key: im:auth_challenge:{challengeId}
value: {
  status: 'pending' | 'verified' | 'failed';
  email: string;
  codeHash: string;
  attemptsRemaining: number;
  flow: 'login' | 'verify_existing_user' | 'signup';
  signupDisplayName?: string;
  signupUsernameBase?: string;
}
ttl: 10 minutes
```

### Desktop Session

```typescript
key: im:login_session:{sessionId}
value:
  | { status: 'pending'; pairCode: string }
  | { status: 'verified'; accessToken: string; refreshToken: string; user: User }
ttl:
  pending -> 30 minutes
  verified -> 5 minutes
```

---

## Sequence Diagrams

### Flow 1: Web Existing User (Email Code)

```text
Browser                    Server                    Redis
  |                           |                         |
  | POST /auth/start          |                         |
  | { email }                 |                         |
  |-------------------------->|-- create challenge ---->|
  |                           |-- send email code       |
  | { action: code_sent,      |                         |
  |   challengeId }           |                         |
  |<--------------------------|                         |
  |                           |                         |
  | POST /auth/verify-code    |                         |
  | { email, challengeId,     |                         |
  |   code }                  |                         |
  |-------------------------->|-- verify challenge ---->|
  |                           |-- issue tokens          |
  | { accessToken, user }     |                         |
  |<--------------------------|                         |
  | store tokens, navigate /  |                         |
```

### Flow 2: Web New User (Email Code)

```text
Browser                    Server
  |                           |
  | POST /auth/start          |
  | { email }                 |
  |-------------------------->|
  | { action: need_display_name }
  |<--------------------------|
  |                           |
  | POST /auth/start          |
  | { email, displayName }    |
  |-------------------------->|
  | { action: code_sent,      |
  |   challengeId }           |
  |<--------------------------|
  |                           |
  | POST /auth/verify-code    |
  | { email, challengeId, code }
  |-------------------------->|
  |   create user on success  |
  | { accessToken, user }     |
  |<--------------------------|
```

### Flow 3: Desktop App

```text
Desktop App             Browser               Server               Redis
  |                        |                     |                    |
  | POST create-desktop-   |                     |                    |
  | session                |                     |                    |
  |--------------------------------------------------------------->   |
  |                        |                     |-- write pending -->|
  | { sessionId, pairCode }|                     |                    |
  |<---------------------------------------------------------------   |
  | store pending session  |                     |                    |
  | open /login?desktop... |                     |                    |
  |------->|               |                     |                    |
  | start polling session  |                     |                    |
  |                        | POST /auth/start    |                    |
  |                        | POST /auth/verify-code or /auth/google   |
  |                        |-----------------------------------------> |
  |                        |                     | issue browser auth  |
  |                        | POST complete-      |                    |
  |                        | desktop-session     |                    |
  |                        | { sessionId,pairCode}                    |
  |                        |-----------------------------------------> |
  |                        |                     |-- write verified ->|
  |                        | team9://auth-complete?sessionId=...      |
  |<------- wake app ------|                     |                    |
  | poll returns verified  |                     |<-------------------|
  | store tokens, navigate |                     |                    |
```

---

## Files Changed

| File                                              | Operation | Description                                                                                                             |
| ------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/server/.../auth/dto/auth-start.dto.ts`      | Create    | Start email auth                                                                                                        |
| `apps/server/.../auth/dto/verify-code.dto.ts`     | Create    | Verify email code                                                                                                       |
| `apps/server/.../auth/dto/desktop-session.dto.ts` | Create    | Desktop session DTOs                                                                                                    |
| `apps/server/.../auth/dto/index.ts`               | Modify    | Export new DTOs                                                                                                         |
| `apps/server/.../auth/auth.service.ts`            | Modify    | Add `authStart()`, `verifyCode()`, `createDesktopSession()`, `completeDesktopSession()`; generalize username generation |
| `apps/server/.../auth/auth.controller.ts`         | Modify    | Add new routes                                                                                                          |
| `apps/client/src/services/api/index.ts`           | Modify    | Add API methods and types for start/verify-code/desktop session                                                         |
| `apps/client/src/hooks/useAuth.ts`                | Modify    | Add hooks for code flow and desktop session completion                                                                  |
| `apps/client/src/routes/login.tsx`                | Rewrite   | Unified browser/desktop auth page                                                                                       |
| `apps/client/src/routes/register.tsx`             | Simplify  | Redirect to `/login`                                                                                                    |
| `apps/client/src/routes/_authenticated.tsx`       | Modify    | Redirect target -> `/login`                                                                                             |
| `apps/client/src/hooks/useDeepLink.ts`            | Modify    | Support explicit `sessionId` cold-start recovery                                                                        |
| `apps/client/.env.example`                        | Modify    | Add `VITE_APP_URL`                                                                                                      |
| `apps/client/src/i18n/locales/en/auth.json`       | Modify    | Add code-flow and desktop-session strings                                                                               |
| `apps/client/src/i18n/locales/zh/auth.json`       | Modify    | Add code-flow and desktop-session strings                                                                               |

---

## Compatibility

- OpenClaw plugin remains unaffected.
- Existing `POST /v1/auth/login` and `POST /v1/auth/register` remain functional during rollout.
- Existing `/verify-email` links remain valid for previously issued emails.
- `team9://auth-complete` remains accepted, but the new primary flow should emit `team9://auth-complete?sessionId=...`.
- Old `/register` URLs redirect to `/login`.

---

## Verification Plan

1. Web existing user login: `/login` -> enter registered email -> receive code -> enter code -> logged in.
2. Web new user signup: `/login` -> enter new email -> prompted for display name -> receive code -> enter code -> account created and logged in.
3. Web Google login: click Google -> logged in.
4. Desktop full flow with email code: open desktop app -> click `Sign in with Browser` -> browser opens with pair code banner -> receive email code -> enter code -> desktop app logs in automatically.
5. Desktop full flow with Google: open desktop app -> click `Sign in with Browser` -> Google login -> desktop app logs in automatically.
6. Desktop session expiry: wait 30 minutes without completing auth -> desktop shows `Session expired` -> retry works.
7. Desktop deeplink cold start: quit desktop app before browser auth completes -> finish browser auth -> deeplink launches app -> app resumes polling using `sessionId` from deeplink -> logs in.
8. Invite flow: open `/login?invite=...` -> complete signup/login -> invite is still accepted.
9. Redirect flow: open `/login?redirect=...` -> complete signup/login -> redirected to original target.
10. Legacy email link: previously issued `/verify-email?token=...` still works.

---

## Resolved Decisions

1. **Resend code**: reuse `POST /v1/auth/start` with the same payload. No dedicated resend endpoint.
2. **Pair code format**: `XXXX-XX` using A-Z0-9 charset (e.g., `AB3K-7N`).
3. **Desktop pending session storage**: `localStorage` only. No Zustand store needed.
