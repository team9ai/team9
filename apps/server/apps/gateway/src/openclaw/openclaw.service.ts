import { Injectable, Logger } from '@nestjs/common';
import { env } from '@team9/shared';

// ── Request / Response types ───────────────────────────────────────────

export interface CreateInstanceRequest {
  id: string;
  subdomain?: string;
  env?: Record<string, string>;
}

// ── Agent types ────────────────────────────────────────────────────────

export interface CreateAgentRequest {
  name: string;
  workspace?: string;
  model?: string;
  bindings?: string[];
  team9_token?: string;
}

export interface AgentInfo {
  agent_id: string;
  name: string;
  workspace?: string;
  model?: string;
  status?: string;
  bindings?: string[];
}

export interface SetAgentIdentityRequest {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  from_identity?: boolean;
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

  // ── API methods ────────────────────────────────────────────────────

  /**
   * Create a new compute instance for the given user.
   */
  async createInstance(
    id: string,
    subdomain?: string,
    customEnv?: Record<string, string>,
  ): Promise<CreateInstanceResponse | null> {
    if (!this.isConfigured()) {
      this.logger.debug('OpenClaw not configured, skipping createInstance');
      return null;
    }

    const body: CreateInstanceRequest = {
      id,
      subdomain,
      env: customEnv,
    };
    console.log('Creating OpenClaw instance with body:', body);
    const createResponse = await this.request<CreateInstanceResponse>(
      'POST',
      '/api/instances',
      body,
    );

    return createResponse;
  }

  /**
   * Get an instance by ID.
   */
  async getInstance(id: string): Promise<Instance | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await this.request<{ instance: Instance }>(
        'GET',
        `/api/instances/${id}`,
      );
      return res.instance;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all instances.
   */
  async listInstances(): Promise<Instance[] | null> {
    if (!this.isConfigured()) return null;
    const res = await this.request<{ instances: Instance[] }>(
      'GET',
      '/api/instances',
    );
    return res.instances;
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

  // ── Agent methods ─────────────────────────────────────────────────

  /**
   * Create a new agent in an OpenClaw instance.
   */
  async createAgent(
    instanceId: string,
    req: CreateAgentRequest,
  ): Promise<AgentInfo | null> {
    if (!this.isConfigured()) {
      this.logger.debug('OpenClaw not configured, skipping createAgent');
      return null;
    }
    return this.request<AgentInfo>(
      'POST',
      `/api/instances/${instanceId}/agents`,
      req,
    );
  }

  /**
   * List agents in an OpenClaw instance.
   */
  async listAgents(
    instanceId: string,
    bindings = false,
  ): Promise<AgentInfo[] | null> {
    if (!this.isConfigured()) return null;
    const query = bindings ? '?bindings=true' : '';
    const res = await this.request<{ agents: AgentInfo[] }>(
      'GET',
      `/api/instances/${instanceId}/agents${query}`,
    );
    return res.agents;
  }

  /**
   * Delete an agent from an OpenClaw instance.
   */
  async deleteAgent(instanceId: string, agentId: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request(
      'DELETE',
      `/api/instances/${instanceId}/agents/${agentId}`,
    );
  }

  /**
   * Set the display identity of an agent.
   */
  async setAgentIdentity(
    instanceId: string,
    agentId: string,
    req: SetAgentIdentityRequest,
  ): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request(
      'PUT',
      `/api/instances/${instanceId}/agents/${agentId}/identity`,
      req,
    );
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
