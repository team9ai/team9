import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION, eq, sql } from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
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

// ── Device types ─────────────────────────────────────────────────────

export interface DeviceInfo {
  request_id: string;
  name?: string;
  status: string;
  [key: string]: any;
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

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

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

  // ── Device methods ──────────────────────────────────────────────────

  /**
   * List paired/pending devices for an OpenClaw instance.
   */
  async listDevices(instanceId: string): Promise<DeviceInfo[] | null> {
    if (!this.isConfigured()) return null;
    const res = await this.request<{ devices: DeviceInfo[] }>(
      'GET',
      `/api/instances/${instanceId}/devices`,
    );
    return res.devices;
  }

  /**
   * Approve a device pairing request.
   */
  async approveDevice(instanceId: string, requestId: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request('POST', `/api/instances/${instanceId}/devices/approve`, {
      request_id: requestId,
    });
  }

  /**
   * Reject a device pairing request.
   */
  async rejectDevice(instanceId: string, requestId: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.request('POST', `/api/instances/${instanceId}/devices/reject`, {
      request_id: requestId,
    });
  }

  // ── Workspace activity methods ─────────────────────────────────────

  async getWorkspaceLastMessage(workspaceId: string) {
    const result = await this.db
      .select({
        lastMessageAt: sql<string | null>`MAX(${schema.messages.createdAt})`,
        messagesLast7d: sql<number>`COUNT(CASE WHEN ${schema.messages.createdAt} > NOW() - INTERVAL '7 days' THEN 1 END)`,
      })
      .from(schema.channels)
      .leftJoin(
        schema.messages,
        eq(schema.messages.channelId, schema.channels.id),
      )
      .where(eq(schema.channels.tenantId, workspaceId));

    return {
      workspace_id: workspaceId,
      last_message_at: result[0]?.lastMessageAt ?? null,
      messages_last_7d: Number(result[0]?.messagesLast7d ?? 0),
    };
  }

  async getWorkspacesLastMessages(workspaceIds: string[]) {
    if (!workspaceIds.length) return { results: [] };

    const results = await Promise.all(
      workspaceIds.map((id) => this.getWorkspaceLastMessage(id)),
    );

    return { results };
  }

  async searchInstances(q: string) {
    if (!q.trim()) return { results: [] };

    const pattern = `%${q.trim()}%`;
    const rows = await this.db.execute(sql`
      SELECT DISTINCT
        ia.config->>'instancesId' AS instance_id,
        t.name AS workspace_name,
        t.id::text AS workspace_id,
        b.id::text AS bot_id,
        bu.username AS bot_name
      FROM im_installed_applications ia
      JOIN tenants t ON t.id = ia.tenant_id
      LEFT JOIN im_bots b ON b.installed_application_id = ia.id
      LEFT JOIN im_users bu ON bu.id = b.user_id
      WHERE ia.application_id = 'openclaw'
        AND ia.config->>'instancesId' IS NOT NULL
        AND (
          t.name ILIKE ${pattern}
          OR t.id::text ILIKE ${pattern}
          OR b.id::text ILIKE ${pattern}
          OR bu.username ILIKE ${pattern}
          OR ia.config->>'instancesId' ILIKE ${pattern}
        )
      LIMIT 50
    `);

    return {
      results: (rows as unknown as Array<Record<string, unknown>>).map(
        (row) => ({
          instance_id: row.instance_id as string,
          workspace_name: row.workspace_name as string,
          workspace_id: row.workspace_id as string,
          bot_id: (row.bot_id as string) ?? null,
          bot_name: (row.bot_name as string) ?? null,
        }),
      ),
    };
  }

  async getAllInstanceActivity() {
    const rows = await this.db.execute(sql`
      SELECT
        ia.config->>'instancesId' AS instance_id,
        t.name AS workspace_name,
        MAX(m.created_at) AS last_message_at,
        COUNT(CASE WHEN m.created_at > NOW() - INTERVAL '7 days' THEN 1 END) AS messages_last_7d
      FROM im_installed_applications ia
      JOIN tenants t ON t.id = ia.tenant_id
      LEFT JOIN im_channels c ON c.tenant_id = ia.tenant_id
      LEFT JOIN im_messages m ON m.channel_id = c.id
      WHERE ia.application_id = 'openclaw'
        AND ia.config->>'instancesId' IS NOT NULL
      GROUP BY ia.config->>'instancesId', t.name, ia.tenant_id
    `);

    return {
      results: (rows as unknown as Array<Record<string, unknown>>).map(
        (row) => ({
          instance_id: row.instance_id as string,
          workspace_name: row.workspace_name as string,
          last_message_at: row.last_message_at
            ? String(row.last_message_at)
            : null,
          messages_last_7d: Number(row.messages_last_7d ?? 0),
        }),
      ),
    };
  }

  // ── Conversation methods ──────────────────────────────────────────

  async getInstanceConversations(instanceId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        c.id AS channel_id,
        c.created_at AS channel_created_at,
        bot_user.id AS bot_user_id,
        bot_user.username AS bot_username,
        bot_user.display_name AS bot_display_name,
        bot_user.avatar_url AS bot_avatar_url,
        other_user.id AS other_user_id,
        other_user.username AS other_username,
        other_user.display_name AS other_display_name,
        other_user.avatar_url AS other_avatar_url,
        last_msg.id AS last_message_id,
        last_msg.content AS last_message_content,
        last_msg.sender_id AS last_message_sender_id,
        last_msg.created_at AS last_message_at,
        last_msg.type AS last_message_type,
        (SELECT COUNT(*) FROM im_messages WHERE channel_id = c.id AND is_deleted = false) AS message_count
      FROM im_installed_applications ia
      JOIN im_bots b ON b.installed_application_id = ia.id
      JOIN im_users bot_user ON bot_user.id = b.user_id
      JOIN im_channel_members bot_cm ON bot_cm.user_id = b.user_id AND bot_cm.left_at IS NULL
      JOIN im_channels c ON c.id = bot_cm.channel_id AND c.type = 'direct'
      JOIN im_channel_members other_cm ON other_cm.channel_id = c.id AND other_cm.user_id != b.user_id AND other_cm.left_at IS NULL
      JOIN im_users other_user ON other_user.id = other_cm.user_id
      LEFT JOIN LATERAL (
        SELECT id, content, sender_id, created_at, type
        FROM im_messages
        WHERE channel_id = c.id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 1
      ) last_msg ON true
      WHERE ia.application_id = 'openclaw'
        AND ia.config->>'instancesId' = ${instanceId}
      ORDER BY last_msg.created_at DESC NULLS LAST
      LIMIT 200
    `);

    return {
      conversations: (rows as unknown as Array<Record<string, unknown>>).map(
        (row) => ({
          channel_id: row.channel_id as string,
          channel_created_at: String(row.channel_created_at),
          bot: {
            user_id: row.bot_user_id as string,
            username: row.bot_username as string,
            display_name: (row.bot_display_name as string) ?? null,
            avatar_url: (row.bot_avatar_url as string) ?? null,
          },
          other_user: {
            user_id: row.other_user_id as string,
            username: row.other_username as string,
            display_name: (row.other_display_name as string) ?? null,
            avatar_url: (row.other_avatar_url as string) ?? null,
          },
          last_message: row.last_message_id
            ? {
                id: row.last_message_id as string,
                content: (row.last_message_content as string) ?? null,
                sender_id: (row.last_message_sender_id as string) ?? null,
                created_at: String(row.last_message_at),
                type: row.last_message_type as string,
              }
            : null,
          message_count: Number(row.message_count ?? 0),
        }),
      ),
    };
  }

  async getConversationMessages(
    instanceId: string,
    channelId: string,
    limit = 50,
    before?: string,
  ) {
    // Verify the channel belongs to a bot of this instance
    const check = await this.db.execute(sql`
      SELECT 1 FROM im_installed_applications ia
      JOIN im_bots b ON b.installed_application_id = ia.id
      JOIN im_channel_members cm ON cm.user_id = b.user_id AND cm.channel_id = ${channelId}
      WHERE ia.application_id = 'openclaw'
        AND ia.config->>'instancesId' = ${instanceId}
      LIMIT 1
    `);

    if (!check || (check as unknown as Array<unknown>).length === 0) {
      return { messages: [], has_more: false };
    }

    const fetchLimit = limit + 1;
    const rows = await this.db.execute(
      before
        ? sql`
            SELECT
              m.id, m.content, m.type, m.created_at, m.updated_at,
              m.is_edited, m.parent_id,
              u.id AS sender_id, u.username AS sender_username,
              u.display_name AS sender_display_name,
              u.avatar_url AS sender_avatar_url,
              u.user_type AS sender_type
            FROM im_messages m
            LEFT JOIN im_users u ON u.id = m.sender_id
            WHERE m.channel_id = ${channelId}
              AND m.is_deleted = false
              AND m.created_at < ${before}
            ORDER BY m.created_at DESC
            LIMIT ${fetchLimit}
          `
        : sql`
            SELECT
              m.id, m.content, m.type, m.created_at, m.updated_at,
              m.is_edited, m.parent_id,
              u.id AS sender_id, u.username AS sender_username,
              u.display_name AS sender_display_name,
              u.avatar_url AS sender_avatar_url,
              u.user_type AS sender_type
            FROM im_messages m
            LEFT JOIN im_users u ON u.id = m.sender_id
            WHERE m.channel_id = ${channelId}
              AND m.is_deleted = false
            ORDER BY m.created_at DESC
            LIMIT ${fetchLimit}
          `,
    );

    const allRows = rows as unknown as Array<Record<string, unknown>>;
    const hasMore = allRows.length > limit;
    const sliced = hasMore ? allRows.slice(0, limit) : allRows;

    return {
      messages: sliced.map((row) => ({
        id: row.id as string,
        content: (row.content as string) ?? null,
        type: row.type as string,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        is_edited: row.is_edited as boolean,
        parent_id: (row.parent_id as string) ?? null,
        sender: row.sender_id
          ? {
              id: row.sender_id as string,
              username: row.sender_username as string,
              display_name: (row.sender_display_name as string) ?? null,
              avatar_url: (row.sender_avatar_url as string) ?? null,
              user_type: row.sender_type as string,
            }
          : null,
      })),
      has_more: hasMore,
    };
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
      signal: AbortSignal.timeout(5000),
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
