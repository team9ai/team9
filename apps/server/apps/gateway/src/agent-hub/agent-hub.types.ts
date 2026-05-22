import type { HiveModelRef } from '@team9/claw-hive';

export const AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY =
  'agent-hub:team9-prefab-staff:v1';
export const AGENT_HUB_RECOMMENDED_STAFF_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const AGENT_HUB_RECOMMENDED_STAFF_FRESH_MS = 5 * 60 * 1000;
export const DEFAULT_RECOMMENDED_STAFF_MODEL: HiveModelRef = {
  provider: 'openrouter',
  id: 'anthropic/claude-sonnet-4.6',
};

export interface Team9PrefabStaffMetadata {
  displayName?: string;
  roleTitle: string;
  shortRoleTitle?: string;
  persona?: string;
  jobDescription?: string;
  avatarUrl?: string;
  model?: HiveModelRef;
  unique?: boolean;
}

export interface CachedRecommendedStaffTemplate {
  templateId: string;
  name: string;
  description: string | null;
  displayName: string;
  roleTitle: string;
  shortRoleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: HiveModelRef;
  blueprintId: string;
  componentConfigs: Record<string, Record<string, unknown>>;
  unique: boolean;
}

export interface RecommendedStaffTemplate {
  templateId: string;
  name: string;
  description: string | null;
  displayName: string;
  roleTitle: string;
  shortRoleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: HiveModelRef;
  unique: boolean;
  installed: boolean;
  installedBotId?: string;
}

export interface RecommendedStaffCachePayload {
  cachedAt: string;
  templates: CachedRecommendedStaffTemplate[];
}
