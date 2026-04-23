// ── Enums ────────────────────────────────────────────────────────

export type ResourceType =
  | "agent_computer"
  | "api"
  | "llm"
  | "mcp"
  | "database"
  | "browser"
  | "knowledge_base"
  | "sandbox"
  | "webhook"
  | "mail_calendar";

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

export interface LlmResourceConfig {
  provider: "openai" | "anthropic" | "google" | "deepseek" | "ollama" | string;
  model: string;
  contextLength?: number;
  apiKey?: string;
}

export interface McpResourceConfig {
  endpoint: string;
  transport: "stdio" | "sse" | "http";
  tools?: number;
}

export interface DatabaseResourceConfig {
  engine: "postgres" | "mysql" | "mongodb" | "redis";
  host: string;
  port?: number;
  database?: string;
}

export interface BrowserResourceConfig {
  kind: "playwright" | "remote" | "cdp";
  version?: string;
  endpoint?: string;
}

export interface KnowledgeBaseResourceConfig {
  store: "pinecone" | "qdrant" | "pgvector" | "local";
  docs?: number;
  dimensions?: number;
}

export interface SandboxResourceConfig {
  provider: "e2b" | "modal" | "fly" | "custom";
  runtime: "python" | "node" | "bash" | "deno";
}

export interface WebhookResourceConfig {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  secret?: string;
}

export interface MailCalendarResourceConfig {
  service: "gmail" | "outlook" | "google_calendar" | "ical";
  account: string;
}

export type ResourceConfig =
  | AgentComputerConfig
  | ApiResourceConfig
  | LlmResourceConfig
  | McpResourceConfig
  | DatabaseResourceConfig
  | BrowserResourceConfig
  | KnowledgeBaseResourceConfig
  | SandboxResourceConfig
  | WebhookResourceConfig
  | MailCalendarResourceConfig;

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
