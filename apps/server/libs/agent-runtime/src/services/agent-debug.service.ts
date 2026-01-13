/**
 * Agent Debug Service
 *
 * Handles debugging operations: fork, edit, execution mode control.
 * Uses Agent + getOrchestrator() for advanced operations.
 */

import { createId } from '@paralleldrive/cuid2';
import type {
  ExecutionMode,
  CustomToolConfig,
  Agent,
  AgentFactory,
  DebugController,
} from '@team9/agent-framework';
import { createDebugController } from '@team9/agent-framework';
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
  factory: AgentFactory;
  externalTools?: CustomToolConfig[];
  sseBroadcaster?: SSEBroadcaster;
  onAgentForked?: (agentId: string, agent: Agent) => void;
  saveAgent?: (agent: AgentInstance) => Promise<void>;
}

/**
 * AgentDebugService handles debugging operations for agents
 */
export class AgentDebugService {
  constructor(
    private state: AgentRuntimeState,
    private config: AgentDebugServiceConfig,
  ) {}

  /**
   * Check if agent is in stepping mode
   */
  isSteppingMode(agentId: string): boolean {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return false;

    return agent.getExecutionMode() === 'stepping';
  }

  /**
   * Get execution mode status for an agent
   */
  getExecutionModeStatus(agentId: string): ExecutionModeStatus | null {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return null;

    return {
      mode: agent.getExecutionMode(),
    };
  }

  /**
   * Set execution mode for an agent
   */
  async setExecutionMode(
    agentId: string,
    mode: ExecutionMode,
  ): Promise<boolean> {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return false;

    const previousMode = agentInstance.executionMode;
    await agent.setExecutionMode(mode);

    agentInstance.executionMode = mode;
    agentInstance.updatedAt = Date.now();

    // Persist mode change
    await this.config.saveAgent?.(agentInstance);

    // Broadcast mode change
    this.config.sseBroadcaster?.broadcast(agentId, 'agent:mode_changed', {
      previousMode,
      newMode: mode,
    });

    return true;
  }

  /**
   * Get or create a DebugController for an agent
   */
  private getDebugController(agent: Agent): DebugController {
    const orchestrator = agent.getOrchestrator();
    const storage = orchestrator.getMemoryManager().getStorage();
    return createDebugController(orchestrator, storage);
  }

  /**
   * Fork from a specific state
   */
  async forkFromState(
    agentId: string,
    stateId: string,
  ): Promise<AgentInstance | null> {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return null;

    // Use DebugController for fork operation (advanced debug operation)
    const debugController = this.getDebugController(agent);
    const result = await debugController.forkFromState(
      agentInstance.threadId,
      stateId,
    );

    // Create a new agent instance for the forked thread
    const forkedAgentInstance: AgentInstance = {
      id: `agent_${createId()}`,
      blueprintId: agentInstance.blueprintId,
      name: `${agentInstance.name} (forked)`,
      threadId: result.newThreadId,
      status: 'awaiting_input',
      executionMode: agentInstance.executionMode,
      llmConfig: agentInstance.llmConfig,
      modelOverride: agentInstance.modelOverride,
      tools: agentInstance.tools ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentAgentId: agentId,
      subAgentIds: [],
    };

    // Restore forked agent using factory (creates Agent wrapper for existing thread)
    const forkedAgent = await this.config.factory.restoreAgent(
      result.newThreadId,
    );
    this.state.agents.set(forkedAgentInstance.id, forkedAgent);

    // Notify for observer setup
    this.config.onAgentForked?.(forkedAgentInstance.id, forkedAgent);

    // Create executor for forked agent with inherited tools
    const forkedOrchestrator = forkedAgent.getOrchestrator();
    const llmAdapter = forkedOrchestrator.getLLMAdapter();
    const executor = new AgentExecutor(forkedOrchestrator, llmAdapter, {
      tools: agentInstance.tools ?? [],
      customTools: this.config.externalTools ?? [],
    });
    this.state.executors.set(forkedAgentInstance.id, executor);

    this.state.agentsCache.set(forkedAgentInstance.id, forkedAgentInstance);

    // Persist forked agent
    await this.config.saveAgent?.(forkedAgentInstance);

    return forkedAgentInstance;
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
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return false;

    // Use DebugController for edit operation (advanced debug operation)
    const debugController = this.getDebugController(agent);
    await debugController.editChunk(
      agentInstance.threadId,
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
  config: AgentDebugServiceConfig,
): AgentDebugService {
  return new AgentDebugService(state, config);
}
