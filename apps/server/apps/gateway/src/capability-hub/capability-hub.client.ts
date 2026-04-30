import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HubRequestOptions {
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

export interface ServiceCallerIdentity {
  userId: string;
  tenantId: string;
  botId?: string;
}

@Injectable()
export class CapabilityHubClient {
  private readonly logger = new Logger(CapabilityHubClient.name);
  private readonly baseUrl: string;
  private readonly serviceKey: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('CAPABILITY_HUB_URL');
    this.serviceKey = config.get<string>('CAPABILITY_HUB_API_KEY');
    if (!this.serviceKey) {
      this.logger.warn(
        'CAPABILITY_HUB_API_KEY is not set; service-to-service calls will fail',
      );
    }
  }

  /**
   * Build the set of headers required for service-to-service calls on
   * behalf of an end user. The capability hub AuthGuard accepts these
   * instead of a bot token when the shared service key matches.
   */
  serviceHeaders(identity: ServiceCallerIdentity): Record<string, string> {
    if (!this.serviceKey) {
      throw new Error(
        'CAPABILITY_HUB_API_KEY must be configured to call the hub on behalf of a user',
      );
    }
    const headers: Record<string, string> = {
      'x-service-key': this.serviceKey,
      'x-user-id': identity.userId,
      'x-tenant-id': identity.tenantId,
    };
    if (identity.botId) headers['x-bot-id'] = identity.botId;
    return headers;
  }

  async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: HubRequestOptions = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, {
      method,
      headers: opts.headers ?? {},
      body: opts.body ?? null,
      signal: opts.signal,
    });
  }
}
