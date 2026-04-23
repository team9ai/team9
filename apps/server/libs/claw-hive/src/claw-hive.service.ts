import { Injectable, Logger } from '@nestjs/common';
import { env } from '@team9/shared';

export interface HiveModelRef {
  provider: string;
  id: string;
}

export interface HiveAgentSnapshot {
  id: string;
  name: string;
  blueprintId: string;
  model: HiveModelRef;
  componentConfigs?: Record<string, Record<string, unknown>>;
  description?: string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  cacheRetention?: 'none' | 'short' | 'long';
}

/**
 * Full session detail returned by agent-pi `GET /api/sessions/:id`.
 * `modelResolution` is the three-tier snapshot:
 *   effective = sessionDynamic ?? sessionInitial ?? agentDefault
 */
export interface HiveSessionDetail {
  sessionId: string;
  agentId: string;
  agentName?: string;
  modelOverride?: HiveModelRef;
  modelResolution: {
    agentDefault: HiveModelRef;
    sessionInitial: HiveModelRef | null;
    sessionDynamic: HiveModelRef | null;
    effective: HiveModelRef;
    source: 'agent_default' | 'session_initial' | 'dynamic';
  };
  [key: string]: unknown;
}

@Injectable()
export class ClawHiveService {
  private readonly logger = new Logger(ClawHiveService.name);
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor() {
    this.baseUrl = env.CLAW_HIVE_API_URL ?? 'http://localhost:4100';
    this.authToken = env.CLAW_HIVE_AUTH_TOKEN ?? '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async registerAgent(params: {
    id: string;
    name: string;
    blueprintId: string;
    tenantId: string;
    metadata?: Record<string, unknown>;
    model: { provider: string; id: string };
    componentConfigs: Record<string, Record<string, unknown>>;
  }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/agents`, {
      method: 'POST',
      headers: this.headers(params.tenantId),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to register agent: ${res.status} ${text}`);
    }
  }

  async getAgent(
    agentId: string,
    tenantId?: string,
  ): Promise<HiveAgentSnapshot | null> {
    const res = await fetch(
      `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}`,
      { method: 'GET', headers: this.headers(tenantId) },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get agent: ${res.status} ${text}`);
    }
    return res.json() as Promise<HiveAgentSnapshot>;
  }

  async updateAgent(
    agentId: string,
    params: {
      tenantId: string;
      metadata: Record<string, unknown>;
      name?: string;
      model?: { provider: string; id: string };
      componentConfigs?: Record<string, Record<string, unknown>>;
    },
  ): Promise<void> {
    const { tenantId, metadata, name, model, componentConfigs } = params;
    const body: Record<string, unknown> = { metadata };
    if (name !== undefined) body.name = name;
    if (model !== undefined) body.model = model;
    if (componentConfigs !== undefined)
      body.componentConfigs = componentConfigs;

    const res = await fetch(
      `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}`,
      {
        method: 'PUT',
        headers: this.headers(tenantId),
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update agent: ${res.status} ${text}`);
    }
  }

  async deleteAgent(agentId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}`,
      {
        method: 'DELETE',
        headers: this.headers(),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to delete agent: ${res.status}`);
    }
  }

  async createSession(
    agentId: string,
    params: {
      userId: string;
      sessionId?: string;
      model?: { provider: string; id: string };
      team9Context?: Record<string, unknown>;
    },
    tenantId?: string,
  ): Promise<{ sessionId: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}/sessions`,
      {
        method: 'POST',
        headers: this.headers(tenantId),
        body: JSON.stringify(params),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${text}`);
    }
    return res.json() as Promise<{ sessionId: string }>;
  }

  async getSession(
    sessionId: string,
    tenantId?: string,
  ): Promise<HiveSessionDetail | null> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET', headers: this.headers(tenantId) },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get session: ${res.status} ${text}`);
    }
    return res.json() as Promise<HiveSessionDetail>;
  }

  /**
   * Switch the LLM model of a running session. Delivered as a
   * `session.model_override` event via the existing input queue — the worker
   * handles it directly (no agent loop, no LLM roundtrip, history preserved).
   */
  async changeSessionModel(
    sessionId: string,
    model: { provider: string; id: string },
    tenantId?: string,
  ): Promise<void> {
    await this.sendInput(
      sessionId,
      {
        type: 'session.model_override',
        source: 'team9',
        timestamp: new Date().toISOString(),
        payload: { model },
      },
      tenantId,
    );
  }

  async sendInput(
    sessionId: string,
    event: {
      type: string;
      source: string;
      timestamp: string;
      payload: Record<string, unknown>;
    },
    tenantId?: string,
    timeoutMs = 30_000,
  ): Promise<{ messages: unknown[] }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(
        `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/input`,
        {
          method: 'POST',
          headers: this.headers(tenantId),
          body: JSON.stringify({ event }),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to send input: ${res.status} ${text}`);
      }
      return res.json() as Promise<{ messages: unknown[] }>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async registerAgents(params: {
    agents: Array<{
      id: string;
      name: string;
      blueprintId: string;
      tenantId: string;
      metadata?: Record<string, unknown>;
      model: { provider: string; id: string };
      componentConfigs: Record<string, Record<string, unknown>>;
    }>;
    atomic?: boolean;
  }): Promise<{
    results: Array<{ id: string; status: string; error?: string }>;
    hasErrors: boolean;
  }> {
    const res = await fetch(`${this.baseUrl}/api/agents/batch`, {
      method: 'POST',
      headers: this.headers(params.agents[0]?.tenantId),
      body: JSON.stringify({
        agents: params.agents,
        atomic: params.atomic,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to batch register agents: ${res.status} ${text}`);
    }
    return res.json() as Promise<{
      results: Array<{ id: string; status: string; error?: string }>;
      hasErrors: boolean;
    }>;
  }

  async deleteAgents(agentIds: string[]): Promise<void> {
    await Promise.allSettled(agentIds.map((id) => this.deleteAgent(id)));
  }

  /** Interrupt (pause) a running session. */
  async interruptSession(sessionId: string, tenantId?: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      { method: 'POST', headers: this.headers(tenantId) },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to interrupt session: ${res.status} ${text}`);
    }
  }

  /**
   * Set (or clear) the user-facing session title on agent-pi.
   * The server is intentionally unrestricted — overwrite/idempotency
   * policy is team9's job. Callers typically only write when they
   * know the session has no title yet (first-turn title generation),
   * but the endpoint tolerates repeat calls safely.
   */
  async updateSessionTitle(
    sessionId: string,
    title: string | null,
    tenantId?: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'PATCH',
        headers: this.headers(tenantId),
        body: JSON.stringify({ title }),
      },
    );
    // 404 is tolerated — session may have been deleted concurrently
    // (e.g. user archived the topic before title generation completed).
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Failed to update session title: ${res.status} ${text}`);
    }
  }

  /** Delete (terminate) a session. Swallows 404 (session already gone). */
  async deleteSession(sessionId: string, tenantId?: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE', headers: this.headers(tenantId) },
    );
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Failed to delete session: ${res.status} ${text}`);
    }
  }

  private headers(tenantId?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Hive-Auth': this.authToken,
      ...(tenantId ? { 'X-Hive-Tenant': tenantId } : {}),
    };
  }
}
