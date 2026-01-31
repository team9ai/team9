import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { env } from '@team9/shared';
import type { BotInfo } from '../bot/bot.service.js';

// ── Request / Response types ───────────────────────────────────────────

export interface CreateInstanceRequest {
  user_id: string;
  subdomain?: string;
  env?: Record<string, string>;
}

export interface Instance {
  id: string;
  user_id: string;
  subdomain: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  provider: string;
  running_instance_info?: Record<string, any>;
  custom_env?: Record<string, string>;
  tunnel_id?: string;
  volume_id?: string;
  dns_record_id?: string;
  access_url: string;
  created_at: string;
  last_heartbeat?: string;
}

export interface CreateInstanceResponse {
  instance: Instance;
  access_url: string;
}

// ── Service ────────────────────────────────────────────────────────────

@Injectable()
export class OpenclawService {
  private readonly logger = new Logger(OpenclawService.name);

  private get apiUrl(): string | undefined {
    return env.OPENCLAW_API_URL;
  }

  private get authToken(): string | undefined {
    return env.OPENCLAW_AUTH_TOKEN;
  }

  /**
   * Whether the OpenClaw integration is configured.
   * If false, all API calls will be skipped gracefully.
   */
  isConfigured(): boolean {
    return !!this.apiUrl;
  }

  // ── Event listeners ──────────────────────────────────────────────────

  @OnEvent('bot.created')
  async handleBotCreated(botInfo: BotInfo): Promise<void> {
    try {
      const result = await this.createInstance(botInfo.userId, botInfo.botId);
      if (result) {
        this.logger.log(
          `OpenClaw instance created for bot ${botInfo.userId}: ${result.access_url}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to create OpenClaw instance for bot ${botInfo.userId}:`,
        error,
      );
    }
  }

  // ── API methods ────────────────────────────────────────────────────

  /**
   * Create a new compute instance for the given user.
   */
  async createInstance(
    userId: string,
    subdomain?: string,
    customEnv?: Record<string, string>,
  ): Promise<CreateInstanceResponse | null> {
    if (!this.isConfigured()) {
      this.logger.debug('OpenClaw not configured, skipping createInstance');
      return null;
    }

    const body: CreateInstanceRequest = {
      user_id: userId,
      ...(subdomain && { subdomain }),
      ...(customEnv && { env: customEnv }),
    };

    return this.request<CreateInstanceResponse>('POST', '/api/instances', body);
  }

  /**
   * Get an instance by ID.
   */
  async getInstance(id: string): Promise<Instance | null> {
    if (!this.isConfigured()) return null;
    return this.request<Instance>('GET', `/api/instances/${id}`);
  }

  /**
   * List all instances.
   */
  async listInstances(): Promise<Instance[] | null> {
    if (!this.isConfigured()) return null;
    return this.request<Instance[]>('GET', '/api/instances');
  }

  /**
   * Delete an instance by ID.
   */
  async deleteInstance(id: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request('DELETE', `/api/instances/${id}`);
  }

  /**
   * Start a stopped instance.
   */
  async startInstance(id: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request('POST', `/api/instances/${id}/start`);
  }

  /**
   * Stop a running instance.
   */
  async stopInstance(id: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request('POST', `/api/instances/${id}/stop`);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `OpenClaw API error: ${method} ${path} responded ${res.status} — ${text}`,
      );
    }

    // DELETE / start / stop may return 204 No Content
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as unknown as T;
    }

    return (await res.json()) as T;
  }
}
