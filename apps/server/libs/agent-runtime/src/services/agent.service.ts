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
  MemoryState,
  Blueprint,
  LLMConfig,
  BaseEvent,
  DispatchResult,
  ExecutionMode,
  StepResult,
  QueuedEvent,
  Step,
  IToolRegistry,
  CustomToolConfig,
  Agent,
  AgentOrchestrator,
  SubAgentSpawnInfo,
} from '@team9/agent-framework';
import { AgentFactory } from '@team9/agent-framework';
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

  /** AgentFactory instance */
  private factory: AgentFactory;

  /** Specialized services */
  private lifecycleService: AgentLifecycleService;
  private debugService: AgentDebugService;
  private executionService: AgentExecutionService;
  private sseBroadcaster: SSEBroadcaster;
  private stepHistoryService: StepHistoryService;

  /** Cached external tools */
  private externalTools: CustomToolConfig[];

  /** Temporary storage for parentStateId from spawn events, keyed by subAgentId */
  private pendingSpawnParentStates = new Map<string, string>();

  constructor(
    factory: AgentFactory,
    db?: PostgresJsDatabase<Record<string, never>> | null,
    externalToolsConfig?: ExternalToolsConfig,
  ) {
    this.factory = factory;

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
      agents: new Map<string, Agent>(),
      executors: new Map<string, AgentExecutor>(),
    };

    // Initialize broadcaster and history services
    this.sseBroadcaster = new SSEBroadcaster();
    this.stepHistoryService = new StepHistoryService();

    // Initialize execution service first (needed for subagent callbacks)
    this.executionService = new AgentExecutionService(this.state, {
      sseBroadcaster: this.sseBroadcaster,
      isSteppingMode: (agentId) =>
        this.debugService?.isSteppingMode(agentId) ?? false,
    });

    // Initialize lifecycle service with subagent support
    const lifecycleConfig: AgentLifecycleServiceConfig = {
      factory: this.factory,
      db,
      externalTools: this.externalTools,
      onAgentInitialized: (agentId, agent) => {
        this.setupObserver(agentId, agent);
      },
      // Configure subagent callbacks
      onSubagentComplete: async (
        parentThreadId,
        childThreadId,
        subagentKey,
        result,
        success,
      ) => {
        // Find parent agent by threadId
        const parentAgent = this.findAgentByThreadId(parentThreadId);
        if (parentAgent) {
          await this.executionService.onSubagentComplete(
            parentAgent.id,
            childThreadId,
            subagentKey,
            result,
            success,
          );
        }
      },
      onSubagentStep: (parentThreadId, childThreadId, subagentKey, event) => {
        const parentAgent = this.findAgentByThreadId(parentThreadId);
        if (parentAgent) {
          this.executionService.onSubagentStep(
            parentAgent.id,
            childThreadId,
            subagentKey,
            event,
          );
        }
      },
      // Set up observers for subagent when created (for debugger SSE)
      onSubagentCreated: (
        parentAgentId,
        childThreadId,
        subagentKey,
        orchestrator,
      ) => {
        console.log(
          '[AgentService] Subagent created:',
          childThreadId,
          'for parent:',
          parentAgentId,
        );
        // Create a pseudo agent ID for the subagent to track in SSE
        const subagentId = `${parentAgentId}:subagent:${subagentKey}:${childThreadId}`;
        // Set up SSE observer for the subagent (orchestrator is passed directly)
        this.sseBroadcaster.setupObserver(subagentId, orchestrator);
        this.stepHistoryService.setupObserver(subagentId, orchestrator);

        // Get parentStateId from pending spawn events (saved by onSubAgentSpawn observer)
        // The key format matches the subAgentId from the spawn event
        let parentStateId: string | undefined;
        for (const [key, stateId] of this.pendingSpawnParentStates.entries()) {
          if (key.includes(subagentKey)) {
            parentStateId = stateId;
            this.pendingSpawnParentStates.delete(key);
            break;
          }
        }

        // Also broadcast to parent agent's subscribers
        this.sseBroadcaster.broadcast(parentAgentId, 'subagent:spawn', {
          parentAgentId,
          childThreadId,
          subagentKey,
          subagentId,
          parentStateId,
        });
      },
    };
    this.lifecycleService = new AgentLifecycleService(
      this.state,
      lifecycleConfig,
    );

    // Initialize debug service
    this.debugService = new AgentDebugService(this.state, {
      factory: this.factory,
      externalTools: this.externalTools,
      sseBroadcaster: this.sseBroadcaster,
      onAgentForked: (agentId, agent) => {
        this.setupObserver(agentId, agent);
      },
      saveAgent: async (agentInstance) => {
        // Use lifecycle service's internal save
        await this.lifecycleService.updateConfig(agentInstance.id, {});
      },
    });
  }

  /**
   * Find an agent by its thread ID
   */
  private findAgentByThreadId(threadId: string): AgentInstance | undefined {
    for (const agent of this.state.agentsCache.values()) {
      if (agent.threadId === threadId) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Set up observers for an agent
   */
  private setupObserver(agentId: string, agent: Agent): void {
    const orchestrator = agent.getOrchestrator();
    this.sseBroadcaster.setupObserver(agentId, orchestrator);
    this.stepHistoryService.setupObserver(agentId, orchestrator);

    // Set up subagent spawn observer to trigger execution when LLM_SUBAGENT_SPAWN event is processed
    agent.addObserver({
      onSubAgentSpawn: async (info: SubAgentSpawnInfo) => {
        console.log(
          '[AgentService] SubAgentSpawn event received:',
          info.subAgentId,
          'for parent thread:',
          info.parentThreadId,
          'parentStateId:',
          info.parentStateId,
        );

        // Save parentStateId for later use in onSubagentCreated callback
        // This is needed because onSubagentCreated doesn't have access to parentStateId
        if (info.parentStateId) {
          this.pendingSpawnParentStates.set(
            info.subAgentId,
            info.parentStateId,
          );
        }

        // Find the executor for this agent
        const executor = this.state.executors.get(agentId);
        if (!executor) {
          console.error('[AgentService] No executor found for agent:', agentId);
          return;
        }

        // Get the spawn handler and trigger execution
        const spawnHandler = executor.getSpawnSubagentHandler();
        if (!spawnHandler) {
          console.error(
            '[AgentService] No spawn handler found for agent:',
            agentId,
          );
          return;
        }

        // Trigger the actual subagent creation and execution
        const childThreadId = await spawnHandler.onSpawnEvent(info.subAgentId);
        if (childThreadId) {
          console.log(
            '[AgentService] Subagent started with thread:',
            childThreadId,
          );

          // Update the agent instance's subAgentIds list
          const agent = this.state.agentsCache.get(agentId);
          if (agent && !agent.subAgentIds.includes(childThreadId)) {
            agent.subAgentIds.push(childThreadId);
          }
        }
      },
    });
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
    event: BaseEvent,
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
  async getStateHistory(agentId: string): Promise<readonly MemoryState[]> {
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agentInstance) return [];

    const agent = this.state.agents.get(agentId);
    if (!agent) return [];

    return agent.getStateHistory();
  }

  /**
   * Get current state for an agent
   */
  async getCurrentState(agentId: string): Promise<MemoryState | null> {
    const agent = this.state.agents.get(agentId);
    if (!agent) return null;

    return agent.getState();
  }

  /**
   * Get the persistent event queue for an agent
   */
  async getEventQueue(agentId: string): Promise<QueuedEvent[]> {
    const agent = this.state.agents.get(agentId);
    if (!agent) return [];

    return agent.getPendingEvents();
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
    const agent = this.state.agents.get(agentId);
    if (!agent) return null;

    return agent.getStep(stepId);
  }

  /**
   * Get all steps for an agent's thread
   */
  async getSteps(agentId: string): Promise<Step[]> {
    const agent = this.state.agents.get(agentId);
    if (!agent) return [];

    return agent.getSteps();
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
