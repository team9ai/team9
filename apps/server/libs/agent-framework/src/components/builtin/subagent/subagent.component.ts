/**
 * SubAgentComponent - Manages sub-agent spawning and communication
 * Handles LLM_SUBAGENT_SPAWN, LLM_SUBAGENT_MESSAGE, SUBAGENT_RESULT events
 *
 * Architecture:
 * - Tracks active sub-agents in component data
 * - Creates spawn/result chunks in WORKING_HISTORY
 * - Renders active sub-agents status in system prompt
 */

import { AbstractComponent } from '../../base/abstract-component.js';
import type { MemoryChunk } from '../../../types/chunk.types.js';
import type {
  NewComponentType,
  ComponentContext,
  RenderedFragment,
} from '../../component.interface.js';
import type { SubAgentInfo } from './subagent.types.js';
import {
  STATUS_CHUNK_KEY,
  createSubAgentStatusChunk,
} from './subagent.operations.js';

/**
 * SubAgentComponent manages sub-agent lifecycle
 * This is a stable component (cannot be disabled at runtime)
 */
export class SubAgentComponent extends AbstractComponent {
  readonly id = 'builtin:subagent';
  readonly name = 'Sub-Agent Manager';
  readonly type: NewComponentType = 'stable';

  // ============ Lifecycle ============

  onInitialize(context: ComponentContext): void {
    // Initialize sub-agent tracking
    context.setData('subagents', new Map<string, SubAgentInfo>());
  }

  // ============ Chunk Management ============

  createInitialChunks(_context: ComponentContext): MemoryChunk[] {
    // Create a status chunk for tracking active sub-agents
    return [createSubAgentStatusChunk(this.id)];
  }

  // ============ Rendering ============

  renderChunk(
    chunk: MemoryChunk,
    context: ComponentContext,
  ): RenderedFragment[] {
    if (chunk.componentKey !== this.id) {
      return [];
    }

    // Only render status chunk
    if (chunk.chunkKey !== STATUS_CHUNK_KEY) {
      return [];
    }

    const subagents = context.getData<Map<string, SubAgentInfo>>('subagents');
    if (!subagents || subagents.size === 0) {
      return [];
    }

    // Get active sub-agents
    const activeAgents = Array.from(subagents.values()).filter(
      (sa) => sa.status === 'spawning' || sa.status === 'running',
    );

    if (activeAgents.length === 0) {
      return [];
    }

    const lines = ['Active Sub-Agents:'];
    for (const agent of activeAgents) {
      const statusIcon = agent.status === 'spawning' ? '...' : '>';
      lines.push(`  ${statusIcon} [${agent.id}] ${agent.type}: ${agent.task}`);
    }

    return [
      {
        content: `<subagent_status>\n${lines.join('\n')}\n</subagent_status>`,
        location: 'system',
        order: 850, // After todos, before task status
      },
    ];
  }

  // ============ Public API ============

  /**
   * Register a new sub-agent spawn
   */
  registerSpawn(
    context: ComponentContext,
    id: string,
    type: string,
    task: string,
    _config?: Record<string, unknown>,
  ): SubAgentInfo {
    const subagents =
      context.getData<Map<string, SubAgentInfo>>('subagents') ?? new Map();

    const info: SubAgentInfo = {
      id,
      type,
      task,
      status: 'spawning',
      spawnedAt: Date.now(),
    };

    subagents.set(id, info);
    context.setData('subagents', subagents);

    return info;
  }

  /**
   * Update sub-agent to running status
   */
  setRunning(
    context: ComponentContext,
    id: string,
    childThreadId?: string,
  ): void {
    const subagents = context.getData<Map<string, SubAgentInfo>>('subagents');
    if (!subagents) return;

    const info = subagents.get(id);
    if (info) {
      info.status = 'running';
      info.childThreadId = childThreadId;
      context.setData('subagents', subagents);
    }
  }

  /**
   * Mark sub-agent as completed
   */
  setCompleted(context: ComponentContext, id: string, result: unknown): void {
    const subagents = context.getData<Map<string, SubAgentInfo>>('subagents');
    if (!subagents) return;

    const info = subagents.get(id);
    if (info) {
      info.status = 'completed';
      info.completedAt = Date.now();
      info.result = result;
      context.setData('subagents', subagents);
    }
  }

  /**
   * Mark sub-agent as failed
   */
  setFailed(context: ComponentContext, id: string, error: string): void {
    const subagents = context.getData<Map<string, SubAgentInfo>>('subagents');
    if (!subagents) return;

    const info = subagents.get(id);
    if (info) {
      info.status = 'failed';
      info.completedAt = Date.now();
      info.error = error;
      context.setData('subagents', subagents);
    }
  }

  /**
   * Get all sub-agents
   */
  getAllSubAgents(context: ComponentContext): SubAgentInfo[] {
    const subagents = context.getData<Map<string, SubAgentInfo>>('subagents');
    return subagents ? Array.from(subagents.values()) : [];
  }

  /**
   * Get active sub-agents
   */
  getActiveSubAgents(context: ComponentContext): SubAgentInfo[] {
    return this.getAllSubAgents(context).filter(
      (sa) => sa.status === 'spawning' || sa.status === 'running',
    );
  }

  /**
   * Get sub-agent by ID
   */
  getSubAgent(context: ComponentContext, id: string): SubAgentInfo | undefined {
    const subagents = context.getData<Map<string, SubAgentInfo>>('subagents');
    return subagents?.get(id);
  }
}
