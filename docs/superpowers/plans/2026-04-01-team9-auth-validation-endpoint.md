# Team9 Auth Validation Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Team9-owned internal bot-token validation endpoint, switch `capability-hub` to the new `valid/botId/userId/tenantId` contract, and verify the Redis-backed auth cache works end-to-end.

**Architecture:** Team9 gateway remains the sole source of truth for `t9bot_*` validation by reusing `BotService.validateAccessTokenWithContext()`. A small internal controller in Team9 exposes the service-to-service endpoint behind a bearer secret, while `capability-hub` updates its auth client and guard to consume Team9-native subject fields.

**Tech Stack:** NestJS 11, TypeScript, class-validator, Redis (`@team9/redis`), Jest, `supertest`, Zod config in `capability-hub`

---

**Spec:** `docs/superpowers/specs/2026-03-31-team9-auth-validation-endpoint-design.md`

**Workspace assumptions:**

- Team9 repo root: `/Users/winrey/Projects/weightwave/team9`
- capability-hub repo root: `/Users/winrey/Projects/weightwave/capability-hub`
- Current Team9 branch already includes:
  - `apps/server/apps/gateway/src/bot/bot-auth-cache.service.ts`
  - `BotService.validateAccessTokenWithContext()`

**File structure**

- Modify: `apps/server/libs/shared/src/env.ts` — add `INTERNAL_AUTH_VALIDATION_TOKEN`
- Modify: `apps/server/.env.example` — document Team9-side service secret
- Create: `apps/server/apps/gateway/src/auth/dto/validate-bot-token.dto.ts` — request body validation for the internal endpoint
- Modify: `apps/server/apps/gateway/src/auth/dto/index.ts` — export the new DTO
- Create: `apps/server/apps/gateway/src/auth/internal-auth.guard.ts` — service-to-service bearer-secret guard
- Create: `apps/server/apps/gateway/src/auth/internal-auth.controller.ts` — `POST /api/v1/internal/auth/validate-bot-token`
- Create: `apps/server/apps/gateway/src/auth/internal-auth.controller.spec.ts` — integration tests for `200/400/401/404`
- Modify: `apps/server/apps/gateway/src/auth/auth.module.ts` — register the new controller and guard
- Verify only if needed: `apps/server/apps/gateway/src/bot/bot.service.ts` — ensure endpoint uses existing context-returning validation method
- Verify only if needed: `apps/server/apps/gateway/src/bot/bot.service.auth.spec.ts` — keep cache/invalidation behavior green alongside the new endpoint
- Modify: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.ts` — parse Team9’s new response contract
- Modify: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.ts` — attach `id/userId/botId/tenantId` to `request.user`
- Create: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts` — unit tests for response parsing and failure handling
- Create: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.spec.ts` — unit tests for auth header extraction and request user population
- Modify: `/Users/winrey/Projects/weightwave/capability-hub/.env.example` — document `AUTH_VALIDATION_URL` and `AUTH_API_KEY`

### Task 1: Team9 Internal Validation Endpoint

**Files:**

- Create: `apps/server/apps/gateway/src/auth/dto/validate-bot-token.dto.ts`
- Modify: `apps/server/apps/gateway/src/auth/dto/index.ts`
- Create: `apps/server/apps/gateway/src/auth/internal-auth.guard.ts`
- Create: `apps/server/apps/gateway/src/auth/internal-auth.controller.ts`
- Create: `apps/server/apps/gateway/src/auth/internal-auth.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.module.ts`
- Modify: `apps/server/libs/shared/src/env.ts`
- Modify: `apps/server/.env.example`
- Test: `apps/server/apps/gateway/src/auth/internal-auth.controller.spec.ts`

- [ ] **Step 1: Write the failing Team9 endpoint integration test**

Create `apps/server/apps/gateway/src/auth/internal-auth.controller.spec.ts` with an app-level test that uses the real guard and a mocked `BotService`:

```ts
import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import request from "supertest";
import { BotService } from "../bot/bot.service.js";
import { InternalAuthController } from "./internal-auth.controller.js";
import { InternalAuthGuard } from "./internal-auth.guard.js";

describe("InternalAuthController (integration)", () => {
  let app: INestApplication;
  let botService: { validateAccessTokenWithContext: jest.Mock<any> };
  const originalSecret = process.env.INTERNAL_AUTH_VALIDATION_TOKEN;

  beforeEach(async () => {
    process.env.INTERNAL_AUTH_VALIDATION_TOKEN = "internal-auth-secret";
    botService = {
      validateAccessTokenWithContext: jest.fn<any>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalAuthController],
      providers: [
        InternalAuthGuard,
        { provide: BotService, useValue: botService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    if (originalSecret === undefined)
      delete process.env.INTERNAL_AUTH_VALIDATION_TOKEN;
    else process.env.INTERNAL_AUTH_VALIDATION_TOKEN = originalSecret;
    await app.close();
  });

  it("returns 200 with valid=true and Team9 auth context", async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue({
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/internal/auth/validate-bot-token")
      .set("Authorization", "Bearer internal-auth-secret")
      .send({ token: "t9bot_abcdef0123456789" })
      .expect(200);

    expect(res.body).toEqual({
      valid: true,
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });

  it("returns 404 with valid=false when the token cannot be resolved", async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post("/api/v1/internal/auth/validate-bot-token")
      .set("Authorization", "Bearer internal-auth-secret")
      .send({ token: "t9bot_missing" })
      .expect(404);

    expect(res.body).toEqual({
      valid: false,
      error: "invalid token",
    });
  });

  it("returns 401 when the service secret is missing or wrong", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/internal/auth/validate-bot-token")
      .set("Authorization", "Bearer wrong-secret")
      .send({ token: "t9bot_abcdef0123456789" })
      .expect(401);

    expect(botService.validateAccessTokenWithContext).not.toHaveBeenCalled();
  });

  it("returns 400 when token is missing", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/internal/auth/validate-bot-token")
      .set("Authorization", "Bearer internal-auth-secret")
      .send({})
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the controller spec to verify it fails**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/auth/internal-auth.controller.spec.ts
```

Expected: FAIL with module-resolution errors because `InternalAuthController`, `InternalAuthGuard`, and `ValidateBotTokenDto` do not exist yet.

- [ ] **Step 3: Implement the endpoint, DTO, env getter, and module wiring**

Create `apps/server/apps/gateway/src/auth/dto/validate-bot-token.dto.ts`:

```ts
import { IsNotEmpty, IsString, Matches } from "class-validator";

export class ValidateBotTokenDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^t9bot_[a-f0-9]+$/)
  token: string;
}
```

Update `apps/server/apps/gateway/src/auth/dto/index.ts`:

```ts
export * from "./register.dto.js";
export * from "./login.dto.js";
export * from "./refresh-token.dto.js";
export * from "./verify-email.dto.js";
export * from "./resend-verification.dto.js";
export * from "./google-login.dto.js";
export * from "./poll-login.dto.js";
export * from "./auth-start.dto.js";
export * from "./verify-code.dto.js";
export * from "./desktop-session.dto.js";
export * from "./validate-bot-token.dto.js";
```

Create `apps/server/apps/gateway/src/auth/internal-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { env } from "@team9/shared";

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers["authorization"];
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    return !!token && token === env.INTERNAL_AUTH_VALIDATION_TOKEN;
  }
}
```

Create `apps/server/apps/gateway/src/auth/internal-auth.controller.ts`:

```ts
import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { BotService } from "../bot/bot.service.js";
import { ValidateBotTokenDto } from "./dto/index.js";
import { InternalAuthGuard } from "./internal-auth.guard.js";

@Controller({
  path: "internal/auth",
  version: "1",
})
@UseGuards(InternalAuthGuard)
export class InternalAuthController {
  constructor(private readonly botService: BotService) {}

  @Post("validate-bot-token")
  async validateBotToken(
    @Body() dto: ValidateBotTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = await this.botService.validateAccessTokenWithContext(
      dto.token,
    );

    if (!context) {
      res.status(HttpStatus.NOT_FOUND);
      return {
        valid: false,
        error: "invalid token",
      };
    }

    return {
      valid: true,
      botId: context.botId,
      userId: context.userId,
      tenantId: context.tenantId,
    };
  }
}
```

Update `apps/server/apps/gateway/src/auth/auth.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller.js";
import { InternalAuthController } from "./internal-auth.controller.js";
import { AuthService } from "./auth.service.js";
import { InternalAuthGuard } from "./internal-auth.guard.js";
import { AuthModule as SharedAuthModule } from "@team9/auth";
import { EmailModule } from "@team9/email";
import { env } from "@team9/shared";

@Module({
  imports: [
    SharedAuthModule,
    EmailModule,
    JwtModule.register({
      privateKey: env.JWT_PRIVATE_KEY,
      publicKey: env.JWT_PUBLIC_KEY,
      signOptions: {
        algorithm: "ES256",
        expiresIn: env.JWT_EXPIRES_IN as any,
      },
      verifyOptions: {
        algorithms: ["ES256"],
      },
    }),
  ],
  controllers: [AuthController, InternalAuthController],
  providers: [AuthService, InternalAuthGuard],
  exports: [AuthService, SharedAuthModule],
})
export class AuthModule {}
```

Update `apps/server/libs/shared/src/env.ts`:

```ts
  get INTERNAL_AUTH_VALIDATION_TOKEN() {
    return process.env.INTERNAL_AUTH_VALIDATION_TOKEN;
  },
```

Update `apps/server/.env.example`:

```dotenv
# Internal service-to-service auth for capability-hub token validation
INTERNAL_AUTH_VALIDATION_TOKEN=replace-me
```

- [ ] **Step 4: Run Team9 endpoint tests and existing bot auth tests**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/auth/internal-auth.controller.spec.ts src/bot/bot-auth-cache.service.spec.ts src/bot/bot.service.auth.spec.ts
```

Expected: PASS. The new controller spec should pass, and the existing bot auth/cache specs should stay green, proving the endpoint is reusing the current validation path rather than bypassing it.

- [ ] **Step 5: Commit Team9 endpoint changes**

```bash
git -C /Users/winrey/Projects/weightwave/team9 add \
  apps/server/apps/gateway/src/auth/auth.module.ts \
  apps/server/apps/gateway/src/auth/internal-auth.controller.ts \
  apps/server/apps/gateway/src/auth/internal-auth.controller.spec.ts \
  apps/server/apps/gateway/src/auth/internal-auth.guard.ts \
  apps/server/apps/gateway/src/auth/dto/index.ts \
  apps/server/apps/gateway/src/auth/dto/validate-bot-token.dto.ts \
  apps/server/libs/shared/src/env.ts \
  apps/server/.env.example
git -C /Users/winrey/Projects/weightwave/team9 commit -m "feat(auth): add internal bot token validation endpoint"
```

### Task 2: capability-hub Contract Migration

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.ts`
- Modify: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.ts`
- Create: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts`
- Create: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.spec.ts`
- Test: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts`
- Test: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.spec.ts`

- [ ] **Step 1: Write failing capability-hub unit tests for the new Team9 response contract**

Create `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts`:

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TokenValidatorService } from "./token-validator.service";

describe("TokenValidatorService", () => {
  let service: TokenValidatorService;
  const originalFetch = global.fetch;

  const createModule = async (config: Record<string, unknown>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenValidatorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => config[key]),
          },
        },
      ],
    }).compile();

    service = module.get(TokenValidatorService);
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("accepts the Team9 valid/botId/userId/tenantId response", async () => {
    await createModule({
      AUTH_VALIDATION_URL:
        "http://team9.test/api/v1/internal/auth/validate-bot-token",
      AUTH_API_KEY: "shared-secret",
    });
    global.fetch = jest.fn<any>().mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        botId: "bot-1",
        userId: "user-1",
        tenantId: "tenant-1",
      }),
    });

    await expect(service.validateToken("t9bot_ok")).resolves.toEqual({
      valid: true,
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });

  it("treats valid=false as an auth failure", async () => {
    await createModule({
      AUTH_VALIDATION_URL:
        "http://team9.test/api/v1/internal/auth/validate-bot-token",
    });
    global.fetch = jest.fn<any>().mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: false,
        error: "invalid token",
      }),
    });

    await expect(service.validateToken("t9bot_bad")).resolves.toEqual({
      valid: false,
      error: "invalid token",
    });
  });
});
```

Create `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.spec.ts`:

```ts
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { TokenValidatorService } from "./token-validator.service";

function createContext(headers: Record<string, string> = {}) {
  const request: any = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  it("attaches id, userId, botId, and tenantId to request.user", async () => {
    const tokenValidator = {
      validateToken: jest.fn<any>().mockResolvedValue({
        valid: true,
        userId: "user-1",
        botId: "bot-1",
        tenantId: "tenant-1",
      }),
    } as unknown as TokenValidatorService;

    const reflector = {
      getAllAndOverride: jest.fn<any>().mockReturnValue(false),
    } as unknown as Reflector;

    const guard = new AuthGuard(tokenValidator, reflector);
    const ctx = createContext({ authorization: "Bearer t9bot_ok" });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).user).toEqual({
      id: "user-1",
      userId: "user-1",
      botId: "bot-1",
      tenantId: "tenant-1",
    });
  });

  it("throws UnauthorizedException for invalid tokens", async () => {
    const tokenValidator = {
      validateToken: jest.fn<any>().mockResolvedValue({
        valid: false,
        error: "invalid token",
      }),
    } as unknown as TokenValidatorService;

    const reflector = {
      getAllAndOverride: jest.fn<any>().mockReturnValue(false),
    } as unknown as Reflector;

    const guard = new AuthGuard(tokenValidator, reflector);
    const ctx = createContext({ authorization: "Bearer t9bot_bad" });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Run the new capability-hub auth tests to verify they fail**

Run:

```bash
cd /Users/winrey/Projects/weightwave/capability-hub
pnpm test -- auth/token-validator.service.spec.ts auth/auth.guard.spec.ts
```

Expected: FAIL because `TokenValidatorService` still expects `{ instance_id }` and `AuthGuard` still spreads legacy metadata into `request.user`.

- [ ] **Step 3: Implement the new response contract in capability-hub**

Update `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.ts`:

```ts
export interface TokenValidationResult {
  valid: boolean;
  error?: string;
  userId?: string;
  botId?: string;
  tenantId?: string;
}

type Team9ValidationPayload = {
  valid?: boolean;
  error?: string;
  userId?: string;
  botId?: string;
  tenantId?: string;
};

async validateToken(token: string): Promise<TokenValidationResult> {
  if (!token) {
    return { valid: false, error: 'Token is required' };
  }

  if (!this.validationUrl) {
    return { valid: false, error: 'No validation URL configured' };
  }

  try {
    const response = await fetch(this.validationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        valid: false,
        error: `Validation service returned ${response.status}`,
      };
    }

    const result = (await response.json()) as Team9ValidationPayload;
    if (!result.valid || !result.userId || !result.botId || !result.tenantId) {
      return {
        valid: false,
        error: result.error || 'Invalid validation response',
      };
    }

    return {
      valid: true,
      userId: result.userId,
      botId: result.botId,
      tenantId: result.tenantId,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Validation request failed',
    };
  }
}
```

Update `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.ts`:

```ts
const result = await this.tokenValidator.validateToken(token);

if (!result.valid || !result.userId || !result.botId || !result.tenantId) {
  this.logger.warn(`Token validation failed: ${result.error}`);
  throw new UnauthorizedException(result.error || "Invalid token");
}

(request as Request & { user?: unknown }).user = {
  id: result.userId,
  userId: result.userId,
  botId: result.botId,
  tenantId: result.tenantId,
};
```

- [ ] **Step 4: Run the capability-hub auth tests**

Run:

```bash
cd /Users/winrey/Projects/weightwave/capability-hub
pnpm test -- auth/token-validator.service.spec.ts auth/auth.guard.spec.ts
```

Expected: PASS. The validator should accept Team9’s `valid/botId/userId/tenantId` payload, and the guard should populate `request.user` with the new fields.

- [ ] **Step 5: Commit capability-hub auth changes**

```bash
git -C /Users/winrey/Projects/weightwave/capability-hub add \
  src/auth/token-validator.service.ts \
  src/auth/token-validator.service.spec.ts \
  src/auth/auth.guard.ts \
  src/auth/auth.guard.spec.ts
git -C /Users/winrey/Projects/weightwave/capability-hub commit -m "feat(auth): consume team9 validation contract"
```

### Task 3: Configuration, Smoke Testing, and Cutover Readiness

**Files:**

- Modify: `apps/server/.env.example`
- Modify: `/Users/winrey/Projects/weightwave/capability-hub/.env.example`
- Test: Team9 gateway auth tests
- Test: capability-hub auth tests

- [ ] **Step 1: Document the cross-service config in both repos**

Update `/Users/winrey/Projects/weightwave/capability-hub/.env.example`:

```dotenv
# Auth - Team9 internal bot token validation
AUTH_VALIDATION_URL=http://localhost:3000/api/v1/internal/auth/validate-bot-token
AUTH_API_KEY=replace-me
```

Keep the Team9 `.env.example` line added in Task 1:

```dotenv
INTERNAL_AUTH_VALIDATION_TOKEN=replace-me
```

- [ ] **Step 2: Run the targeted automated verification in both repos**

Run:

```bash
pnpm --filter @team9/gateway test -- --runInBand src/auth/internal-auth.controller.spec.ts src/bot/bot-auth-cache.service.spec.ts src/bot/bot.service.auth.spec.ts
cd /Users/winrey/Projects/weightwave/capability-hub
pnpm test -- auth/token-validator.service.spec.ts auth/auth.guard.spec.ts
```

Expected: PASS in both repos.

- [ ] **Step 3: Perform a manual Team9 endpoint smoke test**

Start Team9 gateway with:

```bash
cd /Users/winrey/Projects/weightwave/team9
INTERNAL_AUTH_VALIDATION_TOKEN=replace-me pnpm dev:server
```

In another shell, hit the new endpoint:

```bash
curl -i -X POST http://localhost:3000/api/v1/internal/auth/validate-bot-token \
  -H 'Authorization: Bearer replace-me' \
  -H 'Content-Type: application/json' \
  -d '{"token":"t9bot_example"}'
```

Expected:

- `401` if the service secret is wrong
- `404` with `{"valid":false,"error":"invalid token"}` for a fake token
- `200` with `{"valid":true,"botId":"...","userId":"...","tenantId":"..."}` for a real token

- [ ] **Step 4: Smoke test capability-hub against Team9**

Start capability-hub with:

```bash
cd /Users/winrey/Projects/weightwave/capability-hub
PORT=4000 \
AUTH_VALIDATION_URL=http://localhost:3000/api/v1/internal/auth/validate-bot-token \
AUTH_API_KEY=replace-me \
pnpm dev
```

Then call any protected capability-hub route with a real Team9 bot token:

```bash
curl -i http://localhost:4000/api/capabilities \
  -H 'Authorization: Bearer t9bot_real_token_here'
```

Expected:

- `401` when Team9 returns invalid
- `200` when Team9 validates the token and `capability-hub` accepts the request

- [ ] **Step 5: Commit config-example updates**

```bash
git -C /Users/winrey/Projects/weightwave/team9 add apps/server/.env.example
git -C /Users/winrey/Projects/weightwave/team9 commit -m "docs(server): document internal auth validation secret"

git -C /Users/winrey/Projects/weightwave/capability-hub add .env.example
git -C /Users/winrey/Projects/weightwave/capability-hub commit -m "docs(auth): document team9 validation config"
```

## Self-Review

**Spec coverage**

- Team9-owned endpoint: Task 1
- `valid/botId/userId/tenantId` contract: Task 1 and Task 2
- Redis-backed performance behavior: verified by Task 1 test command against existing cache/auth specs
- capability-hub migration: Task 2
- config and cutover readiness: Task 3

**Placeholder scan**

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Each task includes concrete file paths, commands, and code blocks.

**Type consistency**

- Team9 endpoint returns `valid`, `botId`, `userId`, `tenantId`
- capability-hub validator consumes the same property names
- capability-hub `request.user.id` is intentionally mapped to `userId`
