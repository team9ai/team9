import type { AgentService } from './services/agent.service.js';
import type { BlueprintService } from './services/blueprint.service.js';

/**
 * Application context shared across routes
 */
export interface AppContext {
  agentService: AgentService;
  blueprintService: BlueprintService;
}

// Global context (initialized in server.ts)
let context: AppContext | null = null;

export function setContext(ctx: AppContext): void {
  context = ctx;
}

export function getContext(): AppContext {
  if (!context) {
    throw new Error('Application context not initialized');
  }
  return context;
}
