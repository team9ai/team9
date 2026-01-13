/**
 * Agent Lifecycle Service
 *
 * Manages agent creation, deletion, restoration, and configuration.
 * Handles all agent lifecycle operations using boot API (AgentFactory + Agent).
 */

import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  Blueprint,
  LLMConfig,
  ExecutionMode,
  CustomToolConfig,
  Agent,
  AgentFactory,
} from '@team9/agent-framework';
import type { AgentInstance, AgentRuntimeState } from '../types/index.js';
import { AgentExecutor } from '../executor/agent-executor.js';
import type {
  SubagentCompleteCallback,
  SubagentStepCallback,
  SubagentCreatedCallback,
} from '../executor/spawn-subagent.handler.js';
import { agents } from '../db/index.js';

/**
 * Callback invoked when an agent is created or restored
 */
export type OnAgentInitialized = (agentId: string, agent: Agent) => void;

/**
 * Configuration for AgentLifecycleService
 */
export interface AgentLifecycleServiceConfig {
  factory: AgentFactory;
  db?: PostgresJsDatabase<Record<string, never>> | null;
  externalTools?: CustomToolConfig[];
  onAgentInitialized?: OnAgentInitialized;
  /** Callback when a subagent completes */
  onSubagentComplete?: SubagentCompleteCallback;
  /** Callback for subagent step events */
  onSubagentStep?: SubagentStepCallback;
  /** Callback when a subagent is created (for setting up observers) */
  onSubagentCreated?: SubagentCreatedCallback;
}

/**
 * AgentLifecycleService manages agent creation, deletion, and restoration
 */
export class AgentLifecycleService {
  constructor(
    private state: AgentRuntimeState,
    private config: AgentLifecycleServiceConfig,
  ) {}

  /**
   * Save agent to database
   */
  private async saveAgent(agent: AgentInstance): Promise<void> {
    if (!this.config.db) return;

    const existing = await this.config.db
      .select()
      .from(agents)
      .where(eq(agents.id, agent.id))
      .limit(1);

    if (existing.length > 0) {
      await this.config.db
        .update(agents)
        .set({
          name: agent.name,
          status: agent.status,
          data: agent,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    } else {
      await this.config.db.insert(agents).values({
        id: agent.id,
        blueprintId: agent.blueprintId ?? null,
        name: agent.name,
        threadId: agent.threadId,
        status: agent.status,
        data: agent,
        createdAt: new Date(agent.createdAt),
        updatedAt: new Date(agent.updatedAt),
      });
    }
  }

  /**
   * Delete agent from database
   */
  private async deleteAgentFromDb(id: string): Promise<void> {
    if (!this.config.db) return;
    await this.config.db.delete(agents).where(eq(agents.id, id));
  }

  /**
   * Load all agents from database and restore their runtime state
   */
  async restoreAgents(): Promise<void> {
    if (!this.config.db) {
      console.log('No database configured, skipping agent restoration');
      return;
    }

    console.log('Restoring agents from database...');
    const rows = await this.config.db.select().from(agents);

    for (const row of rows) {
      const agentInstance = row.data as AgentInstance;

      try {
        // Restore agent using boot API
        const agent = await this.config.factory.restoreAgent(
          agentInstance.threadId,
        );
        this.state.agents.set(agentInstance.id, agent);

        // Notify for observer setup
        this.config.onAgentInitialized?.(agentInstance.id, agent);

        // Restore executor with tools from saved agent data
        const orchestrator = agent.getOrchestrator();
        const llmAdapter = orchestrator.getLLMAdapter();
        const executor = new AgentExecutor(orchestrator, llmAdapter, {
          tools: agentInstance.tools ?? [],
          customTools: this.config.externalTools ?? [],
        });
        this.state.executors.set(agentInstance.id, executor);

        // Add to cache
        this.state.agentsCache.set(agentInstance.id, agentInstance);
        console.log(
          `Restored agent: ${agentInstance.id} (${agentInstance.name})`,
        );
      } catch (error) {
        console.error(`Failed to restore agent ${agentInstance.id}:`, error);
      }
    }

    console.log(`Restored ${this.state.agentsCache.size} agents`);
  }

  /**
   * Create an agent from a blueprint
   */
  async createAgent(
    blueprint: Blueprint,
    modelOverride?: LLMConfig,
  ): Promise<AgentInstance> {
    const id = `agent_${createId()}`;

    // Check if blueprint has subAgents - if so, automatically include spawn_subagent tool
    const hasSubAgents =
      blueprint.subAgents && Object.keys(blueprint.subAgents).length > 0;
    let agentTools = blueprint.tools ?? [];
    if (hasSubAgents && !agentTools.includes('spawn_subagent')) {
      agentTools = [...agentTools, 'spawn_subagent'];
    }

    // Determine initial execution mode
    const executionMode: ExecutionMode = blueprint.executionMode ?? 'auto';

    // Create agent using boot API
    const agent = await this.config.factory.createAgent(blueprint, {
      llmConfigOverride: modelOverride,
      executionMode,
    });
    this.state.agents.set(id, agent);

    // Notify for observer setup
    this.config.onAgentInitialized?.(id, agent);

    // Get orchestrator and llmAdapter for AgentExecutor
    const orchestrator = agent.getOrchestrator();
    const llmAdapter = orchestrator.getLLMAdapter();

    // Get component tools from the agent
    const componentTools = agent.tools.map((t) => ({
      definition: t.definition,
      executor: t.executor,
      category: t.category,
    }));

    // Merge external tools with component tools
    const allCustomTools: CustomToolConfig[] = [
      ...(this.config.externalTools ?? []),
      ...componentTools,
    ];

    // Create agent executor for LLM response generation
    const executor = new AgentExecutor(orchestrator, llmAdapter, {
      tools: agentTools,
      customTools: allCustomTools,
      // Configure subagent support if blueprint has subAgents
      spawnSubagentConfig: hasSubAgents
        ? {
            parentBlueprint: blueprint,
            parentAgentId: id,
            factory: this.config.factory,
            onSubagentComplete: this.config.onSubagentComplete,
            onSubagentStep: this.config.onSubagentStep,
            onSubagentCreated: this.config.onSubagentCreated,
          }
        : undefined,
    });
    this.state.executors.set(id, executor);

    // Create agent instance metadata
    // Initial status is awaiting_input (waiting for first user message)
    const agentInstance: AgentInstance = {
      id,
      blueprintId: blueprint.id,
      name: blueprint.name,
      threadId: agent.threadId,
      status: 'awaiting_input',
      executionMode,
      llmConfig: blueprint.llmConfig,
      modelOverride,
      tools: agentTools,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subAgentIds: [],
    };

    this.state.agentsCache.set(id, agentInstance);

    // Persist to database
    await this.saveAgent(agentInstance);

    return agentInstance;
  }

  /**
   * Get all agents
   */
  listAgents(): AgentInstance[] {
    return Array.from(this.state.agentsCache.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.state.agentsCache.get(id);
  }

  /**
   * Delete an agent
   * @param cleanup - Optional cleanup callback for services (SSE, step history)
   */
  async deleteAgent(
    id: string,
    cleanup?: (agentId: string) => void,
  ): Promise<boolean> {
    const agentInstance = this.state.agentsCache.get(id);
    if (!agentInstance) return false;

    // Call cleanup callback if provided
    cleanup?.(id);

    // Delete thread via agent's orchestrator
    const agent = this.state.agents.get(id);
    if (agent) {
      await agent.getOrchestrator().deleteThread(agentInstance.threadId);
      this.state.agents.delete(id);
    }

    this.state.executors.delete(id);
    this.state.agentsCache.delete(id);

    // Delete from database
    await this.deleteAgentFromDb(id);

    return true;
  }

  /**
   * Update agent config (e.g., model override)
   */
  async updateConfig(
    agentId: string,
    config: { modelOverride?: LLMConfig },
  ): Promise<boolean> {
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agentInstance) return false;

    if (config.modelOverride) {
      agentInstance.modelOverride = config.modelOverride;
    }
    agentInstance.updatedAt = Date.now();

    // Persist config change
    await this.saveAgent(agentInstance);

    return true;
  }
}

/**
 * Create an agent lifecycle service instance
 */
export function createAgentLifecycleService(
  state: AgentRuntimeState,
  config: AgentLifecycleServiceConfig,
): AgentLifecycleService {
  return new AgentLifecycleService(state, config);
}
