# Team9 Auth Validation Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenClaw Hive control-plane token introspection with a Team9-owned bot-token validation endpoint that returns `botId`, `userId`, and `tenantId`, then migrate `capability-hub` to the new contract with Redis-backed auth caching.

**Architecture:** Team9 gateway becomes the sole authority for `t9bot_*` token validation. A small cache service hashes raw tokens into Redis keys, caches positive and negative validation results, and tracks reverse indexes by `botId` for explicit invalidation. A new internal endpoint exposes this validation to `capability-hub`, which updates its global auth guard to consume the new response shape and attach Team9-native identity context to `request.user`.

**Tech Stack:** NestJS 11, Jest, Drizzle ORM, Redis (`@team9/redis`), bcrypt, Node crypto, Zod config, cross-repo integration with `capability-hub`

---

## File Structure

### Team9 repo root

`/Users/winrey/Projects/weightwave/team9`

### Capability Hub repo root

`/Users/winrey/Projects/weightwave/capability-hub`

### Planned files

| Path                                                                                        | Action | Responsibility                                                                                           |
| ------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `apps/server/apps/gateway/src/bot/bot-auth-cache.service.ts`                                | Create | Hash token keys, cache positive/negative validation results, maintain reverse index by `botId`           |
| `apps/server/apps/gateway/src/bot/bot-auth-cache.service.spec.ts`                           | Create | Unit tests for cache keying, reverse index registration, and invalidation                                |
| `apps/server/apps/gateway/src/bot/bot.service.ts`                                           | Modify | Add cache-backed `validateAccessTokenWithContext()` and invalidate auth cache on token lifecycle changes |
| `apps/server/apps/gateway/src/bot/bot.service.auth.spec.ts`                                 | Create | Focused tests for Team9 auth-context validation and invalidation triggers                                |
| `apps/server/apps/gateway/src/bot/bot.module.ts`                                            | Modify | Register `BotAuthCacheService` in the global bot module                                                  |
| `apps/server/libs/shared/src/env.ts`                                                        | Modify | Add `INTERNAL_AUTH_VALIDATION_TOKEN` getter                                                              |
| `apps/server/apps/gateway/src/internal-auth/internal-auth.module.ts`                        | Create | Nest module for the new internal auth surface                                                            |
| `apps/server/apps/gateway/src/internal-auth/internal-auth.guard.ts`                         | Create | Service-to-service bearer guard for validation endpoint                                                  |
| `apps/server/apps/gateway/src/internal-auth/internal-auth.service.ts`                       | Create | Convert Team9 bot validation result into endpoint response contract                                      |
| `apps/server/apps/gateway/src/internal-auth/internal-auth.controller.ts`                    | Create | `POST /api/v1/internal/auth/validate-bot-token` endpoint                                                 |
| `apps/server/apps/gateway/src/internal-auth/dto/validate-bot-token.dto.ts`                  | Create | Request DTO for `{ token }`                                                                              |
| `apps/server/apps/gateway/src/internal-auth/internal-auth.controller.spec.ts`               | Create | Controller tests for `400`, `401`, `404`, and success contract                                           |
| `apps/server/apps/gateway/src/app.module.ts`                                                | Modify | Wire in `InternalAuthModule`                                                                             |
| `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.ts`      | Modify | Consume `{ valid, botId, userId, tenantId }` contract instead of `instance_id`                           |
| `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts` | Create | Unit tests for new upstream contract parsing and error handling                                          |
| `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.ts`                   | Modify | Attach `id`, `userId`, `botId`, `tenantId` to `request.user`                                             |
| `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.spec.ts`              | Create | Guard tests for `request.user` shape and failure behavior                                                |

## Task 1: Create Team9 Bot Auth Cache Service

**Files:**

- Create: `apps/server/apps/gateway/src/bot/bot-auth-cache.service.ts`
- Test: `apps/server/apps/gateway/src/bot/bot-auth-cache.service.spec.ts`
- Modify: `apps/server/apps/gateway/src/bot/bot.module.ts`

- [ ] **Step 1: Write the failing cache-service tests**

```ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { RedisService } from "@team9/redis";
import { BotAuthCacheService } from "./bot-auth-cache.service.js";

describe("BotAuthCacheService", () => {
  let service: BotAuthCacheService;
  const redis = {
    get: jest.fn<any>().mockResolvedValue(null),
    set: jest.fn<any>().mockResolvedValue("OK"),
    sadd: jest.fn<any>().mockResolvedValue(1),
    smembers: jest.fn<any>().mockResolvedValue([]),
    expire: jest.fn<any>().mockResolvedValue(1),
    del: jest.fn<any>().mockResolvedValue(1),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        BotAuthCacheService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(BotAuthCacheService);
  });

  it("stores positive validation results under a sha256 token digest and registers the reverse index", async () => {
    const value = { botId: "bot-1", userId: "user-1", tenantId: "tenant-1" };

    const result = await service.getOrSetValidation(
      "t9bot_deadbeef",
      async () => value,
    );

    expect(result).toEqual(value);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
      JSON.stringify(value),
      30,
    );
    expect(redis.sadd).toHaveBeenCalledWith(
      "auth:bot-token-keys:bot-1",
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
    );
    expect(redis.expire).toHaveBeenCalledWith("auth:bot-token-keys:bot-1", 30);
  });

  it("stores invalid results with the short negative TTL", async () => {
    const result = await service.getOrSetValidation(
      "t9bot_bad",
      async () => null,
    );

    expect(result).toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
      JSON.stringify({ invalid: true }),
      5,
    );
  });

  it("invalidates all cached token digests for a bot via the reverse index", async () => {
    redis.smembers.mockResolvedValue([
      "auth:bot-token:abc",
      "auth:bot-token:def",
    ]);

    await service.invalidateBot("bot-9");

    expect(redis.smembers).toHaveBeenCalledWith("auth:bot-token-keys:bot-9");
    expect(redis.del).toHaveBeenCalledWith(
      "auth:bot-token:abc",
      "auth:bot-token:def",
      "auth:bot-token-keys:bot-9",
    );
  });
});
```

- [ ] **Step 2: Run the cache-service tests to verify they fail**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/bot/bot-auth-cache.service.spec.ts`

Expected: FAIL with `Cannot find module './bot-auth-cache.service.js'` or missing provider/method errors.

- [ ] **Step 3: Implement the cache service and register it in BotModule**

```ts
import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { RedisService } from "@team9/redis";

export interface BotAuthContext {
  botId: string;
  userId: string;
  tenantId: string;
}

@Injectable()
export class BotAuthCacheService {
  private readonly positiveTtlSeconds = 30;
  private readonly negativeTtlSeconds = 5;
  private readonly inflight = new Map<string, Promise<BotAuthContext | null>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSetValidation(
    rawToken: string,
    loader: () => Promise<BotAuthContext | null>,
  ): Promise<BotAuthContext | null> {
    const cacheKey = this.cacheKey(rawToken);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as BotAuthContext | { invalid: true };
      return "invalid" in parsed ? null : parsed;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const result = await loader();
      if (result) {
        const reverseIndexKey = this.reverseIndexKey(result.botId);
        await this.redis.set(
          cacheKey,
          JSON.stringify(result),
          this.positiveTtlSeconds,
        );
        await this.redis.sadd(reverseIndexKey, cacheKey);
        await this.redis.expire(reverseIndexKey, this.positiveTtlSeconds);
        return result;
      }
      await this.redis.set(
        cacheKey,
        JSON.stringify({ invalid: true }),
        this.negativeTtlSeconds,
      );
      return null;
    })();

    this.inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  async invalidateBot(botId: string): Promise<void> {
    const reverseIndexKey = this.reverseIndexKey(botId);
    const keys = await this.redis.smembers(reverseIndexKey);
    if (keys.length > 0) {
      await this.redis.del(...keys, reverseIndexKey);
      return;
    }
    await this.redis.del(reverseIndexKey);
  }

  private cacheKey(rawToken: string): string {
    return `auth:bot-token:${createHash("sha256").update(rawToken).digest("hex")}`;
  }

  private reverseIndexKey(botId: string): string {
    return `auth:bot-token-keys:${botId}`;
  }
}
```

```ts
import { Module, Global, forwardRef } from "@nestjs/common";
import { BOT_TOKEN_VALIDATOR } from "@team9/auth";
import { BotService } from "./bot.service.js";
import { BotTokenValidatorService } from "./bot-token-validator.service.js";
import { BotAuthCacheService } from "./bot-auth-cache.service.js";
import { BotController } from "./bot.controller.js";
import { ChannelsModule } from "../im/channels/channels.module.js";

@Global()
@Module({
  imports: [forwardRef(() => ChannelsModule)],
  controllers: [BotController],
  providers: [
    BotService,
    BotTokenValidatorService,
    BotAuthCacheService,
    {
      provide: BOT_TOKEN_VALIDATOR,
      useExisting: BotTokenValidatorService,
    },
  ],
  exports: [BotService, BotAuthCacheService, BOT_TOKEN_VALIDATOR],
})
export class BotModule {}
```

- [ ] **Step 4: Run the cache-service tests to verify they pass**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/bot/bot-auth-cache.service.spec.ts`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the cache-service changes**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add \
  apps/server/apps/gateway/src/bot/bot-auth-cache.service.ts \
  apps/server/apps/gateway/src/bot/bot-auth-cache.service.spec.ts \
  apps/server/apps/gateway/src/bot/bot.module.ts
git commit -m "feat(gateway): add bot auth cache service"
```

## Task 2: Add Cache-Backed Bot Validation With Team9 Context

**Files:**

- Modify: `apps/server/apps/gateway/src/bot/bot.service.ts`
- Create: `apps/server/apps/gateway/src/bot/bot.service.auth.spec.ts`

- [ ] **Step 1: Write focused BotService auth tests**

```ts
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DATABASE_CONNECTION } from "@team9/database";
import { ChannelsService } from "../im/channels/channels.service.js";
import { BotService } from "./bot.service.js";
import { BotAuthCacheService } from "./bot-auth-cache.service.js";

describe("BotService auth validation", () => {
  const db = {
    select: jest.fn<any>().mockReturnThis(),
    from: jest.fn<any>().mockReturnThis(),
    innerJoin: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockResolvedValue([]),
    update: jest.fn<any>().mockReturnThis(),
    set: jest.fn<any>().mockReturnThis(),
  };
  const cache = {
    getOrSetValidation: jest.fn<any>(),
    invalidateBot: jest.fn<any>().mockResolvedValue(undefined),
  };

  let service: BotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: ChannelsService,
          useValue: { deleteDirectChannelsForUser: jest.fn() },
        },
        { provide: BotAuthCacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(BotService);
  });

  it("returns botId, userId, and tenantId for a valid active bot token", async () => {
    cache.getOrSetValidation.mockImplementation(async (_token, loader) =>
      loader(),
    );
    db.where.mockResolvedValue([
      {
        botId: "bot-1",
        userId: "user-1",
        tenantId: "tenant-1",
        accessToken: "deadbeef:$2b$10$hashed",
      },
    ]);
    jest
      .spyOn(await import("bcrypt"), "compare")
      .mockResolvedValue(true as never);

    await expect(
      service.validateAccessTokenWithContext("t9bot_deadbeef"),
    ).resolves.toEqual({
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });

  it("invalidates cached auth entries when a token is revoked", async () => {
    await service.revokeAccessToken("bot-9");
    expect(cache.invalidateBot).toHaveBeenCalledWith("bot-9");
  });
});
```

- [ ] **Step 2: Run the BotService auth tests to verify they fail**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/bot/bot.service.auth.spec.ts`

Expected: FAIL because `validateAccessTokenWithContext()` and `BotAuthCacheService` integration do not exist yet.

- [ ] **Step 3: Implement Team9-context validation and cache invalidation in BotService**

```ts
export interface BotAuthValidationContext {
  botId: string;
  userId: string;
  tenantId: string;
}

constructor(
  @Inject(DATABASE_CONNECTION)
  private readonly db: PostgresJsDatabase<typeof schema>,
  private readonly eventEmitter: EventEmitter2,
  private readonly channelsService: ChannelsService,
  private readonly botAuthCache: BotAuthCacheService,
) {}

async validateAccessTokenWithContext(
  rawToken: string,
): Promise<BotAuthValidationContext | null> {
  if (!rawToken || !rawToken.startsWith('t9bot_')) return null;

  return this.botAuthCache.getOrSetValidation(rawToken, async () => {
    const rawHex = rawToken.slice(6);
    if (!rawHex) return null;

    const fingerprint = rawHex.slice(0, 8);
    const rows = await this.db
      .select({
        botId: schema.bots.id,
        userId: schema.bots.userId,
        tenantId: schema.installedApplications.tenantId,
        accessToken: schema.bots.accessToken,
      })
      .from(schema.bots)
      .innerJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(
        and(
          like(schema.bots.accessToken, `${fingerprint}:%`),
          eq(schema.bots.isActive, true),
        ),
      );

    for (const row of rows) {
      const storedHash = row.accessToken!.slice(fingerprint.length + 1);
      const isValid = await bcrypt.compare(rawHex, storedHash);
      if (isValid && row.tenantId) {
        return {
          botId: row.botId,
          userId: row.userId,
          tenantId: row.tenantId,
        };
      }
    }

    return null;
  });
}

async validateAccessToken(
  rawToken: string,
): Promise<{ userId: string; email: string; username: string } | null> {
  const context = await this.validateAccessTokenWithContext(rawToken);
  if (!context) return null;

  const [user] = await this.db
    .select({
      email: schema.users.email,
      username: schema.users.username,
    })
    .from(schema.users)
    .where(eq(schema.users.id, context.userId))
    .limit(1);

  if (!user) return null;
  return { userId: context.userId, email: user.email, username: user.username };
}

async generateAccessToken(botId: string): Promise<BotTokenResult> {
  // existing generation code...
  await this.botAuthCache.invalidateBot(botId);
  return { botId, userId: bot.userId, accessToken: rawToken };
}

async revokeAccessToken(botId: string): Promise<void> {
  await this.db
    .update(schema.bots)
    .set({ accessToken: null, updatedAt: new Date() })
    .where(eq(schema.bots.id, botId));
  await this.botAuthCache.invalidateBot(botId);
}

async deleteBotAndCleanup(botId: string): Promise<void> {
  const bot = await this.getBotById(botId);
  if (!bot) {
    throw new Error(`Bot not found: ${botId}`);
  }
  await this.botAuthCache.invalidateBot(botId);
  // existing cleanup logic...
}
```

- [ ] **Step 4: Run the BotService auth tests to verify they pass**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/bot/bot.service.auth.spec.ts`

Expected: PASS with the Team9-context validation and invalidation cases green.

- [ ] **Step 5: Commit the BotService auth-context changes**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add \
  apps/server/apps/gateway/src/bot/bot.service.ts \
  apps/server/apps/gateway/src/bot/bot.service.auth.spec.ts
git commit -m "feat(gateway): add cache-backed bot auth context validation"
```

## Task 3: Add the Internal Team9 Auth Validation Service and Guard

**Files:**

- Create: `apps/server/apps/gateway/src/internal-auth/internal-auth.module.ts`
- Create: `apps/server/apps/gateway/src/internal-auth/internal-auth.guard.ts`
- Create: `apps/server/apps/gateway/src/internal-auth/internal-auth.service.ts`
- Create: `apps/server/apps/gateway/src/internal-auth/internal-auth.service.spec.ts`
- Modify: `apps/server/libs/shared/src/env.ts`

- [ ] **Step 1: Write the failing internal-auth service tests**

```ts
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { BotService } from "../bot/bot.service.js";
import { InternalAuthService } from "./internal-auth.service.js";

describe("InternalAuthService", () => {
  let service: InternalAuthService;
  const botService = {
    validateAccessTokenWithContext: jest.fn<any>(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        InternalAuthService,
        { provide: BotService, useValue: botService },
      ],
    }).compile();
    service = module.get(InternalAuthService);
  });

  it("returns a valid Team9 auth payload for a matching bot token", async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue({
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });

    await expect(service.validateBotToken("t9bot_deadbeef")).resolves.toEqual({
      valid: true,
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });

  it("returns a uniform invalid response when the token is unknown", async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue(null);

    await expect(service.validateBotToken("t9bot_bad")).resolves.toEqual({
      valid: false,
      error: "invalid token",
    });
  });
});
```

- [ ] **Step 2: Run the internal-auth service tests to verify they fail**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/internal-auth/internal-auth.service.spec.ts`

Expected: FAIL because the module and service files do not exist yet.

- [ ] **Step 3: Implement the internal-auth service, guard, module, and env getter**

```ts
import { Injectable } from "@nestjs/common";
import { BotService } from "../bot/bot.service.js";

export interface InternalAuthValidationResponse {
  valid: boolean;
  error?: string;
  botId?: string;
  userId?: string;
  tenantId?: string;
}

@Injectable()
export class InternalAuthService {
  constructor(private readonly botService: BotService) {}

  async validateBotToken(
    token: string,
  ): Promise<InternalAuthValidationResponse> {
    const result = await this.botService.validateAccessTokenWithContext(token);
    if (!result) {
      return { valid: false, error: "invalid token" };
    }

    return {
      valid: true,
      botId: result.botId,
      userId: result.userId,
      tenantId: result.tenantId,
    };
  }
}
```

```ts
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { env } from "@team9/shared";

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers["authorization"];
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    return !!token && token === env.INTERNAL_AUTH_VALIDATION_TOKEN;
  }
}
```

```ts
import { Module } from "@nestjs/common";
import { InternalAuthService } from "./internal-auth.service.js";
import { InternalAuthGuard } from "./internal-auth.guard.js";
import { InternalAuthController } from "./internal-auth.controller.js";

@Module({
  controllers: [InternalAuthController],
  providers: [InternalAuthService, InternalAuthGuard],
})
export class InternalAuthModule {}
```

```ts
export const env = {
  // existing getters...
  get INTERNAL_AUTH_VALIDATION_TOKEN() {
    return process.env.INTERNAL_AUTH_VALIDATION_TOKEN;
  },
};
```

- [ ] **Step 4: Run the internal-auth service tests to verify they pass**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/internal-auth/internal-auth.service.spec.ts`

Expected: PASS with the valid and invalid payload cases green.

- [ ] **Step 5: Commit the internal-auth service and guard changes**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add \
  apps/server/apps/gateway/src/internal-auth/internal-auth.module.ts \
  apps/server/apps/gateway/src/internal-auth/internal-auth.guard.ts \
  apps/server/apps/gateway/src/internal-auth/internal-auth.service.ts \
  apps/server/apps/gateway/src/internal-auth/internal-auth.service.spec.ts \
  apps/server/libs/shared/src/env.ts
git commit -m "feat(gateway): add internal bot auth validation service"
```

## Task 4: Expose the Team9 Validation Endpoint and Wire It Into Gateway

**Files:**

- Create: `apps/server/apps/gateway/src/internal-auth/dto/validate-bot-token.dto.ts`
- Create: `apps/server/apps/gateway/src/internal-auth/internal-auth.controller.ts`
- Create: `apps/server/apps/gateway/src/internal-auth/internal-auth.controller.spec.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

- [ ] **Step 1: Write the failing controller tests**

```ts
import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { InternalAuthController } from "./internal-auth.controller.js";
import { InternalAuthService } from "./internal-auth.service.js";

describe("InternalAuthController", () => {
  let controller: InternalAuthController;
  const service = {
    validateBotToken: jest.fn<any>(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [InternalAuthController],
      providers: [{ provide: InternalAuthService, useValue: service }],
    }).compile();
    controller = module.get(InternalAuthController);
  });

  it("returns the success payload from InternalAuthService", async () => {
    service.validateBotToken.mockResolvedValue({
      valid: true,
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });

    await expect(
      controller.validateBotToken({ token: "t9bot_deadbeef" }),
    ).resolves.toEqual({
      valid: true,
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });

  it("rejects a missing token with BadRequestException", async () => {
    await expect(controller.validateBotToken({ token: "" })).rejects.toThrow(
      "token is required",
    );
  });
});
```

- [ ] **Step 2: Run the controller tests to verify they fail**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/internal-auth/internal-auth.controller.spec.ts`

Expected: FAIL because the controller and DTO are missing.

- [ ] **Step 3: Implement the DTO, controller, and AppModule wiring**

```ts
import { IsString, IsNotEmpty } from "class-validator";

export class ValidateBotTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
```

```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { InternalAuthGuard } from "./internal-auth.guard.js";
import { InternalAuthService } from "./internal-auth.service.js";
import { ValidateBotTokenDto } from "./dto/validate-bot-token.dto.js";

@Controller({
  path: "internal/auth",
  version: "1",
})
@UseGuards(InternalAuthGuard)
export class InternalAuthController {
  constructor(private readonly internalAuthService: InternalAuthService) {}

  @Post("validate-bot-token")
  @HttpCode(200)
  async validateBotToken(@Body() dto: ValidateBotTokenDto) {
    if (!dto.token) {
      throw new BadRequestException("token is required");
    }

    const result = await this.internalAuthService.validateBotToken(dto.token);
    if (!result.valid) {
      throw new HttpException(result, 404);
    }

    return result;
  }
}
```

```ts
import { InternalAuthModule } from "./internal-auth/internal-auth.module.js";

@Module({
  imports: [
    // existing imports...
    InternalAuthModule,
  ],
})
export class AppModule implements OnModuleInit, NestModule {}
```

- [ ] **Step 4: Run the controller tests to verify they pass**

Run: `pnpm -C /Users/winrey/Projects/weightwave/team9/apps/server/apps/gateway test -- src/internal-auth/internal-auth.controller.spec.ts src/internal-auth/internal-auth.service.spec.ts src/bot/bot-auth-cache.service.spec.ts src/bot/bot.service.auth.spec.ts`

Expected: PASS with all Team9 auth-validation tests green.

- [ ] **Step 5: Commit the endpoint and wiring changes**

```bash
cd /Users/winrey/Projects/weightwave/team9
git add \
  apps/server/apps/gateway/src/internal-auth/dto/validate-bot-token.dto.ts \
  apps/server/apps/gateway/src/internal-auth/internal-auth.controller.ts \
  apps/server/apps/gateway/src/internal-auth/internal-auth.controller.spec.ts \
  apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(gateway): expose internal bot auth validation endpoint"
```

## Task 5: Migrate Capability Hub to the New Team9 Validation Contract

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.ts`
- Create: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts`
- Modify: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.ts`
- Create: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/auth.guard.spec.ts`

- [ ] **Step 1: Write the failing Capability Hub auth tests**

```ts
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { TokenValidatorService } from "./token-validator.service";

describe("TokenValidatorService", () => {
  let service: TokenValidatorService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TokenValidatorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "AUTH_VALIDATION_URL") {
                return "http://team9.local/api/v1/internal/auth/validate-bot-token";
              }
              if (key === "AUTH_API_KEY") {
                return "shared-secret";
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get(TokenValidatorService);
  });

  it("accepts the Team9 contract and exposes botId/userId/tenantId metadata", async () => {
    global.fetch = jest.fn<any>().mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        botId: "bot-1",
        userId: "user-1",
        tenantId: "tenant-1",
      }),
    });

    await expect(service.validateToken("t9bot_deadbeef")).resolves.toEqual({
      valid: true,
      userId: "user-1",
      metadata: {
        valid: true,
        botId: "bot-1",
        userId: "user-1",
        tenantId: "tenant-1",
      },
    });
  });
});
```

```ts
import { AuthGuard } from "./auth.guard";

describe("AuthGuard", () => {
  it("attaches Team9-native identity fields to request.user", async () => {
    const validator = {
      validateToken: jest.fn<any>().mockResolvedValue({
        valid: true,
        userId: "user-1",
        metadata: {
          botId: "bot-1",
          userId: "user-1",
          tenantId: "tenant-1",
        },
      }),
    };

    const guard = new AuthGuard(
      validator as never,
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as never,
    );

    const request = {
      headers: { authorization: "Bearer t9bot_deadbeef" },
    };

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => null,
      getClass: () => null,
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as any).user).toEqual({
      id: "user-1",
      botId: "bot-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
  });
});
```

- [ ] **Step 2: Run the Capability Hub auth tests to verify they fail**

Run: `pnpm -C /Users/winrey/Projects/weightwave/capability-hub test -- src/auth/token-validator.service.spec.ts src/auth/auth.guard.spec.ts`

Expected: FAIL because the current service still expects `instance_id` and there are no auth tests yet.

- [ ] **Step 3: Implement the new Team9 contract parsing and request.user shape**

```ts
export interface TokenValidationResult {
  valid: boolean;
  error?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

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
      return { valid: false, error: `Validation service returned ${response.status}` };
    }

    const result = (await response.json()) as {
      valid?: boolean;
      error?: string;
      botId?: string;
      userId?: string;
      tenantId?: string;
    };

    return {
      valid: result.valid === true,
      error: result.error,
      userId: result.userId,
      metadata: result as Record<string, unknown>,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Validation request failed',
    };
  }
}
```

```ts
const result = await this.tokenValidator.validateToken(token);

if (!result.valid) {
  throw new UnauthorizedException(result.error || "Invalid token");
}

const metadata = result.metadata as
  | {
      botId?: string;
      userId?: string;
      tenantId?: string;
    }
  | undefined;

(request as Request & { user?: unknown }).user = {
  id: result.userId,
  botId: metadata?.botId,
  userId: metadata?.userId ?? result.userId,
  tenantId: metadata?.tenantId,
};
```

- [ ] **Step 4: Run the Capability Hub auth tests to verify they pass**

Run: `pnpm -C /Users/winrey/Projects/weightwave/capability-hub test -- src/auth/token-validator.service.spec.ts src/auth/auth.guard.spec.ts`

Expected: PASS with the new Team9 response contract parsed correctly.

- [ ] **Step 5: Commit the Capability Hub auth migration**

```bash
cd /Users/winrey/Projects/weightwave/capability-hub
git add \
  src/auth/token-validator.service.ts \
  src/auth/token-validator.service.spec.ts \
  src/auth/auth.guard.ts \
  src/auth/auth.guard.spec.ts
git commit -m "feat(auth): consume team9 bot validation contract"
```

## Task 6: Cross-Repo Verification and Cutover

**Files:**

- Modify: none
- Test: `apps/server/apps/gateway/src/internal-auth/internal-auth.controller.spec.ts`
- Test: `/Users/winrey/Projects/weightwave/capability-hub/src/auth/token-validator.service.spec.ts`

- [ ] **Step 1: Run the full targeted verification suite in Team9**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm -C apps/server/apps/gateway test -- \
  src/bot/bot-auth-cache.service.spec.ts \
  src/bot/bot.service.auth.spec.ts \
  src/internal-auth/internal-auth.service.spec.ts \
  src/internal-auth/internal-auth.controller.spec.ts
```

Expected: PASS with all Team9 auth-validation tests green.

- [ ] **Step 2: Run the full targeted verification suite in Capability Hub**

```bash
cd /Users/winrey/Projects/weightwave/capability-hub
pnpm test -- \
  src/auth/token-validator.service.spec.ts \
  src/auth/auth.guard.spec.ts
```

Expected: PASS with the Team9 response contract and `request.user` shape green.

- [ ] **Step 3: Smoke-test the endpoint contract manually**

```bash
curl -i \
  -X POST http://localhost:3000/api/v1/internal/auth/validate-bot-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INTERNAL_AUTH_VALIDATION_TOKEN" \
  -d '{"token":"t9bot_example"}'
```

Expected on invalid token:

```http
HTTP/1.1 404 Not Found
content-type: application/json; charset=utf-8

{"valid":false,"error":"invalid token"}
```

Expected on valid token:

```http
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8

{"valid":true,"botId":"...","userId":"...","tenantId":"..."}
```

- [ ] **Step 4: Switch Capability Hub environment to the Team9 endpoint**

```bash
export AUTH_VALIDATION_URL="http://localhost:3000/api/v1/internal/auth/validate-bot-token"
export AUTH_API_KEY="$INTERNAL_AUTH_VALIDATION_TOKEN"
```

Expected: Capability Hub requests authenticate through Team9 only.

- [ ] **Step 5: Commit any final verification-only adjustments**

```bash
cd /Users/winrey/Projects/weightwave/team9
git status --short

cd /Users/winrey/Projects/weightwave/capability-hub
git status --short
```

Expected: no uncommitted code changes beyond intentional implementation work.
