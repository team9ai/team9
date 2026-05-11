export type AgentSessionBindingKind =
  | 'dm'
  | 'routine-creation'
  | 'topic-session'
  | 'routine-execution'
  | 'tracking';

export type AgentSessionUnsupportedReason =
  | 'no_bot'
  | 'not_hive_managed'
  | 'ambiguous_bot'
  | 'session_not_created';

export interface AgentSessionStatus {
  exists: boolean;
  status?: 'active' | 'disposed';
  ownedBy?: string | null;
  queueLength?: number;
  activityState?: 'active' | 'inactive';
  unavailableReason?: 'not_found' | 'agent_pi_unavailable';
}

export interface AgentSessionBindingResponse {
  channelId: string;
  channelType: string;
  kind: AgentSessionBindingKind | null;
  supported: boolean;
  unsupportedReason?: AgentSessionUnsupportedReason;
  tenantId: string | null;
  agentId: string | null;
  botUserId: string | null;
  sessionId: string | null;
  routineId?: string;
  executionId?: string;
  taskcastTaskId?: string | null;
  taskStatus?: string;
  status?: AgentSessionStatus;
}

export interface SafeSessionComponentItem {
  id: string;
  typeKey: string;
  priority?: number;
  runtimeInjectedOnly: boolean;
  schema?: unknown[];
  latestData: {
    data: Record<string, unknown>;
    capturedAtCallId: string | null;
    capturedAt: number;
  } | null;
}

export interface SafeSessionComponentsResponse {
  sessionId: string;
  components: SafeSessionComponentItem[];
}
