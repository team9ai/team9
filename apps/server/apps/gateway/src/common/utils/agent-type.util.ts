import type { ManagedMeta } from '@team9/database/schemas';

export type AgentType = 'base_model' | 'openclaw';

interface AgentTypeSource {
  userType?: 'human' | 'bot' | 'system' | null;
  applicationId?: string | null;
  managedProvider?: string | null;
  managedMeta?: ManagedMeta | null;
}

export function resolveAgentTypeByApplicationId(
  applicationId: string | null | undefined,
): AgentType | null {
  if (applicationId === 'base-model-staff') {
    return 'base_model';
  }

  if (applicationId === 'openclaw') {
    return 'openclaw';
  }

  return null;
}

export function resolveAgentType({
  userType,
  applicationId,
  managedProvider,
  managedMeta,
}: AgentTypeSource): AgentType | null {
  if (userType !== 'bot') {
    return null;
  }

  const agentTypeFromApp = resolveAgentTypeByApplicationId(applicationId);
  if (agentTypeFromApp) {
    return agentTypeFromApp;
  }

  if (managedProvider === 'openclaw') {
    return 'openclaw';
  }

  const agentId =
    managedMeta &&
    typeof managedMeta === 'object' &&
    typeof managedMeta.agentId === 'string'
      ? managedMeta.agentId
      : null;

  if (managedProvider === 'hive' && agentId?.startsWith('base-model-')) {
    return 'base_model';
  }

  return null;
}
