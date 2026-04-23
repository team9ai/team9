import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '@team9/shared';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
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
    if (env.APP_ENV === 'production' && !this.secret) {
      throw new Error(
        'CLOUDFLARE_TURNSTILE_SECRET_KEY is required when APP_ENV=production',
      );
    }
    if (!this.secret) {
      this.logger.warn(
        'Turnstile secret not configured — auth Turnstile verification will be SKIPPED (non-production only).',
      );
    }
  }

  async verify(token: string | undefined, clientIp: string): Promise<void> {
    if (!this.secret) {
      return;
    }
    if (!token) {
      throw new BadRequestException('TURNSTILE_TOKEN_REQUIRED');
    }

    let body: SiteverifyResponse;
    try {
      const res = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: this.secret,
            response: token,
            remoteip: clientIp,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      body = (await res.json()) as SiteverifyResponse;
    } catch (err) {
      this.logger.warn(
        `Turnstile siteverify unreachable [ip=${clientIp}]: ${err}`,
      );
      throw new ServiceUnavailableException('TURNSTILE_SITEVERIFY_UNAVAILABLE');
    }

    if (!body.success) {
      this.logger.warn(
        `Turnstile verification failed [ip=${clientIp}]: ${JSON.stringify(body['error-codes'])}`,
      );
      throw new BadRequestException({
        message: 'TURNSTILE_VERIFICATION_FAILED',
        errorCodes: body['error-codes'] ?? [],
      });
    }
  }
}
