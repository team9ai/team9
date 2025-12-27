import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  MemoryManager,
  MemoryState,
  MemoryObserver,
  DebugController,
  Blueprint,
  BlueprintLoader,
  LLMConfig,
  AgentEvent,
  DispatchResult,
  ILLMAdapter,
} from '@team9/agent-framework';
import type {
  AgentInstance,
  AgentStatus,
  SSEMessage,
  SSEEventType,
} from '../types/index.js';
import { AgentExecutor, ExecutionResult } from '../executor/agent-executor.js';
import { agents } from '../db/index.js';

/**
 * Subscriber callback for SSE events
 */
export type SSESubscriber = (message: SSEMessage) => void;

/**
 * AgentService manages agent instances and their lifecycle
 */
export class AgentService {
  private agentsCache = new Map<string, AgentInstance>();
  private memoryManagers = new Map<string, MemoryManager>();
  private debugControllers = new Map<string, DebugController>();
  private executors = new Map<string, AgentExecutor>();
  private sseSubscribers = new Map<string, Set<SSESubscriber>>();
  private observers = new Map<string, () => void>(); // Cleanup functions

  constructor(
    private createMemoryManager: (config: LLMConfig) => MemoryManager,
    private createDebugController: (
      memoryManager: MemoryManager,
    ) => DebugController,
    private getLLMAdapter?: () => ILLMAdapter,
    private db?: PostgresJsDatabase<Record<string, never>> | null,
  ) {}

  /**
   * Save agent to database
   */
  private async saveAgent(agent: AgentInstance): Promise<void> {
    if (!this.db) return;

    const existing = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agent.id))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(agents)
        .set({
          name: agent.name,
          status: agent.status,
          data: agent,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    } else {
      await this.db.insert(agents).values({
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
    if (!this.db) return;
    await this.db.delete(agents).where(eq(agents.id, id));
  }

  /**
   * Load all agents from database and restore their runtime state
   */
  async restoreAgents(): Promise<void> {
    if (!this.db) {
      console.log('No database configured, skipping agent restoration');
      return;
    }

    console.log('Restoring agents from database...');
    const rows = await this.db.select().from(agents);

    for (const row of rows) {
      const agent = row.data as AgentInstance;

      try {
        // Restore memory manager
        const memoryManager = this.createMemoryManager(agent.llmConfig);
        this.memoryManagers.set(agent.id, memoryManager);

        // Restore debug controller
        const debugController = this.createDebugController(memoryManager);
        this.debugControllers.set(agent.id, debugController);

        // Set up observer
        this.setupObserver(agent.id, memoryManager);

        // Restore executor
        if (this.getLLMAdapter) {
          const llmAdapter = this.getLLMAdapter();
          const executor = new AgentExecutor(memoryManager, llmAdapter);
          this.executors.set(agent.id, executor);
        }

        // Add to cache
        this.agentsCache.set(agent.id, agent);
        console.log(`Restored agent: ${agent.id} (${agent.name})`);
      } catch (error) {
        console.error(`Failed to restore agent ${agent.id}:`, error);
      }
    }

    console.log(`Restored ${this.agentsCache.size} agents`);
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

    // Create memory manager for this agent
    const memoryManager = this.createMemoryManager(llmConfig);
    this.memoryManagers.set(id, memoryManager);

    // Create debug controller
    const debugController = this.createDebugController(memoryManager);
    this.debugControllers.set(id, debugController);

    // Create blueprint loader and create thread
    const loader = new (await this.getBlueprintLoader())(memoryManager);
    const { thread } = await loader.createThreadFromBlueprint(blueprint);

    // Set up observer for this agent
    this.setupObserver(id, memoryManager);

    // Create agent executor for LLM response generation
    if (this.getLLMAdapter) {
      const llmAdapter = this.getLLMAdapter();
      const executor = new AgentExecutor(memoryManager, llmAdapter);
      this.executors.set(id, executor);
    }

    // Create agent instance
    const agent: AgentInstance = {
      id,
      blueprintId: blueprint.id,
      name: blueprint.name,
      threadId: thread.id,
      status: 'running',
      llmConfig: blueprint.llmConfig,
      modelOverride,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subAgentIds: [],
    };

    this.agentsCache.set(id, agent);

    // Persist to database
    await this.saveAgent(agent);

    return agent;
  }

  /**
   * Get BlueprintLoader class (dynamic import to avoid circular deps)
   */
  private async getBlueprintLoader(): Promise<typeof BlueprintLoader> {
    const { BlueprintLoader } = await import('@team9/agent-framework');
    return BlueprintLoader;
  }

  /**
   * Set up observer for an agent
   */
  private setupObserver(agentId: string, memoryManager: MemoryManager): void {
    const observer: MemoryObserver = {
      onEventDispatch: (event) => {
        this.broadcast(agentId, 'event:dispatch', event);
      },
      onReducerExecute: (event) => {
        this.broadcast(agentId, 'reducer:execute', event);
      },
      onStateChange: (event) => {
        this.broadcast(agentId, 'state:change', event);
      },
      onSubAgentSpawn: (event) => {
        this.broadcast(agentId, 'subagent:spawn', event);
      },
      onSubAgentResult: (event) => {
        this.broadcast(agentId, 'subagent:result', event);
      },
      onCompactionStart: (event) => {
        this.broadcast(agentId, 'compaction:start', event);
      },
      onCompactionEnd: (event) => {
        this.broadcast(agentId, 'compaction:end', event);
      },
      onError: (event) => {
        this.broadcast(agentId, 'error', event);
      },
    };

    const cleanup = memoryManager.addObserver(observer);
    this.observers.set(agentId, cleanup);
  }

  /**
   * Broadcast SSE message to subscribers
   */
  private broadcast(agentId: string, type: SSEEventType, data: unknown): void {
    const subscribers = this.sseSubscribers.get(agentId);
    if (!subscribers) return;

    const message: SSEMessage = {
      type,
      data,
      timestamp: Date.now(),
    };

    subscribers.forEach((subscriber) => {
      try {
        subscriber(message);
      } catch (error) {
        console.error('Error broadcasting to subscriber:', error);
      }
    });
  }

  /**
   * Subscribe to agent SSE events
   */
  subscribe(agentId: string, callback: SSESubscriber): () => void {
    if (!this.sseSubscribers.has(agentId)) {
      this.sseSubscribers.set(agentId, new Set());
    }

    const subscribers = this.sseSubscribers.get(agentId)!;
    subscribers.add(callback);

    return () => {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.sseSubscribers.delete(agentId);
      }
    };
  }

  /**
   * Get all agents
   */
  listAgents(): AgentInstance[] {
    return Array.from(this.agentsCache.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.agentsCache.get(id);
  }

  /**
   * Delete an agent
   */
  async deleteAgent(id: string): Promise<boolean> {
    const agent = this.agentsCache.get(id);
    if (!agent) return false;

    // Clean up observer
    const cleanup = this.observers.get(id);
    if (cleanup) {
      cleanup();
      this.observers.delete(id);
    }

    // Clean up subscribers
    this.sseSubscribers.delete(id);

    // Delete thread
    const memoryManager = this.memoryManagers.get(id);
    if (memoryManager) {
      await memoryManager.deleteThread(agent.threadId);
      this.memoryManagers.delete(id);
    }

    this.debugControllers.delete(id);
    this.executors.delete(id);
    this.agentsCache.delete(id);

    // Delete from database
    await this.deleteAgentFromDb(id);

    return true;
  }

  /**
   * Get state history for an agent
   */
  async getStateHistory(agentId: string): Promise<MemoryState[]> {
    const agent = this.agentsCache.get(agentId);
    if (!agent) return [];

    const memoryManager = this.memoryManagers.get(agentId);
    if (!memoryManager) return [];

    return memoryManager.getStateHistory(agent.threadId);
  }

  /**
   * Get current state for an agent
   */
  async getCurrentState(agentId: string): Promise<MemoryState | null> {
    const agent = this.agentsCache.get(agentId);
    if (!agent) return null;

    const memoryManager = this.memoryManagers.get(agentId);
    if (!memoryManager) return null;

    return memoryManager.getCurrentState(agent.threadId);
  }

  /**
   * Pause an agent
   */
  async pause(agentId: string): Promise<boolean> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    controller.pause(agent.threadId);
    agent.status = 'paused';
    agent.updatedAt = Date.now();

    // Persist status change
    await this.saveAgent(agent);

    this.broadcast(agentId, 'agent:paused', { reason: 'user_paused' });
    return true;
  }

  /**
   * Resume an agent
   */
  async resume(agentId: string): Promise<boolean> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    controller.resume(agent.threadId);
    agent.status = 'running';
    agent.updatedAt = Date.now();

    // Persist status change
    await this.saveAgent(agent);

    this.broadcast(agentId, 'agent:resumed', {});
    return true;
  }

  /**
   * Check if agent is paused
   */
  isPaused(agentId: string): boolean {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    return controller.isPaused(agent.threadId);
  }

  /**
   * Inject an event into an agent
   * @param autoRun - Whether to automatically run LLM after injection (default: true)
   */
  async injectEvent(
    agentId: string,
    event: AgentEvent,
    autoRun: boolean = true,
  ): Promise<{
    dispatchResult: DispatchResult;
    executionResult?: ExecutionResult;
  } | null> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return null;

    // First, inject the event into memory
    const dispatchResult = await controller.injectEvent(agent.threadId, event);

    // If autoRun is enabled and we have an executor, run the LLM loop
    if (autoRun && !this.isPaused(agentId)) {
      const executor = this.executors.get(agentId);
      if (executor) {
        this.broadcast(agentId, 'agent:thinking', { event });

        try {
          const executionResult = await executor.run(agent.threadId);

          if (executionResult.success) {
            this.broadcast(agentId, 'agent:response', {
              content: executionResult.lastResponse,
              turnsExecuted: executionResult.turnsExecuted,
            });
          } else {
            this.broadcast(agentId, 'agent:error', {
              error: executionResult.error,
            });
          }

          return { dispatchResult, executionResult };
        } catch (error) {
          console.error('Error running agent executor:', error);
          this.broadcast(agentId, 'agent:error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return { dispatchResult };
  }

  /**
   * Fork from a specific state
   */
  async forkFromState(
    agentId: string,
    stateId: string,
  ): Promise<AgentInstance | null> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return null;

    const result = await controller.forkFromState(agent.threadId, stateId);

    // Create a new agent instance for the forked thread
    const forkedAgent: AgentInstance = {
      id: `agent_${createId()}`,
      blueprintId: agent.blueprintId,
      name: `${agent.name} (forked)`,
      threadId: result.newThreadId,
      status: 'running',
      llmConfig: agent.llmConfig,
      modelOverride: agent.modelOverride,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentAgentId: agentId,
      subAgentIds: [],
    };

    // Share the same memory manager
    const memoryManager = this.memoryManagers.get(agentId)!;
    this.memoryManagers.set(forkedAgent.id, memoryManager);
    this.debugControllers.set(forkedAgent.id, controller);
    this.setupObserver(forkedAgent.id, memoryManager);

    // Create executor for forked agent
    if (this.getLLMAdapter) {
      const llmAdapter = this.getLLMAdapter();
      const executor = new AgentExecutor(memoryManager, llmAdapter);
      this.executors.set(forkedAgent.id, executor);
    }

    this.agentsCache.set(forkedAgent.id, forkedAgent);

    // Persist forked agent
    await this.saveAgent(forkedAgent);

    return forkedAgent;
  }

  /**
   * Edit a chunk in an agent's state
   */
  async editChunk(
    agentId: string,
    stateId: string,
    chunkId: string,
    newContent: unknown,
  ): Promise<boolean> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    await controller.editChunk(
      agent.threadId,
      stateId,
      chunkId,
      newContent as any,
    );
    return true;
  }

  /**
   * Update agent config (e.g., model override)
   */
  async updateConfig(
    agentId: string,
    config: { modelOverride?: LLMConfig },
  ): Promise<boolean> {
    const agent = this.agentsCache.get(agentId);
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
