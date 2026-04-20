# Cloudflare Turnstile Auth Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Turnstile application-layer verification on `POST /v1/auth/start` and `POST /v1/auth/google`, and delete the unused legacy `POST /v1/auth/register` and `POST /v1/auth/login` endpoints.

**Architecture:** Backend adds a new `TurnstileService` (called from `AuthService.authStart` and `AuthService.googleLogin` as the first line). Frontend renders the `@marsidev/react-turnstile` widget on the login page and attaches the resulting token to the existing `authStart` and `googleLogin` requests. Dev environments without a configured secret skip verification with a warning log; production fails fast at boot if the secret is missing.

**Tech Stack:** NestJS (backend, Jest+ts-jest for tests), `env` helper from `@team9/shared`, React 19 + TanStack Query on the frontend, `@marsidev/react-turnstile` widget, class-validator for DTO validation.

**Related spec:** [docs/superpowers/specs/2026-04-20-cloudflare-turnstile-auth-protection-design.md](../specs/2026-04-20-cloudflare-turnstile-auth-protection-design.md)

---

## Task 1: Add `CLOUDFLARE_TURNSTILE_SECRET_KEY` env getter

**Files:**

- Modify: `apps/server/libs/shared/src/env.ts`
- Modify: `apps/server/.env.example`

- [ ] **Step 1: Add the env getter**

Edit `apps/server/libs/shared/src/env.ts`. After the Google OAuth block (around line 221), add:

```ts
  // Cloudflare Turnstile (optional in non-production; required in production)
  get CLOUDFLARE_TURNSTILE_SECRET_KEY(): string | undefined {
    return process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || undefined;
  },
```

- [ ] **Step 2: Add to `.env.example`**

Append to `apps/server/.env.example`:

```
# Cloudflare Turnstile (application-layer CAPTCHA)
# Required in production. Leave blank in local dev to skip verification,
# or set to the always-pass test secret `1x0000000000000000000000000000000AA`.
CLOUDFLARE_TURNSTILE_SECRET_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/libs/shared/src/env.ts apps/server/.env.example
git commit -m "feat(auth): add CLOUDFLARE_TURNSTILE_SECRET_KEY env var"
```

---

## Task 2: Create `TurnstileService` with failing tests (TDD)

**Files:**

- Create: `apps/server/apps/gateway/src/auth/turnstile.service.ts`
- Create: `apps/server/apps/gateway/src/auth/turnstile.service.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/server/apps/gateway/src/auth/turnstile.service.spec.ts`:

```ts
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import { TurnstileService } from "./turnstile.service.js";

describe("TurnstileService", () => {
  const originalEnv = process.env;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetchSpy = jest.spyOn(globalThis, "fetch") as jest.SpiedFunction<
      typeof fetch
    >;
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  function mockSiteverify(body: Record<string, unknown>) {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  describe("constructor", () => {
    it("throws when APP_ENV=production and no secret is set", () => {
      process.env.APP_ENV = "production";
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      expect(() => new TurnstileService()).toThrow(
        /CLOUDFLARE_TURNSTILE_SECRET_KEY/,
      );
    });

    it("does not throw when APP_ENV=production and secret is set", () => {
      process.env.APP_ENV = "production";
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "real-secret";
      expect(() => new TurnstileService()).not.toThrow();
    });

    it("does not throw when APP_ENV=development without secret", () => {
      process.env.APP_ENV = "development";
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      expect(() => new TurnstileService()).not.toThrow();
    });
  });

  describe("verify()", () => {
    it("skips verification and returns when secret is not configured (dev)", async () => {
      process.env.APP_ENV = "development";
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      const service = new TurnstileService();
      await expect(
        service.verify("anything", "1.2.3.4"),
      ).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws BadRequest when token is empty and secret is configured", async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret";
      const service = new TurnstileService();
      await expect(service.verify(undefined, "1.2.3.4")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("calls siteverify with secret, token, and remoteip", async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "the-secret";
      mockSiteverify({ success: true });
      const service = new TurnstileService();
      await service.verify("the-token", "8.8.8.8");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      const body = (init as RequestInit).body as URLSearchParams;
      expect(body.toString()).toContain("secret=the-secret");
      expect(body.toString()).toContain("response=the-token");
      expect(body.toString()).toContain("remoteip=8.8.8.8");
    });

    it("throws BadRequest with errorCodes on siteverify failure", async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret";
      mockSiteverify({
        success: false,
        "error-codes": ["invalid-input-response"],
      });
      const service = new TurnstileService();
      await expect(service.verify("bad", "1.2.3.4")).rejects.toMatchObject({
        response: {
          message: "TURNSTILE_VERIFICATION_FAILED",
          errorCodes: ["invalid-input-response"],
        },
      });
    });

    it("resolves when siteverify returns success=true", async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "secret";
      mockSiteverify({ success: true });
      const service = new TurnstileService();
      await expect(service.verify("ok", "1.2.3.4")).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && pnpm jest --config apps/gateway/jest.config.ts --testPathPattern turnstile.service.spec`

Expected: FAIL with "Cannot find module './turnstile.service.js'".

- [ ] **Step 3: Implement `TurnstileService`**

Create `apps/server/apps/gateway/src/auth/turnstile.service.ts`:

```ts
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { env } from "@team9/shared";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secret: string | undefined;

  constructor() {
    this.secret = env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    if (env.APP_ENV === "production" && !this.secret) {
      throw new Error(
        "CLOUDFLARE_TURNSTILE_SECRET_KEY is required when APP_ENV=production",
      );
    }
    if (!this.secret) {
      this.logger.warn(
        "Turnstile secret not configured — auth Turnstile verification will be SKIPPED (non-production only).",
      );
    }
  }

  async verify(token: string | undefined, clientIp: string): Promise<void> {
    if (!this.secret) {
      return;
    }
    if (!token) {
      throw new BadRequestException("TURNSTILE_TOKEN_REQUIRED");
    }

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
    const body = (await res.json()) as SiteverifyResponse;

    if (!body.success) {
      this.logger.warn(
        `Turnstile verification failed: ${JSON.stringify(body["error-codes"])}`,
      );
      throw new BadRequestException({
        message: "TURNSTILE_VERIFICATION_FAILED",
        errorCodes: body["error-codes"] ?? [],
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && pnpm jest --config apps/gateway/jest.config.ts --testPathPattern turnstile.service.spec`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/auth/turnstile.service.ts apps/server/apps/gateway/src/auth/turnstile.service.spec.ts
git commit -m "feat(auth): add TurnstileService for Cloudflare siteverify"
```

---

## Task 3: Register `TurnstileService` in `AuthModule`

**Files:**

- Modify: `apps/server/apps/gateway/src/auth/auth.module.ts`

- [ ] **Step 1: Add provider**

Edit `apps/server/apps/gateway/src/auth/auth.module.ts`. Add import:

```ts
import { TurnstileService } from "./turnstile.service.js";
```

Add `TurnstileService` to the `providers` array:

```ts
providers: [AuthService, InternalAuthGuard, TurnstileService],
```

- [ ] **Step 2: Run the build to verify**

Run: `cd apps/server && pnpm build:server` (or `pnpm nest build gateway`)

Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/auth/auth.module.ts
git commit -m "feat(auth): register TurnstileService in AuthModule"
```

---

## Task 4: Add `turnstileToken` to DTOs and call `verify()` in `AuthService`

**Files:**

- Modify: `apps/server/apps/gateway/src/auth/dto/auth-start.dto.ts`
- Modify: `apps/server/apps/gateway/src/auth/dto/google-login.dto.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.controller.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Add `turnstileToken` to `AuthStartDto`**

Edit `apps/server/apps/gateway/src/auth/dto/auth-start.dto.ts`:

```ts
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class AuthStartDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsIn(["self", "invite"])
  signupSource?: "self" | "invite";

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  turnstileToken?: string;
}
```

Note: `turnstileToken` is `@IsOptional()` at the DTO layer so that the TurnstileService itself can decide between "skip in dev" vs "reject missing". The service throws `BadRequestException('TURNSTILE_TOKEN_REQUIRED')` when a secret is configured but the token is missing.

- [ ] **Step 2: Add `turnstileToken` to `GoogleLoginDto`**

Edit `apps/server/apps/gateway/src/auth/dto/google-login.dto.ts`:

```ts
import { IsString, IsNotEmpty, IsOptional, IsIn } from "class-validator";

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  credential: string;

  @IsOptional()
  @IsString()
  @IsIn(["self", "invite"])
  signupSource?: "self" | "invite";

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  turnstileToken?: string;
}
```

- [ ] **Step 3: Inject `TurnstileService` into `AuthService` and plumb `clientIp`**

Edit `apps/server/apps/gateway/src/auth/auth.service.ts`.

Add import:

```ts
import { TurnstileService } from "./turnstile.service.js";
```

Update the constructor to inject the service. Find the constructor (search for `constructor(`) and add `TurnstileService` after the existing dependencies. Example (adapt to existing list):

```ts
constructor(
  // ...existing deps...
  private readonly turnstileService: TurnstileService,
) {}
```

Change `authStart` signature to accept `clientIp` and call verify first. Locate the `authStart` method (around line 965) and modify:

```ts
async authStart(dto: AuthStartDto, clientIp: string): Promise<AuthStartResponse> {
  await this.turnstileService.verify(dto.turnstileToken, clientIp);
  // ...existing body unchanged...
}
```

Change `googleLogin` signature to accept `clientIp` and call verify first. Locate `googleLogin` (around line 588):

```ts
async googleLogin(dto: GoogleLoginDto, clientIp: string): Promise<AuthResponse> {
  await this.turnstileService.verify(dto.turnstileToken, clientIp);
  // ...existing body unchanged...
}
```

- [ ] **Step 4: Update `AuthController` to pass `clientIp`**

Edit `apps/server/apps/gateway/src/auth/auth.controller.ts`.

For `authStart`:

```ts
@Post('start')
@HttpCode(HttpStatus.OK)
async authStart(
  @Body() dto: AuthStartDto,
  @Req() req: Request,
): Promise<AuthStartResponse> {
  return this.authService.authStart(dto, this.getClientIp(req));
}
```

For `googleLogin`:

```ts
@Post('google')
@HttpCode(HttpStatus.OK)
async googleLogin(
  @Body() dto: GoogleLoginDto,
  @Req() req: Request,
): Promise<AuthResponse> {
  return this.authService.googleLogin(dto, this.getClientIp(req));
}
```

`Req` and `Request` are already imported at the top of the file — verify they are and add if missing.

- [ ] **Step 5: Update `auth.service.spec.ts` to inject and exercise TurnstileService**

Edit `apps/server/apps/gateway/src/auth/auth.service.spec.ts`. In the TestingModule setup, add a mock provider for `TurnstileService`:

```ts
import { TurnstileService } from './turnstile.service.js';

// in beforeEach, inside Test.createTestingModule({ providers: [...] })
{
  provide: TurnstileService,
  useValue: { verify: jest.fn().mockResolvedValue(undefined) },
},
```

Update every existing call site that invokes `authStart(dto)` or `googleLogin(dto)` in the spec to also pass `'127.0.0.1'` as the second arg (or a helper IP constant). Search for `authStart(` and `googleLogin(` in the file.

Add one new test inside the `authStart` describe block:

```ts
it("calls TurnstileService.verify with token and clientIp before any work", async () => {
  // ...setup minimal mocks so the method can proceed at least to the verify call...
  const verifySpy = turnstileService.verify as jest.Mock;
  await service.authStart(
    { email: "a@b.com", turnstileToken: "tok" },
    "9.9.9.9",
  );
  expect(verifySpy).toHaveBeenCalledWith("tok", "9.9.9.9");
});
```

(`turnstileService` is obtained via `module.get(TurnstileService)`.)

- [ ] **Step 6: Run tests to verify everything still passes**

Run: `cd apps/server && pnpm jest --config apps/gateway/jest.config.ts --testPathPattern auth.service.spec`

Expected: ALL PASS, including the new assertion.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/auth
git commit -m "feat(auth): verify Turnstile token in authStart and googleLogin"
```

---

## Task 5: Delete legacy `/register` and `/login` endpoints

**Files:**

- Modify: `apps/server/apps/gateway/src/auth/auth.controller.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.ts`
- Modify: `apps/server/apps/gateway/src/auth/dto/index.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.controller.spec.ts`
- Delete: `apps/server/apps/gateway/src/auth/dto/register.dto.ts`
- Delete: `apps/server/apps/gateway/src/auth/dto/login.dto.ts`

- [ ] **Step 1: Remove controller methods**

Edit `apps/server/apps/gateway/src/auth/auth.controller.ts`. Delete the entire block for `@Post('register')` and `@Post('login')` (currently lines 83-94, including the `// --- Legacy endpoints ---` comment header if no other legacy methods remain directly below; keep the `verify-email`, `poll-login`, `google`, etc. intact).

Remove unused imports at the top: `RegisterDto`, `LoginDto`, `RegisterResponse`, `LoginResponse` — delete them from both import blocks.

- [ ] **Step 2: Remove service methods**

Edit `apps/server/apps/gateway/src/auth/auth.service.ts`.

Delete the `register(dto: RegisterDto)` method (around line 206) and the `login(dto: LoginDto)` method (around line 513). Remove imports for `RegisterDto`, `LoginDto` from the `./dto/index.js` import block.

Delete the exported interfaces `RegisterResponse` (around line 68) and `LoginResponse` (around line 76). If any helper methods exist that are only called by `register()`/`login()`, leave them for now unless the TypeScript compiler flags them as unused (handled in later build step).

- [ ] **Step 3: Delete DTO files**

```bash
rm apps/server/apps/gateway/src/auth/dto/register.dto.ts
rm apps/server/apps/gateway/src/auth/dto/login.dto.ts
```

- [ ] **Step 4: Clean up DTO barrel**

Edit `apps/server/apps/gateway/src/auth/dto/index.ts` — remove these two lines:

```ts
export * from "./register.dto.js";
export * from "./login.dto.js";
```

- [ ] **Step 5: Update auth tests**

Edit `apps/server/apps/gateway/src/auth/auth.service.spec.ts`:

- Remove the `describe('register', () => { ... })` and `describe('login', () => { ... })` blocks entirely.
- Remove `RegisterDto` / `LoginDto` imports.

Edit `apps/server/apps/gateway/src/auth/auth.controller.spec.ts`:

- Remove any test referencing `controller.register(` or `controller.login(`.
- Remove stale imports.

- [ ] **Step 6: Build and run all auth tests**

Run: `cd apps/server && pnpm build:server`

Expected: compiles. If TS complains about orphaned helpers, delete them.

Run: `cd apps/server && pnpm jest --config apps/gateway/jest.config.ts --testPathPattern 'auth\\.(service|controller)\\.spec'`

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/auth
git commit -m "refactor(auth): remove unused legacy /register and /login endpoints"
```

---

## Task 6: Update frontend API types and hooks

**Files:**

- Modify: `apps/client/src/services/api/index.ts`
- Modify: `apps/client/src/hooks/useAuth.ts`

- [ ] **Step 1: Remove legacy types and API methods from `api/index.ts`**

Edit `apps/client/src/services/api/index.ts`:

Delete these interfaces:

- `RegisterRequest`
- `LoginRequest`
- `LoginResponse`
- `RegisterResponse`

Delete the `login: async (...)` method and the `register: async (...)` method in the `auth` export (lines 157-168).

- [ ] **Step 2: Add `turnstileToken` to new-flow request types**

In the same file, extend:

```ts
export interface AuthStartRequest {
  email: string;
  displayName?: string;
  signupSource?: "self" | "invite";
  turnstileToken?: string;
}

export interface GoogleLoginRequest {
  credential: string;
  signupSource?: "self" | "invite";
  turnstileToken?: string;
}
```

- [ ] **Step 3: Remove `useLogin` / `useRegister` hooks**

Edit `apps/client/src/hooks/useAuth.ts`:

- Delete `useLogin` (lines 64-69).
- Delete `useRegister` (lines 71-77).
- Remove `LoginRequest`, `RegisterRequest` from the imports at the top.

Verify no other file imports `useLogin` or `useRegister`:

```bash
cd apps/client && grep -rn "useLogin\|useRegister" src/
```

If matches appear other than `useAuth.ts`'s own definitions being removed, stop and investigate. (Expected: no remaining matches outside the deletion.)

- [ ] **Step 4: Type-check the client**

Run: `cd apps/client && pnpm tsc --noEmit` (or run the project's equivalent — check `package.json` `scripts.lint` / `scripts.typecheck`).

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/services/api/index.ts apps/client/src/hooks/useAuth.ts
git commit -m "refactor(client/auth): remove legacy login/register client API, add turnstileToken field"
```

---

## Task 7: Install and render Turnstile widget on login page

**Files:**

- Modify: `apps/client/package.json`
- Modify: `apps/client/.env.example`
- Modify: `apps/client/src/routes/login.tsx`

- [ ] **Step 1: Install the widget library**

Run: `cd apps/client && pnpm add @marsidev/react-turnstile`

Expected: installs latest version; `package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add the env var**

Edit `apps/client/.env.example`. Append:

```
# Cloudflare Turnstile site key (public). Leave blank to disable the widget in dev.
VITE_CLOUDFLARE_TURNSTILE_SITE_KEY=
```

- [ ] **Step 3: Render widget and wire token into email and Google flows**

Edit `apps/client/src/routes/login.tsx`.

Add at the top of the imports:

```ts
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
```

Near the other env-backed constants (after the `IS_TAURI` const near line 24), add:

```ts
const TURNSTILE_SITE_KEY = import.meta.env
  .VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as string | undefined;
```

Inside the main login component (the one containing `handleEmailSubmit`), add state and a ref near the other `useState` / `useRef` calls:

```ts
const turnstileRef = useRef<TurnstileInstance | null>(null);
const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
```

Update `handleEmailSubmit` (currently around line 591). Insert this guard after `setError("")`:

```ts
if (TURNSTILE_SITE_KEY && !turnstileToken) {
  setError(t("turnstileNotReady"));
  return;
}
```

Pass the token into the `authStart.mutateAsync` body:

```ts
const result = await authStart.mutateAsync({
  email,
  ...(authState === "need_display_name" ? { displayName } : {}),
  signupSource: invite ? "invite" : "self",
  ...(turnstileToken ? { turnstileToken } : {}),
});
```

After the mutation resolves or rejects (in both the success branch after `setAuthState(...)` and inside the `catch`), reset the widget so the next call gets a fresh token:

```ts
turnstileRef.current?.reset();
setTurnstileToken(null);
```

Apply the same pattern to `handleResendCode` (line 648) — insert the same guard, include `turnstileToken` in the mutation body, reset after.

Apply to `handleGoogleSuccess` (line 666) — same guard, same body addition, same reset.

Render the widget inside the email form. Locate the `<form onSubmit={handleEmailSubmit}>` block (line 959) and add just before the submit button, inside the form:

```tsx
{
  TURNSTILE_SITE_KEY && (
    <div className="flex justify-center">
      <Turnstile
        ref={turnstileRef}
        siteKey={TURNSTILE_SITE_KEY}
        options={{ action: "auth-start", theme: "auto" }}
        onSuccess={setTurnstileToken}
        onError={() => setTurnstileToken(null)}
        onExpire={() => setTurnstileToken(null)}
      />
    </div>
  );
}
```

Also render a hidden second instance (or reuse the same one) for the Google button — simplest approach: keep one widget and use its token for whichever action fires next. Since we `reset()` after each use, this is safe.

Add the translation key `turnstileNotReady` to `apps/client/src/locales/{en,zh}/auth.json` (find the existing `loginFailed` key for context):

```json
"turnstileNotReady": "Verification is still loading, please wait a moment."
```

(Adjust the Chinese translation equivalently — mirror existing wording style in `zh/auth.json`.)

- [ ] **Step 4: Manual smoke test in dev**

Run: `cd apps/client && pnpm dev:client`

Open `http://localhost:1420/login`. Without `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` set, the widget should NOT render and the form should work as before. Verify.

Now stop the dev server, set `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's always-pass test key) in `apps/client/.env`, and restart. The widget should render, auto-pass within 1-2 seconds, and the email form should submit successfully.

Verify in the Network tab that the POST to `/v1/auth/start` includes a `turnstileToken` field in the JSON body.

- [ ] **Step 5: Type-check**

Run: `cd apps/client && pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/client
git commit -m "feat(client/auth): render Cloudflare Turnstile widget on login page"
```

---

## Task 8: Document rollout steps in the spec

**Files:**

- Modify: `docs/superpowers/specs/2026-04-20-cloudflare-turnstile-auth-protection-design.md`

- [ ] **Step 1: Append rollout runbook**

Add a final section "Runbook" to the spec with the exact dashboard steps (site creation, hostname allowlist, key copy). Content:

```markdown
## Runbook: Cloudflare Dashboard setup

1. Cloudflare Dashboard → **Turnstile → Add site**.
2. Site name: `team9-app-auth`.
3. Hostnames: `app.team9.ai`, `localhost`.
4. Widget mode: **Managed**.
5. Click **Create**. Copy:
   - **Site key** → set as `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` in the frontend deployment env.
   - **Secret key** → set as `CLOUDFLARE_TURNSTILE_SECRET_KEY` in the gateway deployment env.
6. Redeploy backend first (verify logs: no "Turnstile secret not configured" warning).
7. Redeploy frontend.
8. Verify in an incognito window: widget renders, `/v1/auth/start` succeeds with token.
9. Monitor Cloudflare Turnstile Analytics + gateway logs for 24h; revert by clearing the two env vars if false-positive rate is unacceptable.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-20-cloudflare-turnstile-auth-protection-design.md
git commit -m "docs(turnstile): add Cloudflare dashboard runbook"
```

---

## Plan Self-Review Notes

- Spec coverage check:
  - Protected endpoints (`/auth/start`, `/auth/google`) — Task 4.
  - `TurnstileService` with prod-fail-fast and dev-skip semantics — Task 2.
  - DTO changes — Task 4.
  - Legacy cleanup — Task 5.
  - Frontend widget integration with reset discipline — Task 7.
  - Env vars added both sides — Task 1 & Task 7.
  - Dashboard runbook — Task 8.

- Not covered (intentional, per spec non-goals):
  - `verify-email`, `resend-verification`, `poll-login`, `refresh`, `logout` — unchanged.
  - Desktop Tauri origin — login runs in system browser, no widget work needed for Tauri itself.

- Known shortcuts:
  - `useLogin`/`useRegister` removal assumes no external call sites — Task 6 Step 3 verifies this with grep. If grep finds matches, investigate before deleting.
  - `RegisterResponse` / `LoginResponse` type deletion similarly assumes no external references.
