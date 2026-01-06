/**
 * Agent Service (Facade)
 *
 * Coordinates all agent-related services and provides a unified API.
 * Delegates operations to specialized services:
 * - AgentLifecycleService: creation, deletion, restoration
 * - AgentDebugService: fork, edit, execution mode
 * - AgentExecutionService: event injection, stepping
 * - SSEBroadcaster: real-time event broadcasting
 * - StepHistoryService: step history recording
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  MemoryManager,
  MemoryState,
  DebugController,
  Blueprint,
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
  AgentRuntimeState,
  ExecutionModeStatus,
  StepHistoryEntry,
} from '../types/index.js';
import { AgentExecutor, ExecutionResult } from '../executor/agent-executor.js';
import {
  createExternalTools,
  type ExternalToolsConfig,
} from '../tools/index.js';
import {
  SSEBroadcaster,
  type SSESubscriber,
} from './sse-broadcaster.service.js';
import { StepHistoryService } from './step-history.service.js';
import {
  AgentLifecycleService,
  type AgentLifecycleServiceConfig,
} from './agent-lifecycle.service.js';
import { AgentDebugService } from './agent-debug.service.js';
import { AgentExecutionService } from './agent-execution.service.js';

/**
 * AgentService is the main facade for agent operations
 */
export class AgentService {
  /** Shared runtime state */
  private state: AgentRuntimeState;

  /** Specialized services */
  private lifecycleService: AgentLifecycleService;
  private debugService: AgentDebugService;
  private executionService: AgentExecutionService;
  private sseBroadcaster: SSEBroadcaster;
  private stepHistoryService: StepHistoryService;

  /** Cached external tools */
  private externalTools: CustomToolConfig[];

  constructor(
    createMemoryManager: (config: LLMConfig) => MemoryManager,
    createDebugController: (memoryManager: MemoryManager) => DebugController,
    getLLMAdapter?: () => ILLMAdapter,
    db?: PostgresJsDatabase<Record<string, never>> | null,
    externalToolsConfig?: ExternalToolsConfig,
  ) {
    // Initialize external tools
    this.externalTools = externalToolsConfig
      ? createExternalTools(externalToolsConfig)
      : createExternalTools();

    if (this.externalTools.length > 0) {
      console.log(
        '[AgentService] Registered external tools:',
        this.externalTools.map((t) => t.definition.name).join(', '),
      );
    }

    // Initialize shared state
    this.state = {
      agentsCache: new Map<string, AgentInstance>(),
      memoryManagers: new Map<string, MemoryManager>(),
      debugControllers: new Map<string, DebugController>(),
      executors: new Map<string, AgentExecutor>(),
    };

    // Initialize broadcaster and history services
    this.sseBroadcaster = new SSEBroadcaster();
    this.stepHistoryService = new StepHistoryService();

    // Initialize lifecycle service
    const lifecycleConfig: AgentLifecycleServiceConfig = {
      createMemoryManager,
      createDebugController,
      getLLMAdapter,
      db,
      externalTools: this.externalTools,
      onAgentInitialized: (agentId, memoryManager) => {
        this.setupObserver(agentId, memoryManager);
      },
    };
    this.lifecycleService = new AgentLifecycleService(
      this.state,
      lifecycleConfig,
    );

    // Initialize debug service
    this.debugService = new AgentDebugService(this.state, {
      getLLMAdapter,
      externalTools: this.externalTools,
      sseBroadcaster: this.sseBroadcaster,
      onAgentForked: (agentId, memoryManager) => {
        this.setupObserver(agentId, memoryManager as MemoryManager);
      },
      saveAgent: async (agent) => {
        // Use lifecycle service's internal save
        await this.lifecycleService.updateConfig(agent.id, {});
      },
    });

    // Initialize execution service
    this.executionService = new AgentExecutionService(this.state, {
      sseBroadcaster: this.sseBroadcaster,
      isSteppingMode: (agentId) => this.debugService.isSteppingMode(agentId),
    });
  }

  /**
   * Set up observers for an agent
   */
  private setupObserver(agentId: string, memoryManager: MemoryManager): void {
    this.sseBroadcaster.setupObserver(agentId, memoryManager);
    this.stepHistoryService.setupObserver(agentId, memoryManager);
  }

  // ============ Lifecycle Operations (delegated to AgentLifecycleService) ============

  /**
   * Load all agents from database and restore their runtime state
   */
  async restoreAgents(): Promise<void> {
    return this.lifecycleService.restoreAgents();
  }

  /**
   * Create an agent from a blueprint
   */
  async createAgent(
    blueprint: Blueprint,
    modelOverride?: LLMConfig,
  ): Promise<AgentInstance> {
    return this.lifecycleService.createAgent(blueprint, modelOverride);
  }

  /**
   * Get all agents
   */
  listAgents(): AgentInstance[] {
    return this.lifecycleService.listAgents();
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.lifecycleService.getAgent(id);
  }

  /**
   * Delete an agent
   */
  async deleteAgent(id: string): Promise<boolean> {
    return this.lifecycleService.deleteAgent(id, (agentId) => {
      this.sseBroadcaster.cleanup(agentId);
      this.stepHistoryService.cleanup(agentId);
    });
  }

  /**
   * Update agent config (e.g., model override)
   */
  async updateConfig(
    agentId: string,
    config: { modelOverride?: LLMConfig },
  ): Promise<boolean> {
    return this.lifecycleService.updateConfig(agentId, config);
  }

  // ============ Debug Operations (delegated to AgentDebugService) ============

  /**
   * Check if agent is in stepping mode
   */
  isSteppingMode(agentId: string): boolean {
    return this.debugService.isSteppingMode(agentId);
  }

  /**
   * Get execution mode status for an agent
   */
  getExecutionModeStatus(agentId: string): ExecutionModeStatus | null {
    return this.debugService.getExecutionModeStatus(agentId);
  }

  /**
   * Set execution mode for an agent
   */
  async setExecutionMode(
    agentId: string,
    mode: ExecutionMode,
  ): Promise<boolean> {
    return this.debugService.setExecutionMode(agentId, mode);
  }

  /**
   * Fork from a specific state
   */
  async forkFromState(
    agentId: string,
    stateId: string,
  ): Promise<AgentInstance | null> {
    return this.debugService.forkFromState(agentId, stateId);
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
    return this.debugService.editChunk(agentId, stateId, chunkId, newContent);
  }

  // ============ Execution Operations (delegated to AgentExecutionService) ============

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
    return this.executionService.injectEvent(agentId, event, autoRun);
  }

  /**
   * Execute a single step in stepping mode
   */
  async step(agentId: string): Promise<StepResult | null> {
    return this.executionService.step(agentId);
  }

  // ============ State Query Operations ============

  /**
   * Get state history for an agent
   */
  async getStateHistory(agentId: string): Promise<MemoryState[]> {
    const agent = this.state.agentsCache.get(agentId);
    if (!agent) return [];

    const memoryManager = this.state.memoryManagers.get(agentId);
    if (!memoryManager) return [];

    return memoryManager.getStateHistory(agent.threadId);
  }

  /**
   * Get current state for an agent
   */
  async getCurrentState(agentId: string): Promise<MemoryState | null> {
    const agent = this.state.agentsCache.get(agentId);
    if (!agent) return null;

    const memoryManager = this.state.memoryManagers.get(agentId);
    if (!memoryManager) return null;

    return memoryManager.getCurrentState(agent.threadId);
  }

  /**
   * Get the persistent event queue for an agent
   */
  async getEventQueue(agentId: string): Promise<QueuedEvent[]> {
    const agent = this.state.agentsCache.get(agentId);
    const memoryManager = this.state.memoryManagers.get(agentId);
    if (!agent || !memoryManager) return [];

    return memoryManager.getPersistentEventQueue(agent.threadId);
  }

  // ============ SSE Operations ============

  /**
   * Subscribe to agent SSE events
   */
  subscribe(agentId: string, callback: SSESubscriber): () => void {
    return this.sseBroadcaster.subscribe(agentId, callback);
  }

  // ============ Step History Operations ============

  /**
   * Get step history for an agent
   */
  getStepHistory(agentId: string): StepHistoryEntry[] {
    return this.stepHistoryService.getHistory(agentId);
  }

  /**
   * Clear step history for an agent
   */
  clearStepHistory(agentId: string): void {
    this.stepHistoryService.clearHistory(agentId);
  }

  // ============ Step Operations ============

  /**
   * Get a step by ID
   */
  async getStepById(agentId: string, stepId: string): Promise<Step | null> {
    const memoryManager = this.state.memoryManagers.get(agentId);
    if (!memoryManager) return null;

    return memoryManager.getStep(stepId);
  }

  /**
   * Get all steps for an agent's thread
   */
  async getSteps(agentId: string): Promise<Step[]> {
    const agent = this.state.agentsCache.get(agentId);
    const memoryManager = this.state.memoryManagers.get(agentId);
    if (!agent || !memoryManager) return [];

    return memoryManager.getStepsByThread(agent.threadId);
  }

  // ============ Tool Registry Access ============

  /**
   * Get the tool registry for an agent
   */
  getToolRegistry(agentId: string): IToolRegistry | undefined {
    const executor = this.state.executors.get(agentId);
    return executor?.toolRegistry;
  }

  // ============ External Tools Access ============

  /**
   * Get all registered external tools
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
