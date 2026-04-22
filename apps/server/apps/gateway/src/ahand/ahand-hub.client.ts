import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '@team9/shared';
import { z } from 'zod';

// ─── Hub response schemas ───────────────────────────────────────────────
//
// These shapes come from ahand-hub-core § admin routes:
//   POST   /api/admin/devices                      → device record
//   POST   /api/admin/devices/{id}/token           → { token, expiresAt }
//   POST   /api/admin/control-plane/token          → { token, expiresAt }
//   DELETE /api/admin/devices/{id}                 → (no body)
//   GET    /api/admin/devices?externalUserId=...   → device record[]
//
// We keep optional fields permissive because the hub has already grown past
// the bare MVP: `isOnline`, `lastSeenAt` etc. are advisory, and hub schema
// drift should not take the gateway down -- we prefer to log + fail closed
// on the fields the gateway actually reads.

const DeviceRecordSchema = z.object({
  deviceId: z.string(),
  publicKey: z.string().optional(),
  nickname: z.string().optional(),
  externalUserId: z.string().optional(),
  isOnline: z.boolean().optional(),
  lastSeenAt: z.string().optional(),
  createdAt: z.string().optional(),
});
export type HubDeviceRecord = z.infer<typeof DeviceRecordSchema>;

const MintedTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type HubMintedToken = z.infer<typeof MintedTokenSchema>;

const DeviceListSchema = z.array(DeviceRecordSchema);

// ─── Method inputs ──────────────────────────────────────────────────────

export interface RegisterDeviceInput {
  deviceId: string;
  publicKey: string;
  externalUserId: string;
  metadata?: Record<string, unknown>;
}

export interface MintDeviceTokenInput {
  deviceId: string;
  // Default 604800 (7d) for Tauri; pass 3600 for short-lived ops.
  ttlSeconds?: number;
}

export interface MintControlPlaneTokenInput {
  externalUserId: string;
  deviceIds?: string[];
  scope?: 'jobs:execute';
  // Default 3600 (1h).
  ttlSeconds?: number;
}

// ─── Internal request options ───────────────────────────────────────────

interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  schema?: z.ZodType<T>;
  // DELETE returns 204 with no body; skip shape validation for those.
  allowEmptyBody?: boolean;
  timeoutMs?: number;
}

/**
 * AhandHubClient is the sole in-gateway caller of ahand-hub admin endpoints.
 * Every request carries the AHAND_HUB_SERVICE_TOKEN bearer; no other code
 * reads that secret. Callers receive typed results + NestJS HTTP exceptions
 * so that controllers can rethrow without remapping.
 *
 * Retry policy: 5xx and transport errors retry up to 3 times with 200 ms,
 * 400 ms, 800 ms spacing. 4xx never retries -- surfaces the hub's body via
 * the matching NestJS exception.
 */
@Injectable()
export class AhandHubClient {
  private readonly logger = new Logger(AhandHubClient.name);

  /**
   * True if both AHAND_HUB_URL and AHAND_HUB_SERVICE_TOKEN are configured.
   * AhandModule uses this to decide whether to wire the ahand feature at all;
   * individual request methods also short-circuit via `requireConfig()`.
   */
  isConfigured(): boolean {
    return Boolean(env.AHAND_HUB_URL && env.AHAND_HUB_SERVICE_TOKEN);
  }

  async registerDevice(input: RegisterDeviceInput): Promise<HubDeviceRecord> {
    return this.request({
      method: 'POST',
      path: '/api/admin/devices',
      body: input,
      schema: DeviceRecordSchema,
    });
  }

  async mintDeviceToken(input: MintDeviceTokenInput): Promise<HubMintedToken> {
    const body = input.ttlSeconds ? { ttlSeconds: input.ttlSeconds } : {};
    return this.request({
      method: 'POST',
      path: `/api/admin/devices/${encodeURIComponent(input.deviceId)}/token`,
      body,
      schema: MintedTokenSchema,
    });
  }

  async mintControlPlaneToken(
    input: MintControlPlaneTokenInput,
  ): Promise<HubMintedToken> {
    return this.request({
      method: 'POST',
      path: '/api/admin/control-plane/token',
      body: input,
      schema: MintedTokenSchema,
    });
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.request<void>({
      method: 'DELETE',
      path: `/api/admin/devices/${encodeURIComponent(deviceId)}`,
      allowEmptyBody: true,
    });
  }

  async listDevicesForExternalUser(
    externalUserId: string,
  ): Promise<HubDeviceRecord[]> {
    return this.request({
      method: 'GET',
      path: '/api/admin/devices',
      query: { externalUserId },
      schema: DeviceListSchema,
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private requireConfig(): { baseUrl: string; token: string } {
    const baseUrl = env.AHAND_HUB_URL;
    const token = env.AHAND_HUB_SERVICE_TOKEN;
    if (!baseUrl || !token) {
      throw new ServiceUnavailableException('ahand-hub is not configured');
    }
    return { baseUrl, token };
  }

  private buildUrl(
    baseUrl: string,
    path: string,
    query?: Record<string, string>,
  ): string {
    const url = new URL(path, baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  private async request<T>(opts: RequestOptions<T>): Promise<T> {
    const { baseUrl, token } = this.requireConfig();
    const url = this.buildUrl(baseUrl, opts.path, opts.query);
    const timeoutMs = opts.timeoutMs ?? 10_000;

    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const start = Date.now();
      try {
        const response = await fetch(url, {
          method: opts.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        const elapsed = Date.now() - start;
        const text = await response.text();
        const payload: unknown = text ? safeParseJson(text) : undefined;

        if (response.status >= 200 && response.status < 300) {
          this.logger.debug(
            `ahand-hub ${opts.method} ${opts.path} -> ${response.status} in ${elapsed}ms`,
          );
          if (opts.allowEmptyBody && (text === '' || payload === undefined)) {
            return undefined as T;
          }
          return this.validateShape(opts, payload);
        }

        // 4xx: map + don't retry. 5xx: retry.
        if (response.status >= 400 && response.status < 500) {
          this.logger.warn(
            `ahand-hub ${opts.method} ${opts.path} -> ${response.status} in ${elapsed}ms`,
          );
          this.throwMapped(response.status, payload);
        }

        this.logger.warn(
          `ahand-hub ${opts.method} ${opts.path} -> ${response.status} in ${elapsed}ms (attempt ${attempt})`,
        );
        lastError = new Error(
          `ahand-hub ${opts.method} ${opts.path} returned ${response.status}`,
        );
      } catch (e) {
        if (e instanceof HttpException) throw e;
        lastError = e;
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `ahand-hub ${opts.method} ${opts.path} failed (attempt ${attempt}): ${message}`,
        );
      }

      if (attempt < 3) {
        await sleep(2 ** attempt * 100);
      }
    }

    this.logger.error(
      `ahand-hub ${opts.method} ${opts.path} retries exhausted: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
    throw new ServiceUnavailableException('ahand-hub is unavailable');
  }

  private validateShape<T>(opts: RequestOptions<T>, payload: unknown): T {
    if (!opts.schema) {
      return payload as T;
    }
    const parsed = opts.schema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error(
        `Unexpected ahand-hub response for ${opts.method} ${opts.path}: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException(
        'Unexpected ahand-hub response shape',
      );
    }
    return parsed.data;
  }

  private throwMapped(status: number, body: unknown): never {
    const message = extractMessage(body, `hub returned ${status}`);
    if (status === 403) throw new ForbiddenException(message);
    if (status === 404) throw new NotFoundException(message);
    if (status === 409) throw new ConflictException(message);
    throw new HttpException(message, status);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
