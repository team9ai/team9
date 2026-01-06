/**
 * Agent Debug Service
 *
 * Handles debugging operations: fork, edit, execution mode control.
 * Provides tools for inspecting and manipulating agent state.
 */

import { createId } from '@paralleldrive/cuid2';
import type {
  ExecutionMode,
  LLMConfig,
  ILLMAdapter,
  CustomToolConfig,
} from '@team9/agent-framework';
import type {
  AgentInstance,
  AgentRuntimeState,
  ExecutionModeStatus,
} from '../types/index.js';
import { AgentExecutor } from '../executor/agent-executor.js';
import type { SSEBroadcaster } from './sse-broadcaster.service.js';

/**
 * Configuration for AgentDebugService
 */
export interface AgentDebugServiceConfig {
  getLLMAdapter?: () => ILLMAdapter;
  externalTools?: CustomToolConfig[];
  sseBroadcaster?: SSEBroadcaster;
  onAgentForked?: (agentId: string, memoryManager: unknown) => void;
  saveAgent?: (agent: AgentInstance) => Promise<void>;
}

/**
 * AgentDebugService handles debugging operations for agents
 */
export class AgentDebugService {
  constructor(
    private state: AgentRuntimeState,
    private config: AgentDebugServiceConfig = {},
  ) {}

  /**
   * Check if agent is in stepping mode
   */
  isSteppingMode(agentId: string): boolean {
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    return controller.getExecutionMode(agent.threadId) === 'stepping';
  }

  /**
   * Get execution mode status for an agent
   */
  getExecutionModeStatus(agentId: string): ExecutionModeStatus | null {
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
    const memoryManager = this.state.memoryManagers.get(agentId);
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
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    const previousMode = agent.executionMode;
    await controller.setExecutionMode(agent.threadId, mode);

    agent.executionMode = mode;
    agent.updatedAt = Date.now();

    // Persist mode change
    await this.config.saveAgent?.(agent);

    // Broadcast mode change
    this.config.sseBroadcaster?.broadcast(agentId, 'agent:mode_changed', {
      previousMode,
      newMode: mode,
    });

    return true;
  }

  /**
   * Fork from a specific state
   */
  async forkFromState(
    agentId: string,
    stateId: string,
  ): Promise<AgentInstance | null> {
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
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
    const memoryManager = this.state.memoryManagers.get(agentId)!;
    this.state.memoryManagers.set(forkedAgent.id, memoryManager);
    this.state.debugControllers.set(forkedAgent.id, controller);

    // Notify for observer setup
    this.config.onAgentForked?.(forkedAgent.id, memoryManager);

    // Create executor for forked agent with inherited tools
    if (this.config.getLLMAdapter) {
      const llmAdapter = this.config.getLLMAdapter();
      const executor = new AgentExecutor(memoryManager, llmAdapter, {
        tools: agent.tools ?? [],
        customTools: this.config.externalTools ?? [],
      });
      this.state.executors.set(forkedAgent.id, executor);
    }

    this.state.agentsCache.set(forkedAgent.id, forkedAgent);

    // Persist forked agent
    await this.config.saveAgent?.(forkedAgent);

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
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
    if (!controller || !agent) return false;

    await controller.editChunk(
      agent.threadId,
      stateId,
      chunkId,
      newContent as any,
    );
    return true;
  }
}

/**
 * Create an agent debug service instance
 */
export function createAgentDebugService(
  state: AgentRuntimeState,
  config?: AgentDebugServiceConfig,
): AgentDebugService {
  return new AgentDebugService(state, config);
}
