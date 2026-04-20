# Cloudflare Turnstile for Auth Protection — Design

**Status:** Draft
**Date:** 2026-04-20
**Owner:** @jt

## Goal

Protect user-facing authentication entry points from bot abuse (email-spam
registration, credential stuffing, bulk Google-OAuth account creation) with
Cloudflare Turnstile — an application-layer invisible/interactive CAPTCHA
widget. This is an application-side complement to the edge-level Managed
Challenge already configured on `app.team9.ai/login`, `app.team9.ai/register`,
`app.team9.ai/invite/*`.

## Non-Goals

- Replacing Redis-based per-email / per-IP rate limiting (they stay as-is —
  Turnstile is an additional layer, not a replacement).
- Applying Turnstile to already-authenticated endpoints (`/refresh`, `/logout`,
  `/me`) — JWT is sufficient.
- Protecting internal bot tokens (`t9bot_*`) — those have a different trust
  path and are out of scope.

## Scope

### Protected endpoints (Turnstile required)

| Endpoint               | Reason                                  |
| ---------------------- | --------------------------------------- |
| `POST /v1/auth/start`  | Sends verification email — highest cost |
| `POST /v1/auth/google` | Creates accounts — bulk signup vector   |

### Not protected

- `POST /v1/auth/verify-code` — can only succeed if the caller already has a
  valid challenge issued by `/start`; the 5-attempt lockout + 10-min TTL are
  sufficient.
- `POST /v1/auth/create-desktop-session` — desktop-only, IP rate-limited
  (10/min), and the subsequent browser-side login itself is protected.
- `POST /v1/auth/complete-desktop-session` — called from the already-logged-in
  browser after successful `/start` + `/verify-code`.
- `POST /v1/auth/refresh` / `logout` — authenticated.
- `GET /v1/auth/poll-login` — polling only, already IP rate-limited 30/min.
- `GET /v1/auth/verify-email` — email-link entry (legacy flow); user pressure
  is one-click-from-real-email, low abuse risk.
- `POST /v1/auth/resend-verification` — legacy; will be re-evaluated separately
  if traffic confirms it is still in use.

### Removed (scope of this change)

- `POST /v1/auth/register` — **delete** (legacy; frontend `/register` route is
  a client-side redirect to `/login`).
- `POST /v1/auth/login` — **delete** (legacy; never called by current frontend).
- Associated DTOs (`RegisterDto`, `LoginDto`), controller methods, service
  methods, and client API methods (`api.login`, `api.register`).

Legacy email-link verification (`GET /v1/auth/verify-email`) is retained for
backward compatibility with old verification emails still in inboxes.

## Architecture

```
┌──────────────────────┐      ┌─────────────────────┐      ┌──────────────────────┐
│ app.team9.ai/login   │      │ gateway /v1/auth/*  │      │ challenges.          │
│ (React)              │      │ (NestJS)            │      │ cloudflare.com       │
│                      │      │                     │      │ /turnstile/v0/       │
│ <Turnstile /> widget │      │ AuthService         │      │ siteverify           │
│   │                  │      │   ↓                 │      │                      │
│   ↓ onSuccess(token) │      │ TurnstileService    │      │                      │
│ POST { email,        │─────▶│   .verify(token,ip) │─────▶│ returns { success,   │
│        turnstile }   │      │   ↓ (if ok)         │      │   error-codes,... }  │
│                      │      │ existing logic      │      │                      │
│                      │      │   (Redis rate lim., │      │                      │
│                      │      │    send email, etc.)│      │                      │
└──────────────────────┘      └─────────────────────┘      └──────────────────────┘
```

## Components

### 1. Backend: `TurnstileService`

New file: `apps/server/apps/gateway/src/auth/turnstile.service.ts`

```ts
@Injectable()
export class TurnstileService {
  private readonly secret?: string;
  private readonly enforce: boolean;

  constructor(config: ConfigService) {
    this.secret = config.get("CLOUDFLARE_TURNSTILE_SECRET_KEY");
    this.enforce = config.get("NODE_ENV") === "production";
    if (this.enforce && !this.secret) {
      throw new Error("CLOUDFLARE_TURNSTILE_SECRET_KEY required in production");
    }
  }

  async verify(token: string | undefined, clientIp: string): Promise<void> {
    if (!this.secret) {
      // Dev/test with no key configured: log warning, skip verification.
      this.logger.warn(
        "Turnstile secret not configured — skipping verification",
      );
      return;
    }
    if (!token) throw new BadRequestException("TURNSTILE_TOKEN_REQUIRED");

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: this.secret,
          response: token,
          remoteip: clientIp,
        }),
      },
    );
    const body = await res.json();
    if (!body.success) {
      throw new BadRequestException({
        message: "TURNSTILE_VERIFICATION_FAILED",
        errorCodes: body["error-codes"],
      });
    }
  }
}
```

**Key behaviors:**

- Prod (`NODE_ENV=production`) **requires** the secret at module boot — fail
  fast if misconfigured.
- Non-prod + missing secret → log warning, skip (keeps `pnpm dev` frictionless).
- Non-prod + test secret (`1x0000000000000000000000000000000AA`) → real
  siteverify call, always succeeds (Cloudflare test key).
- Token is **single-use**; caller (frontend) must fetch a fresh one for each
  protected request.
- `remoteip` is sent but not required by Cloudflare; helps with their signal
  aggregation.

### 2. Backend: DTO & controller wiring

Add `turnstileToken: string` (required, IsString) to:

- `AuthStartDto` → `apps/server/apps/gateway/src/auth/dto/auth-start.dto.ts`
- `GoogleLoginDto` → `apps/server/apps/gateway/src/auth/dto/google-login.dto.ts`

In `AuthService.authStart()` and `AuthService.googleLogin()`, call
`this.turnstileService.verify(dto.turnstileToken, clientIp)` as the **first
line** of the method, before any Redis / DB work. Controller already has
`getClientIp(req)`; plumb it through (both methods need a new `clientIp`
parameter).

### 3. Backend: legacy cleanup

**Delete:**

- `AuthController.register()`, `AuthController.login()` — lines 85-94 of
  `auth.controller.ts`.
- `AuthService.register()`, `AuthService.login()` — method bodies in
  `auth.service.ts`.
- `RegisterDto`, `LoginDto` — in `auth/dto/`.
- `apps/server/apps/gateway/src/auth/dto/index.js` exports for both.

**Keep:**

- `RegisterResponse`, `LoginResponse` types from `auth.service.ts` — check if
  still referenced elsewhere (likely unused after deletion; remove if orphaned).

### 4. Frontend: Turnstile widget integration

**Dependency:** `pnpm add @marsidev/react-turnstile` in `apps/client`.

**Config:** New env var `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`. Add to
`apps/client/.env.example`.

**Login page** (`apps/client/src/routes/login.tsx`):

- Render `<Turnstile />` once the user enters the email step.
- Store the token in component state; pass it with the `/auth/start` request.
- After submission (success or failure) call `turnstileRef.current?.reset()` so
  the next action (resend, Google, retry) gets a fresh token.
- Google sign-in flow: acquire a Turnstile token before calling
  `api.googleLogin`, same reset-on-use discipline.
- If `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` is empty: skip rendering the widget
  and omit the field — backend will also skip (dev parity).

**API client** (`apps/client/src/services/api/index.ts`):

- Update `AuthStartRequest` and `GoogleLoginRequest` types to include
  `turnstileToken: string`.
- Delete `api.login`, `api.register`, `LoginRequest`, `RegisterRequest`, and
  unused types.

### 5. Dashboard / ops configuration

**Cloudflare Dashboard → Turnstile → Add site:**

- Widget mode: **Managed**
- Allowed hostnames: `app.team9.ai`, `localhost` (for dev)
- Copy site key → `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`
- Copy secret → `CLOUDFLARE_TURNSTILE_SECRET_KEY` (server env)

Tag widget renders with an `action` parameter (`"auth-start"` for email flow,
`"auth-google"` for Google flow) so Cloudflare analytics can slice by entry
point.

**Test keys for local dev** (official Cloudflare):

- Site key: `1x00000000000000000000AA` (always passes)
- Secret: `1x0000000000000000000000000000000AA`

## Data Flow (happy path — email signup)

1. User lands on `app.team9.ai/login` → Turnstile widget renders, runs
   invisibly, emits `onSuccess(token)`.
2. User enters email → clicks continue.
3. Frontend POSTs `{ email, turnstileToken }` to `/v1/auth/start`.
4. Backend `AuthService.authStart()`:
   a. `turnstileService.verify(token, clientIp)` → siteverify call → ok.
   b. Redis per-email rate-limit check (existing).
   c. Generate 6-digit code, store hash, send email (existing).
5. Frontend receives `challengeId` → shows code input, calls `reset()` on the
   widget (token already spent).
6. User enters code → `/v1/auth/verify-code` → tokens returned → logged in.

## Error Handling

| Scenario                          | Backend response                                  | Frontend behavior                                                |
| --------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Missing token                     | 400 `TURNSTILE_TOKEN_REQUIRED`                    | "Please wait for verification to complete" + reset widget        |
| Invalid/expired token             | 400 `TURNSTILE_VERIFICATION_FAILED`, `errorCodes` | Reset widget, show retry toast                                   |
| Widget failed to load (ad block)  | —                                                 | Show "Please disable ad blocker or try different browser" banner |
| Cloudflare siteverify unreachable | 503 passthrough (retry once)                      | Show generic "please try again" (don't leak infra error)         |

Backend logs every failure with `email` (redacted domain-only), `errorCodes`,
`clientIp` for ops visibility.

## Testing

### Unit (gateway)

- `TurnstileService.verify()`: mock fetch, assert body format, success path,
  failure path (various error codes), missing-secret dev bypass, prod boot
  failure when secret missing.

### Integration (gateway)

- `authStart` rejects with 400 when `turnstileToken` is missing / invalid
  (use Cloudflare's always-fail test secret `2x0000000000000000000000000000000AA`).
- `authStart` proceeds normally when token is valid (always-pass test secret).
- `register` / `login` routes return 404 after deletion.

### Manual (end-to-end)

- `localhost` with test keys → widget invisible, flow completes.
- Staging with real keys → widget invisible for clean browser; opens checkbox
  from incognito + suspicious UA.
- Google login flow: verify token is fresh (reset between email flow and
  Google flow).
- Desktop app (Tauri): confirm login still opens system browser — desktop
  webview itself never loads Turnstile, since browser is used.

## Rollout

1. Deploy backend with `TurnstileService` but **without** setting
   `CLOUDFLARE_TURNSTILE_SECRET_KEY` in staging → service runs, skip-with-warn.
2. Deploy frontend with widget wired but `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`
   empty → widget hidden, no token sent.
3. Set env vars in staging → enable, smoke-test.
4. Set env vars in production → enforcement active.
5. Monitor Cloudflare Turnstile analytics + backend `TURNSTILE_VERIFICATION_FAILED`
   logs for 48h. If false-positive rate is unacceptable, fall back to
   always-pass mode by switching widget to `invisible` (signal-only) or
   removing the env var.

## Open Questions

None. Legacy `resend-verification` and `verify-email` survival is tracked
separately; not blocking this change.

## Files Changed (estimated)

**New:**

- `apps/server/apps/gateway/src/auth/turnstile.service.ts`
- `apps/server/apps/gateway/src/auth/turnstile.service.spec.ts`

**Edit:**

- `apps/server/apps/gateway/src/auth/auth.module.ts` — register `TurnstileService`
- `apps/server/apps/gateway/src/auth/auth.controller.ts` — remove legacy routes, plumb IP
- `apps/server/apps/gateway/src/auth/auth.service.ts` — inject, call `verify()`; remove legacy methods
- `apps/server/apps/gateway/src/auth/dto/auth-start.dto.ts` — add `turnstileToken`
- `apps/server/apps/gateway/src/auth/dto/google-login.dto.ts` — add `turnstileToken`
- `apps/server/apps/gateway/src/auth/dto/index.ts` — remove `RegisterDto`, `LoginDto` exports
- `apps/server/.env.example` — add `CLOUDFLARE_TURNSTILE_SECRET_KEY`
- `apps/client/src/routes/login.tsx` — render widget, send token
- `apps/client/src/services/api/index.ts` — type updates, remove legacy methods
- `apps/client/src/hooks/useAuth.ts` — accept `turnstileToken` in mutation args
- `apps/client/.env.example` — add `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`
- `apps/client/package.json` — add `@marsidev/react-turnstile`

**Delete:**

- `apps/server/apps/gateway/src/auth/dto/register.dto.ts`
- `apps/server/apps/gateway/src/auth/dto/login.dto.ts`

## Runbook: Cloudflare Dashboard setup

1. Cloudflare Dashboard → **Turnstile → Add site**.
2. Site name: `team9-app-auth`.
3. Hostnames: `app.team9.ai`, `localhost` (dev).
4. Widget mode: **Managed**.
5. Click **Create**. Copy:
   - **Site key** → set as `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` in the frontend
     deployment env (Vite picks this up at build time — remember to rebuild).
   - **Secret key** → set as `CLOUDFLARE_TURNSTILE_SECRET_KEY` in the gateway
     deployment env (read at runtime by `env.CLOUDFLARE_TURNSTILE_SECRET_KEY`).
6. Redeploy backend first. Confirm gateway logs do **not** show the warning
   `Turnstile secret not configured — auth Turnstile verification will be
SKIPPED`. If that warning appears in production, the env var didn't load.
7. Redeploy frontend.
8. Smoke test in an incognito window at `https://app.team9.ai/login`:
   - Widget renders (invisible for most users, possibly a one-click checkbox)
   - `POST /v1/auth/start` request body includes `turnstileToken`
   - Successful email submission → code screen shown
   - "Resend code" → widget on code-entry screen re-runs, token refreshed, resend succeeds
9. Monitor for 24 hours:
   - Cloudflare Dashboard → Turnstile → Analytics (pass rate, challenge rate)
   - Gateway logs: `Turnstile verification failed` / `Turnstile siteverify unreachable`
10. Revert: clear both env vars and redeploy. Backend falls back to skip-with-warning (non-prod paths); prod hard-fails on boot so the skip behavior only activates after the env var removal + redeploy.

### Local development keys (Cloudflare test keys)

If you want to exercise the widget locally without creating a real site:

| Purpose               | Site key                   | Secret key                            |
| --------------------- | -------------------------- | ------------------------------------- |
| Always pass           | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always block          | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Always invisible pass | `3x00000000000000000000FF` | `3x0000000000000000000000000000000AA` |

Set both the site and secret key — pairs must match for siteverify to work.
