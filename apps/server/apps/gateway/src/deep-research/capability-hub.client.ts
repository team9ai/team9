import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HubRequestOptions {
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

@Injectable()
export class CapabilityHubClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('CAPABILITY_HUB_URL');
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
