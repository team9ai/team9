# Remove pairCode from Desktop Login Flow

## Context

The desktop login flow (designed in `2026-03-13-slack-style-auth-redesign.md`) includes a `pairCode` — a short human-readable code displayed on both the desktop app and the browser so the user can visually confirm they're authorizing the correct session.

This is unnecessary for Team9's use case. The desktop app opens the system browser on the **same machine**, and the deep link (`team9://auth-complete`) is handled by the local OS. An attacker cannot intercept the deep link remotely. The pairCode pattern is designed for cross-device scenarios (e.g., TV login) where the browser runs on a different device than the app being authorized.

Removing pairCode simplifies the UX (no code to display or compare) and reduces implementation surface.

## Approach

Retain the polling mechanism. Remove pairCode from all layers. The `sessionId` alone identifies the desktop session. Security relies on:

1. The `sessionId` is a 32-char cryptographic random hex string — unguessable.
2. The deep link is local-only — OS routes it to the registered app on the same machine.
3. Rate limiting on session creation prevents brute-force.

## Changes

### Backend

#### `POST /v1/auth/create-desktop-session`

Response before:

```typescript
{
  sessionId: string;
  pairCode: string;
  expiresInSeconds: number;
}
```

Response after:

```typescript
{
  sessionId: string;
  expiresInSeconds: number;
}
```

- Remove pairCode generation logic.
- Redis key `im:login_session:{sessionId}` stores `{ status: 'pending' }` (no pairCode field).

#### `POST /v1/auth/complete-desktop-session`

Request before:

```typescript
{
  sessionId: string;
  pairCode: string;
}
```

Request after:

```typescript
{
  sessionId: string;
}
```

- Remove pairCode match check. Validate only that the session exists and is `pending`.

#### DTOs

- `CompleteDesktopSessionDto`: remove `pairCode` field.
- `DesktopSessionResponse` (return type): remove `pairCode` field.

#### Auth Service

- `createDesktopSession()`: remove pairCode generation (the 6-char `XXXX-XX` code). Also delete the `PAIR_CODE_CHARSET` constant and `generatePairCode()` private method.
- `completeDesktopSession()`: remove pairCode comparison.

### Frontend

#### `login.tsx` — DesktopLoginView

- Remove `pairCode` state variable.
- Remove `pending_desktop_pair_code` from localStorage (cold-start recovery).
- Update cold-start recovery condition: `if (pendingSessionId && pendingPairCode)` becomes `if (pendingSessionId)`.
- Update waiting screen condition: `if (sessionId && pairCode)` becomes `if (sessionId)`.
- Waiting screen: remove the pairCode display block. Keep spinner + "Complete sign-in in your browser" text.
- Browser URL changes from `${appUrl}/login?desktopSessionId=${sessionId}&pairCode=${pairCode}` to `${appUrl}/login?desktopSessionId=${sessionId}`.

#### `login.tsx` — WebLoginView

- Remove `pairCode` from `LoginSearch` type and `validateSearch`.
- Remove the desktop session banners entirely (both in idle and code_sent states) — they only existed to show the pairCode.
- `completeDesktopSession` call: pass only `{ sessionId }`.
- `navigateAfterAuth` and the auto-redirect `useEffect`: same change.

#### API types (`services/api/index.ts`)

- `DesktopSessionResponse`: remove `pairCode`.
- `CompleteDesktopSessionRequest`: remove `pairCode`.

#### Hooks (`hooks/useAuth.ts`)

- `useCompleteDesktopSession`: accepts `{ sessionId }` only.
- `useLoginPolling`: no change (already keyed on sessionId only).

#### i18n

- Remove keys: `pairCodeLabel`, `signingInToDesktop`.

#### Tests

- `auth.controller.spec.ts`: remove pairCode from test assertions and request bodies.
- `auth.service.spec.ts`: remove pairCode generation and validation tests.

## Sequence Diagram (Simplified)

```text
Desktop App             Browser               Server               Redis
  |                        |                     |                    |
  | POST create-desktop-   |                     |                    |
  | session                |                     |                    |
  |--------------------------------------------------------------->  |
  |                        |                     |-- write pending ->|
  | { sessionId }          |                     |                    |
  |<---------------------------------------------------------------  |
  | store sessionId        |                     |                    |
  | open /login?desktopSessionId=...             |                    |
  |------->|               |                     |                    |
  | start polling          |                     |                    |
  |                        |                     |                    |
  |                        | (user logs in via email code or Google)  |
  |                        |                     |                    |
  |                        | POST complete-      |                    |
  |                        | desktop-session     |                    |
  |                        | { sessionId }       |                    |
  |                        |-------------------->|-- write verified ->|
  |                        |                     |                    |
  |                        | team9://auth-complete?sessionId=...      |
  |<------- deep link -----|                     |                    |
  | poll -> verified       |                     |<-- read ----------|
  | store tokens, navigate |                     |                    |
```

## Files Changed

| File                                              | Change                                            |
| ------------------------------------------------- | ------------------------------------------------- |
| `apps/server/.../auth/auth.service.ts`            | Remove pairCode generation and validation         |
| `apps/server/.../auth/auth.controller.ts`         | No structural change (endpoints stay the same)    |
| `apps/server/.../auth/dto/desktop-session.dto.ts` | Remove pairCode field from DTO                    |
| `apps/server/.../auth/dto/index.ts`               | No change (exports stay the same)                 |
| `apps/client/src/routes/login.tsx`                | Remove pairCode state, display, URL param, banner |
| `apps/client/src/services/api/index.ts`           | Remove pairCode from types                        |
| `apps/client/src/hooks/useAuth.ts`                | Adjust completeDesktopSession param type          |
| `apps/client/src/i18n/locales/en/auth.json`       | Remove pairCode-related keys                      |
| `apps/client/src/i18n/locales/zh/auth.json`       | Remove pairCode-related keys                      |
| `apps/server/.../auth/auth.controller.spec.ts`    | Remove pairCode from tests                        |
| `apps/server/.../auth/auth.service.spec.ts`       | Remove pairCode from tests                        |

## Notes

- `useDeepLink.ts` does **not** need changes — it already only stores `pending_desktop_session_id` (no pairCode involvement).
- The original spec (`2026-03-13-slack-style-auth-redesign.md`) references pairCode in multiple places (Redis data model, sequence diagrams, resolved decisions). It should be updated to reflect the removal after implementation is complete.
- Backward compatibility: since this feature has not shipped to production yet, there are no old clients that might still send pairCode. No backward-compat shim needed.

## Verification

1. Desktop login: click "Sign in with Browser" -> browser opens -> complete email/Google login -> desktop app logs in automatically.
2. Desktop session expiry: wait 30 min -> desktop shows "Session expired" -> retry works.
3. Cold-start recovery: quit desktop during login -> finish in browser -> deep link relaunches app -> polling resumes -> logged in.
4. Web-only login: no change to behavior (pairCode was never shown in pure web flow).
