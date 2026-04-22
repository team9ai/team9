import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '@team9/shared';
import { z } from 'zod';

// ─── Response schemas ─────────────────────────────────────────────────────

const TokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

export type AhandTokenResponse = z.infer<typeof TokenResponseSchema>;

// Mirrors InternalDeviceDto from gateway's ahand-internal.controller.ts.
const DeviceSchema = z.object({
  id: z.string(),
  hubDeviceId: z.string(),
  publicKey: z.string(),
  nickname: z.string(),
  platform: z.enum(['macos', 'windows', 'linux']),
  hostname: z.string().nullable(),
  status: z.enum(['active', 'revoked']),
  isOnline: z.boolean().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});

const DeviceListSchema = z.array(DeviceSchema);

export type AhandDeviceSummary = z.infer<typeof DeviceSchema>;

/**
 * Thin wrapper around gateway's internal ahand endpoints.
 *
 * Uses `Authorization: Bearer <INTERNAL_AUTH_VALIDATION_TOKEN>` to match
 * the existing InternalAuthGuard convention on the gateway side.
 *
 * Retries 5xx up to 3 times with 200/400ms backoff; 403 short-circuits
 * immediately; malformed responses fail loudly via Zod.
 */
@Injectable()
export class AhandControlPlaneClient {
  private readonly logger = new Logger(AhandControlPlaneClient.name);

  private requireConfig(): { baseUrl: string; token: string } {
    const baseUrl = env.GATEWAY_INTERNAL_URL;
    const token = env.INTERNAL_AUTH_VALIDATION_TOKEN;
    if (!baseUrl || !token) {
      throw new ServiceUnavailableException(
        'AhandControlPlaneClient: GATEWAY_INTERNAL_URL and INTERNAL_AUTH_VALIDATION_TOKEN must be set',
      );
    }
    return { baseUrl, token };
  }

  async mintControlPlaneToken(
    userId: string,
    deviceIds?: string[],
  ): Promise<AhandTokenResponse> {
    return this.request(
      '/api/v1/internal/ahand/control-plane/token',
      { userId, deviceIds },
      TokenResponseSchema,
    );
  }

  async listDevicesForUser(
    userId: string,
    opts: { includeOffline?: boolean } = {},
  ): Promise<AhandDeviceSummary[]> {
    return this.request(
      '/api/v1/internal/ahand/devices/list-for-user',
      { userId, includeOffline: opts.includeOffline ?? true },
      DeviceListSchema,
    );
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async request<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    timeoutMs = 10_000,
  ): Promise<T> {
    const { baseUrl, token } = this.requireConfig();
    const url = `${baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        const text = await res.text();
        const data: unknown = text ? safeParseJson(text) : undefined;

        if (res.status >= 200 && res.status < 300) {
          const parsed = schema.safeParse(data);
          if (!parsed.success) {
            this.logger.error(
              `Unexpected gateway response for ${path}: ${parsed.error.message}`,
            );
            throw new InternalServerErrorException(
              'Unexpected gateway response shape',
            );
          }
          return parsed.data;
        }

        if (res.status === 403) {
          const msg =
            data && typeof data === 'object' && 'message' in data
              ? String((data as { message?: unknown }).message)
              : 'Forbidden';
          throw new ForbiddenException(msg);
        }

        if (res.status >= 400 && res.status < 500) {
          // Non-403 4xx: fail fast, do not retry.
          throw new Error(`gateway POST ${path} returned ${res.status}`);
        }

        lastError = new Error(`gateway POST ${path} returned ${res.status}`);
      } catch (e) {
        if (e instanceof ForbiddenException) throw e;
        if (e instanceof InternalServerErrorException) throw e;
        // Fast-fail non-5xx errors (e.g. our own 4xx Error above).
        if (e instanceof Error && /returned [4][0-9]{2}/.test(e.message)) {
          throw e;
        }
        lastError = e;
        this.logger.warn(
          `gateway POST ${path} attempt ${attempt} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      if (attempt < 3) {
        await sleep(2 ** attempt * 100);
      }
    }

    this.logger.error(
      `gateway POST ${path} retries exhausted: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
    throw new ServiceUnavailableException('gateway is unavailable');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
