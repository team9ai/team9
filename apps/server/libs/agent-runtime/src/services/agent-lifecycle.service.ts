/**
 * Agent Lifecycle Service
 *
 * Manages agent creation, deletion, restoration, and configuration.
 * Handles all agent lifecycle operations.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AgentOrchestrator,
  DebugController,
  Blueprint,
  BlueprintLoader,
  LLMConfig,
  ILLMAdapter,
  ExecutionMode,
  CustomToolConfig,
} from '@team9/agent-framework';
import { ComponentRegistry } from '@team9/agent-framework';
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
export type OnAgentInitialized = (
  agentId: string,
  memoryManager: AgentOrchestrator,
) => void;

/**
 * Configuration for AgentLifecycleService
 */
export interface AgentLifecycleServiceConfig {
  createMemoryManager: (config: LLMConfig) => AgentOrchestrator;
  createDebugController: (memoryManager: AgentOrchestrator) => DebugController;
  getLLMAdapter?: () => ILLMAdapter;
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
   * Get BlueprintLoader class (dynamic import to avoid circular deps)
   */
  private async getBlueprintLoader(): Promise<typeof BlueprintLoader> {
    const { BlueprintLoader } = await import('@team9/agent-framework');
    return BlueprintLoader;
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
      const agent = row.data as AgentInstance;

      try {
        // Restore memory manager
        const memoryManager = this.config.createMemoryManager(agent.llmConfig);
        this.state.memoryManagers.set(agent.id, memoryManager);

        // Restore debug controller
        const debugController =
          this.config.createDebugController(memoryManager);
        this.state.debugControllers.set(agent.id, debugController);

        // Notify for observer setup
        this.config.onAgentInitialized?.(agent.id, memoryManager);

        // Restore executor with tools from saved agent data
        if (this.config.getLLMAdapter) {
          const llmAdapter = this.config.getLLMAdapter();
          const executor = new AgentExecutor(memoryManager, llmAdapter, {
            tools: agent.tools ?? [],
            customTools: this.config.externalTools ?? [],
          });
          this.state.executors.set(agent.id, executor);
        }

        // Add to cache
        this.state.agentsCache.set(agent.id, agent);
        console.log(`Restored agent: ${agent.id} (${agent.name})`);
      } catch (error) {
        console.error(`Failed to restore agent ${agent.id}:`, error);
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
    const llmConfig = modelOverride
      ? { ...blueprint.llmConfig, ...modelOverride }
      : blueprint.llmConfig;

    // Check if blueprint has subAgents - if so, automatically include spawn_subagent tool
    const hasSubAgents =
      blueprint.subAgents && Object.keys(blueprint.subAgents).length > 0;
    let agentTools = blueprint.tools ?? [];
    if (hasSubAgents && !agentTools.includes('spawn_subagent')) {
      agentTools = [...agentTools, 'spawn_subagent'];
    }

    // Create memory manager for this agent
    const memoryManager = this.config.createMemoryManager(llmConfig);
    this.state.memoryManagers.set(id, memoryManager);

    // Create debug controller
    const debugController = this.config.createDebugController(memoryManager);
    this.state.debugControllers.set(id, debugController);

    // Create blueprint loader and create thread
    const componentRegistry = new ComponentRegistry();
    const loader = new (await this.getBlueprintLoader())(
      memoryManager,
      componentRegistry,
    );
    const { thread, tools: componentTools } =
      await loader.createThreadFromBlueprint(blueprint);

    // Notify for observer setup
    this.config.onAgentInitialized?.(id, memoryManager);

    // Merge external tools with component tools
    const allCustomTools: CustomToolConfig[] = [
      ...(this.config.externalTools ?? []),
      ...componentTools.map((t) => ({
        definition: t.definition,
        executor: t.executor,
        category: t.category,
      })),
    ];

    // Create agent executor for LLM response generation
    if (this.config.getLLMAdapter) {
      const llmAdapter = this.config.getLLMAdapter();

      const executor = new AgentExecutor(memoryManager, llmAdapter, {
        tools: agentTools,
        customTools: allCustomTools,
        // Configure subagent support if blueprint has subAgents
        spawnSubagentConfig: hasSubAgents
          ? {
              parentBlueprint: blueprint,
              parentAgentId: id,
              createMemoryManager: async (subBlueprint) => {
                return this.config.createMemoryManager(subBlueprint.llmConfig);
              },
              createLLMAdapter: () => {
                return this.config.getLLMAdapter!();
              },
              onSubagentComplete: this.config.onSubagentComplete,
              onSubagentStep: this.config.onSubagentStep,
              onSubagentCreated: this.config.onSubagentCreated,
            }
          : undefined,
      });
      this.state.executors.set(id, executor);
    }

    // Determine initial execution mode
    const executionMode: ExecutionMode = blueprint.executionMode ?? 'auto';

    // Initialize execution mode in memory manager
    memoryManager.initializeExecutionMode(thread.id, executionMode);

    // Create agent instance
    // Initial status is awaiting_input (waiting for first user message)
    const agent: AgentInstance = {
      id,
      blueprintId: blueprint.id,
      name: blueprint.name,
      threadId: thread.id,
      status: 'awaiting_input',
      executionMode,
      llmConfig: blueprint.llmConfig,
      modelOverride,
      tools: agentTools,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subAgentIds: [],
    };

    this.state.agentsCache.set(id, agent);

    // Persist to database
    await this.saveAgent(agent);

    return agent;
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
    const agent = this.state.agentsCache.get(id);
    if (!agent) return false;

    // Call cleanup callback if provided
    cleanup?.(id);

    // Delete thread
    const memoryManager = this.state.memoryManagers.get(id);
    if (memoryManager) {
      await memoryManager.deleteThread(agent.threadId);
      this.state.memoryManagers.delete(id);
    }

    this.state.debugControllers.delete(id);
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
    const agent = this.state.agentsCache.get(agentId);
    if (!agent) return false;

    if (config.modelOverride) {
      agent.modelOverride = config.modelOverride;
    }
    agent.updatedAt = Date.now();

    // Persist config change
    await this.saveAgent(agent);

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
