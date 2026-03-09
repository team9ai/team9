// ── Enums ────────────────────────────────────────────────────────

export type ResourceType = "agent_computer" | "api";

export type ResourceStatus = "online" | "offline" | "error" | "configuring";

// ── Config ───────────────────────────────────────────────────────

export interface AgentComputerConfig {
  connectionType: "ahand" | "ssh" | "cloud";
  host?: string;
  port?: number;
  os?: string;
  arch?: string;
}

export interface ApiResourceConfig {
  provider: string;
  baseUrl?: string;
  apiKey: string;
  model?: string;
}

export type ResourceConfig = AgentComputerConfig | ApiResourceConfig;

// ── Authorization ────────────────────────────────────────────────

export interface ResourceAuthorization {
  granteeType: "user" | "task";
  granteeId: string;
  permissions: { level: "full" | "readonly" };
  grantedBy: string;
  grantedAt: string;
}

// ── Entity ───────────────────────────────────────────────────────

export interface Resource {
  id: string;
  tenantId: string;
  type: ResourceType;
  name: string;
  description: string | null;
  config: ResourceConfig;
  status: ResourceStatus;
  authorizations: ResourceAuthorization[];
  lastHeartbeatAt: string | null;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Usage Log ────────────────────────────────────────────────────

export interface ResourceUsageLog {
  id: string;
  resourceId: string;
  actorType: "agent" | "user";
  actorId: string;
  taskId: string | null;
  executionId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ── DTOs ─────────────────────────────────────────────────────────

export interface CreateResourceDto {
  type: ResourceType;
  name: string;
  description?: string;
  config: Record<string, unknown>;
}

export interface UpdateResourceDto {
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  status?: ResourceStatus;
}

export interface AuthorizeResourceDto {
  granteeType: "user" | "task";
  granteeId: string;
  permissions?: { level: "full" | "readonly" };
}
