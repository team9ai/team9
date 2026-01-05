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
  ExecutionMode,
  StepResult,
  QueuedEvent,
  Step,
  IToolRegistry,
  CustomToolConfig,
} from '@team9/agent-framework';
import type {
  AgentInstance,
  AgentStatus,
  SSEMessage,
  SSEEventType,
  ExecutionModeStatus,
  StepHistoryEntry,
} from '../types/index.js';
import { AgentExecutor, ExecutionResult } from '../executor/agent-executor.js';
import { agents } from '../db/index.js';
import {
  createExternalTools,
  type ExternalToolsConfig,
} from '../tools/index.js';

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
  /** Step history per agent - tracks all step operations */
  private stepHistory = new Map<string, StepHistoryEntry[]>();
  /** Step counter per agent */
  private stepCounters = new Map<string, number>();
  /** Cached external tools */
  private externalTools: CustomToolConfig[];

  constructor(
    private createMemoryManager: (config: LLMConfig) => MemoryManager,
    private createDebugController: (
      memoryManager: MemoryManager,
    ) => DebugController,
    private getLLMAdapter?: () => ILLMAdapter,
    private db?: PostgresJsDatabase<Record<string, never>> | null,
    externalToolsConfig?: ExternalToolsConfig,
  ) {
    // Initialize external tools
    // If config provided, use it; otherwise use default config (reads from env vars)
    this.externalTools = externalToolsConfig
      ? createExternalTools(externalToolsConfig)
      : createExternalTools();

    if (this.externalTools.length > 0) {
      console.log(
        '[AgentService] Registered external tools:',
        this.externalTools.map((t) => t.definition.name).join(', '),
      );
    }
  }

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

        // Restore executor with tools from saved agent data
        if (this.getLLMAdapter) {
          const llmAdapter = this.getLLMAdapter();
          const executor = new AgentExecutor(memoryManager, llmAdapter, {
            tools: agent.tools ?? [],
            customTools: this.externalTools,
          });
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
      const executor = new AgentExecutor(memoryManager, llmAdapter, {
        tools: blueprint.tools ?? [],
        customTools: this.externalTools,
      });
      this.executors.set(id, executor);
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
      tools: blueprint.tools ?? [],
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
   * Check if agent is in stepping mode
   */
  isSteppingMode(agentId: string): boolean {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    return controller.getExecutionMode(agent.threadId) === 'stepping';
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

    // Debug logging
    const isStepMode = this.isSteppingMode(agentId);
    const executor = this.executors.get(agentId);
    console.log(
      '[injectEvent] autoRun:',
      autoRun,
      'isStepMode:',
      isStepMode,
      'hasExecutor:',
      !!executor,
    );

    // If autoRun is enabled, not in stepping mode, and we have an executor, run the LLM loop
    // Run in background to avoid blocking the HTTP request
    if (autoRun && !isStepMode) {
      if (executor) {
        console.log('[injectEvent] Starting LLM execution loop (async)');
        this.broadcast(agentId, 'agent:thinking', { event });

        // Run asynchronously - don't await
        this.runExecutorAsync(agentId, executor, agent.threadId);
      }
    }

    return { dispatchResult };
  }

  /**
   * Run executor asynchronously (non-blocking)
   */
  private async runExecutorAsync(
    agentId: string,
    executor: AgentExecutor,
    threadId: string,
  ): Promise<void> {
    try {
      const executionResult = await executor.run(threadId);
      console.log(
        '[runExecutorAsync] Execution complete - success:',
        executionResult.success,
        'turns:',
        executionResult.turnsExecuted,
      );
      console.log(
        '[runExecutorAsync] Final state id:',
        executionResult.finalState?.id,
        'chunks:',
        executionResult.finalState?.chunkIds?.length,
      );

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
    } catch (error) {
      console.error('Error running agent executor:', error);
      this.broadcast(agentId, 'agent:error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      status: 'awaiting_input',
      executionMode: agent.executionMode,
      llmConfig: agent.llmConfig,
      modelOverride: agent.modelOverride,
      tools: agent.tools ?? [],
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

    // Create executor for forked agent with inherited tools
    if (this.getLLMAdapter) {
      const llmAdapter = this.getLLMAdapter();
      const executor = new AgentExecutor(memoryManager, llmAdapter, {
        tools: agent.tools ?? [],
        customTools: this.externalTools,
      });
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

  // ============ Execution Mode Control ============

  /**
   * Get execution mode status for an agent
   */
  getExecutionModeStatus(agentId: string): ExecutionModeStatus | null {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    const memoryManager = this.memoryManagers.get(agentId);
    if (!controller || !agent || !memoryManager) return null;

    return {
      mode: controller.getExecutionMode(agent.threadId),
      hasPendingCompaction: memoryManager.hasPendingCompaction(agent.threadId),
      hasPendingTruncation: memoryManager.hasPendingTruncation(agent.threadId),
    };
  }

  /**
   * Set execution mode for an agent
   */
  async setExecutionMode(
    agentId: string,
    mode: ExecutionMode,
  ): Promise<boolean> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    const previousMode = agent.executionMode;
    await controller.setExecutionMode(agent.threadId, mode);

    agent.executionMode = mode;
    agent.updatedAt = Date.now();

    // Persist mode change
    await this.saveAgent(agent);

    this.broadcast(agentId, 'agent:mode_changed', {
      previousMode,
      newMode: mode,
    });

    return true;
  }

  /**
   * Get the persistent event queue for an agent
   * This queue is persisted to storage and survives restarts
   */
  async getEventQueue(agentId: string): Promise<QueuedEvent[]> {
    const agent = this.agentsCache.get(agentId);
    const memoryManager = this.memoryManagers.get(agentId);
    if (!agent || !memoryManager) return [];

    return memoryManager.getPersistentEventQueue(agent.threadId);
  }

  // ============ Step History ============

  /**
   * Get step history for an agent
   */
  getStepHistory(agentId: string): StepHistoryEntry[] {
    return this.stepHistory.get(agentId) ?? [];
  }

  /**
   * Clear step history for an agent
   */
  clearStepHistory(agentId: string): void {
    this.stepHistory.delete(agentId);
    this.stepCounters.delete(agentId);
  }

  /**
   * Record a step in history
   */
  private recordStep(
    agentId: string,
    entry: Omit<StepHistoryEntry, 'id' | 'stepNumber'>,
  ): StepHistoryEntry {
    // Get or initialize step counter
    const stepNumber = (this.stepCounters.get(agentId) ?? 0) + 1;
    this.stepCounters.set(agentId, stepNumber);

    // Create full entry
    const fullEntry: StepHistoryEntry = {
      id: `step_${createId()}`,
      stepNumber,
      ...entry,
    };

    // Get or initialize history
    if (!this.stepHistory.has(agentId)) {
      this.stepHistory.set(agentId, []);
    }
    this.stepHistory.get(agentId)!.push(fullEntry);

    return fullEntry;
  }

  /**
   * Execute a single step in stepping mode
   *
   * Flow (based on flow diagram):
   * 1. Check for pending compaction/truncation (forced pre-event)
   * 2. Check for queued events in persistent queue
   * 3. If no events and no pending ops, check needsResponse flag
   * 4. Only generate LLM response if needsResponse is true
   * 5. After LLM response, clear needsResponse flag
   *
   * Priority:
   * 1. Events in queue (processed by MemoryManager.step)
   * 2. Pending truncation (processed by MemoryManager.step)
   * 3. Pending compaction (processed by MemoryManager.step)
   * 4. LLM response generation (only if needsResponse is true)
   */
  async step(agentId: string): Promise<StepResult | null> {
    const controller = this.debugControllers.get(agentId);
    const agent = this.agentsCache.get(agentId);
    const memoryManager = this.memoryManagers.get(agentId);
    if (!controller || !agent || !memoryManager) return null;

    // Get state before step for history tracking
    const stateBefore = await memoryManager.getCurrentState(agent.threadId);
    const stateIdBefore = stateBefore?.id ?? 'unknown';

    // Step 1: Call MemoryManager.step() which handles:
    // - Events in persistent queue (priority 1)
    // - Pending truncation (priority 2)
    // - Pending compaction (priority 3)
    const memoryResult = await controller.step(agent.threadId);

    // If an event was processed or truncation/compaction was done, return that result
    if (
      memoryResult.eventProcessed ||
      memoryResult.truncationPerformed ||
      memoryResult.compactionPerformed
    ) {
      // Check if this was an interrupt-type event (cancel current LLM generation)
      if (memoryResult.shouldInterrupt) {
        const executor = this.executors.get(agentId);
        if (executor) {
          const cancelled = executor.cancel(agent.threadId);
          console.log(
            '[step] Interrupt event processed, LLM cancelled:',
            cancelled,
          );
        }
      }

      // Get state after for history
      const stateAfter = await memoryManager.getCurrentState(agent.threadId);
      const stateIdAfter = stateAfter?.id ?? 'unknown';

      // Determine operation type
      let operationType: 'event' | 'compaction' | 'truncation' = 'event';
      if (memoryResult.compactionPerformed) {
        operationType = 'compaction';
      } else if (memoryResult.truncationPerformed) {
        operationType = 'truncation';
      }

      // Record step in history
      this.recordStep(agentId, {
        timestamp: Date.now(),
        operationType,
        processedEvent: memoryResult.eventProcessed
          ? ((memoryResult.dispatchResult as { event?: AgentEvent })?.event as
              | { type: string; [key: string]: unknown }
              | undefined)
          : undefined,
        llmResponseGenerated: false,
        stateIdBefore,
        stateIdAfter,
        shouldTerminate: memoryResult.shouldTerminate,
        shouldInterrupt: memoryResult.shouldInterrupt,
      });

      // Check if this was a terminate-type event (end event loop)
      if (memoryResult.shouldTerminate) {
        this.broadcast(agentId, 'agent:terminated', {
          eventProcessed: memoryResult.eventProcessed,
          reason: 'terminate_event',
        });
      } else {
        this.broadcast(agentId, 'agent:stepped', {
          eventProcessed: memoryResult.eventProcessed,
          truncationPerformed: memoryResult.truncationPerformed,
          compactionPerformed: memoryResult.compactionPerformed,
          hasPendingOperations: memoryResult.hasPendingOperations,
          queuedEventCount: memoryResult.queuedEventCount,
          needsResponse: memoryResult.needsResponse,
          llmResponseGenerated: false,
          shouldTerminate: memoryResult.shouldTerminate,
          shouldInterrupt: memoryResult.shouldInterrupt,
        });
      }
      return memoryResult;
    }

    // Step 2: No events in queue, no pending operations
    // Check if we should generate LLM response based on needsResponse flag
    // According to flow diagram: only generate LLM response if needsResponse is true

    const executor = this.executors.get(agentId);
    const needsResponse = memoryResult.needsResponse ?? false;

    // If no executor or needsResponse is false, don't generate LLM response
    if (!executor || !needsResponse) {
      // Record noop step in history
      this.recordStep(agentId, {
        timestamp: Date.now(),
        operationType: 'noop',
        llmResponseGenerated: false,
        stateIdBefore,
        stateIdAfter: stateIdBefore, // No state change
      });

      this.broadcast(agentId, 'agent:stepped', {
        eventProcessed: false,
        truncationPerformed: false,
        compactionPerformed: false,
        hasPendingOperations: memoryResult.hasPendingOperations,
        queuedEventCount: memoryResult.queuedEventCount,
        needsResponse,
        llmResponseGenerated: false,
        shouldTerminate: memoryResult.shouldTerminate,
        shouldInterrupt: memoryResult.shouldInterrupt,
      });
      return memoryResult;
    }

    // Step 3: needsResponse is true, run LLM
    this.broadcast(agentId, 'agent:thinking', {});

    try {
      const executionResult = await executor.run(agent.threadId);

      // After LLM response, clear the needsResponse flag
      if (executionResult.success && executionResult.turnsExecuted > 0) {
        await memoryManager.setNeedsResponse(agent.threadId, false);
      }

      const queueLength = await memoryManager.getPersistentQueueLength(
        agent.threadId,
      );
      const updatedNeedsResponse = await memoryManager.needsResponse(
        agent.threadId,
      );

      // Get state after LLM response for history
      const stateAfterLLM = await memoryManager.getCurrentState(agent.threadId);
      const stateIdAfterLLM = stateAfterLLM?.id ?? 'unknown';

      // Record LLM response step in history
      this.recordStep(agentId, {
        timestamp: Date.now(),
        operationType: 'llm_response',
        llmResponseGenerated:
          executionResult.success && executionResult.turnsExecuted > 0,
        llmResponse: executionResult.lastResponse,
        cancelled: executionResult.cancelled,
        stateIdBefore,
        stateIdAfter: stateIdAfterLLM,
        error: executionResult.error,
      });

      if (executionResult.success && executionResult.turnsExecuted > 0) {
        this.broadcast(agentId, 'agent:stepped', {
          eventProcessed: false,
          truncationPerformed: false,
          compactionPerformed: false,
          hasPendingOperations:
            queueLength > 0 ||
            memoryManager.hasPendingCompaction(agent.threadId) ||
            memoryManager.hasPendingTruncation(agent.threadId),
          queuedEventCount: queueLength,
          needsResponse: updatedNeedsResponse,
          llmResponseGenerated: true,
          lastResponse: executionResult.lastResponse,
        });
      } else {
        this.broadcast(agentId, 'agent:stepped', {
          eventProcessed: false,
          truncationPerformed: false,
          compactionPerformed: false,
          hasPendingOperations: queueLength > 0,
          queuedEventCount: queueLength,
          needsResponse: updatedNeedsResponse,
          llmResponseGenerated: false,
        });
      }

      // Build result
      const finalState = await memoryManager.getCurrentState(agent.threadId);
      const thread = await memoryManager.getThread(agent.threadId);

      return {
        dispatchResult:
          thread && finalState
            ? {
                thread,
                state: finalState,
                addedChunks: [],
                removedChunkIds: [],
              }
            : null,
        eventProcessed: false,
        compactionPerformed: false,
        truncationPerformed: false,
        hasPendingOperations:
          queueLength > 0 ||
          memoryManager.hasPendingCompaction(agent.threadId) ||
          memoryManager.hasPendingTruncation(agent.threadId),
        queuedEventCount: queueLength,
        needsResponse: updatedNeedsResponse,
      };
    } catch (error) {
      console.error('Error in step LLM execution:', error);

      // Record error step in history
      this.recordStep(agentId, {
        timestamp: Date.now(),
        operationType: 'llm_response',
        llmResponseGenerated: false,
        stateIdBefore,
        stateIdAfter: stateIdBefore, // No state change on error
        error: error instanceof Error ? error.message : String(error),
      });

      this.broadcast(agentId, 'agent:error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return memoryResult;
    }
  }

  // ============ Step Operations ============

  /**
   * Get a step by ID
   * @param agentId - The agent ID
   * @param stepId - The step ID
   * @returns The step or null if not found
   */
  async getStepById(agentId: string, stepId: string): Promise<Step | null> {
    const memoryManager = this.memoryManagers.get(agentId);
    if (!memoryManager) return null;

    return memoryManager.getStep(stepId);
  }

  /**
   * Get all steps for an agent's thread
   * @param agentId - The agent ID
   * @returns Array of steps ordered by start time
   */
  async getSteps(agentId: string): Promise<Step[]> {
    const agent = this.agentsCache.get(agentId);
    const memoryManager = this.memoryManagers.get(agentId);
    if (!agent || !memoryManager) return [];

    return memoryManager.getStepsByThread(agent.threadId);
  }

  // ============ Tool Registry Access ============

  /**
   * Get the tool registry for an agent
   * @param agentId - The agent ID
   * @returns The tool registry or undefined if not found
   */
  getToolRegistry(agentId: string): IToolRegistry | undefined {
    const executor = this.executors.get(agentId);
    return executor?.toolRegistry;
  }

  /**
   * Handle invoke_tool calls from LLM
   * This method is called when the LLM calls the invoke_tool control tool
   * It executes the specified external tool and injects the result back
   *
   * @param agentId - The agent ID
   * @param callId - The tool call ID (for matching result)
   * @param toolName - Name of the external tool to invoke
   * @param toolArgs - Arguments to pass to the tool
   * @param autoRun - Whether to auto-run LLM after injecting result
   * @returns The injection result or null if failed
   */
  async handleInvokeTool(
    agentId: string,
    callId: string,
    toolName: string,
    toolArgs: Record<string, unknown> = {},
    autoRun: boolean = true,
  ): Promise<{
    dispatchResult: DispatchResult;
    executionResult?: ExecutionResult;
  } | null> {
    const agent = this.agentsCache.get(agentId);
    const registry = this.getToolRegistry(agentId);

    if (!agent || !registry) {
      console.error('[handleInvokeTool] Agent or registry not found:', agentId);
      return null;
    }

    console.log(
      '[handleInvokeTool] Executing tool:',
      toolName,
      'with args:',
      toolArgs,
    );

    // Execute the tool
    const { EventType } = await import('@team9/agent-framework');
    const result = await registry.execute(toolName, toolArgs, {
      threadId: agent.threadId,
      agentId,
      callId,
    });

    console.log(
      '[handleInvokeTool] Tool result:',
      result.success,
      result.content,
    );

    // Inject TOOL_RESULT event
    // If there's an error, include it in the result content
    const resultContent = result.success
      ? result.content
      : { error: result.error, content: result.content };

    const toolResultEvent: AgentEvent = {
      type: EventType.TOOL_RESULT,
      toolName,
      callId,
      success: result.success,
      result: resultContent,
      timestamp: Date.now(),
    };

    return this.injectEvent(agentId, toolResultEvent, autoRun);
  }

  /**
   * Check if a tool call event is an invoke_tool call
   */
  isInvokeToolCall(event: AgentEvent): boolean {
    return (
      event.type === 'LLM_TOOL_CALL' &&
      (event as { toolName?: string }).toolName === 'invoke_tool'
    );
  }

  /**
   * Parse invoke_tool arguments from tool call event
   */
  parseInvokeToolArgs(event: AgentEvent): {
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  } | null {
    if (!this.isInvokeToolCall(event)) return null;

    const toolCallEvent = event as {
      callId: string;
      arguments: {
        tool_name?: string;
        arguments?: Record<string, unknown>;
      };
    };

    const toolName = toolCallEvent.arguments?.tool_name;
    if (!toolName) return null;

    return {
      callId: toolCallEvent.callId,
      toolName,
      arguments: toolCallEvent.arguments?.arguments ?? {},
    };
  }

  // ============ External Tools Access ============

  /**
   * Get all registered external tools
   * These are tools registered at runtime (e.g., Semrush API)
   */
  getExternalTools(): CustomToolConfig[] {
    return this.externalTools;
  }

  /**
   * Get external tool definitions only (for API responses)
   */
  getExternalToolDefinitions() {
    return this.externalTools.map((tool) => ({
      name: tool.definition.name,
      description: tool.definition.description,
      awaitsExternalResponse: tool.definition.awaitsExternalResponse ?? false,
      parameters: tool.definition.parameters,
      category: tool.category ?? 'common',
    }));
  }
}
