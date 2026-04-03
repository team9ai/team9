import { Injectable, Logger } from '@nestjs/common';
import { env } from '@team9/shared';

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

  async updateAgent(
    agentId: string,
    params: {
      tenantId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}`,
      {
        method: 'PUT',
        headers: this.headers(params.tenantId),
        body: JSON.stringify({ metadata: params.metadata }),
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
