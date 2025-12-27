import {
  MemoryChunk,
  ChunkType,
  ChunkContentType,
  WorkingFlowSubType,
} from '../types/chunk.types';
import { IChunkRenderer, ContextMessageRole } from './context.types';

/**
 * Extract text content from a chunk
 */
function extractTextContent(chunk: MemoryChunk): string {
  const content = chunk.content;

  if (content.type === ChunkContentType.TEXT) {
    if ('text' in content && typeof content.text === 'string') {
      return content.text;
    }
    // For structured content, serialize relevant fields
    const { type, ...rest } = content;
    return JSON.stringify(rest, null, 2);
  }

  if (content.type === ChunkContentType.MIXED && 'parts' in content) {
    const parts = content.parts as Array<{
      type: ChunkContentType;
      text?: string;
    }>;
    return parts
      .filter((p) => p.type === ChunkContentType.TEXT)
      .map((p) => p.text ?? '')
      .join('\n');
  }

  if (content.type === ChunkContentType.IMAGE) {
    return '[Image content]';
  }

  if (content.type === ChunkContentType.CHUNK_REF) {
    return `[Reference to chunk: ${(content as { chunkId: string }).chunkId}]`;
  }

  // Fallback: serialize as JSON
  try {
    const { type, ...rest } = content;
    return JSON.stringify(rest, null, 2);
  } catch {
    return '[Non-serializable content]';
  }
}

/**
 * Build XML attributes string from metadata
 */
function buildAttributes(attrs: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      const strValue =
        typeof value === 'string' ? value : JSON.stringify(value);
      // Escape quotes in attribute values
      const escaped = strValue.replace(/"/g, '&quot;');
      parts.push(`${key}="${escaped}"`);
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

// ============ System Chunk Renderer ============

export class SystemChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.SYSTEM;
  }

  getRole(_chunk: MemoryChunk): ContextMessageRole {
    return 'system';
  }

  render(chunk: MemoryChunk): string {
    const content = extractTextContent(chunk);
    const attrs = buildAttributes({
      id: chunk.id,
      priority: chunk.priority,
    });
    return `<system_context${attrs}>\n${content}\n</system_context>`;
  }
}

// ============ Agent Chunk Renderer ============

export class AgentChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.AGENT;
  }

  getRole(chunk: MemoryChunk): ContextMessageRole {
    const content = chunk.content;
    if ('role' in content) {
      if (content.role === 'user') return 'user';
      if (content.role === 'assistant') return 'assistant';
    }
    return 'user';
  }

  render(chunk: MemoryChunk): string {
    const content = extractTextContent(chunk);
    const role = 'role' in chunk.content ? chunk.content.role : 'unknown';
    const action = 'action' in chunk.content ? chunk.content.action : undefined;

    const attrs = buildAttributes({
      id: chunk.id,
      role,
      action,
    });

    if (role === 'user') {
      return `<user_message${attrs}>\n${content}\n</user_message>`;
    } else if (role === 'assistant') {
      if (action === 'clarification') {
        return `<assistant_clarification${attrs}>\n${content}\n</assistant_clarification>`;
      }
      return `<assistant_response${attrs}>\n${content}\n</assistant_response>`;
    }

    return `<agent_message${attrs}>\n${content}\n</agent_message>`;
  }
}

// ============ Workflow Chunk Renderer ============

export class WorkflowChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.WORKFLOW;
  }

  getRole(_chunk: MemoryChunk): ContextMessageRole {
    return 'assistant';
  }

  render(chunk: MemoryChunk): string {
    const content = chunk.content;
    const action = 'action' in content ? content.action : 'unknown';
    const toolName = 'toolName' in content ? content.toolName : undefined;
    const skillName = 'skillName' in content ? content.skillName : undefined;
    const callId = 'callId' in content ? content.callId : undefined;
    const status = 'status' in content ? content.status : undefined;

    const attrs = buildAttributes({
      id: chunk.id,
      action,
      tool: toolName,
      skill: skillName,
      call_id: callId,
      status,
    });

    const textContent = extractTextContent(chunk);

    if (action === 'tool_call') {
      return `<tool_call${attrs}>\n${textContent}\n</tool_call>`;
    } else if (action === 'skill_call') {
      return `<skill_call${attrs}>\n${textContent}\n</skill_call>`;
    }

    return `<workflow${attrs}>\n${textContent}\n</workflow>`;
  }
}

// ============ Delegation Chunk Renderer ============

export class DelegationChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.DELEGATION;
  }

  getRole(chunk: MemoryChunk): ContextMessageRole {
    const content = chunk.content;
    // Parent messages are like user messages
    if ('role' in content && content.role === 'parent') {
      return 'user';
    }
    // SubAgent results and spawns are assistant actions
    return 'assistant';
  }

  render(chunk: MemoryChunk): string {
    const content = chunk.content;
    const action = 'action' in content ? content.action : undefined;
    const subAgentId = 'subAgentId' in content ? content.subAgentId : undefined;
    const parentAgentId =
      'parentAgentId' in content ? content.parentAgentId : undefined;
    const agentType = 'agentType' in content ? content.agentType : undefined;
    const success = 'success' in content ? content.success : undefined;

    const textContent = extractTextContent(chunk);

    if (action === 'spawn_subagent') {
      const attrs = buildAttributes({
        id: chunk.id,
        subagent_id: subAgentId,
        agent_type: agentType,
      });
      return `<spawn_subagent${attrs}>\n${textContent}\n</spawn_subagent>`;
    }

    if (action === 'message_subagent') {
      const attrs = buildAttributes({
        id: chunk.id,
        subagent_id: subAgentId,
      });
      return `<message_to_subagent${attrs}>\n${textContent}\n</message_to_subagent>`;
    }

    if (action === 'subagent_result') {
      const attrs = buildAttributes({
        id: chunk.id,
        subagent_id: subAgentId,
        success,
      });
      return `<subagent_result${attrs}>\n${textContent}\n</subagent_result>`;
    }

    if (action === 'subagent_error') {
      const attrs = buildAttributes({
        id: chunk.id,
        subagent_id: subAgentId,
      });
      return `<subagent_error${attrs}>\n${textContent}\n</subagent_error>`;
    }

    // Parent agent message
    if (parentAgentId) {
      const attrs = buildAttributes({
        id: chunk.id,
        parent_agent_id: parentAgentId,
      });
      return `<parent_agent_message${attrs}>\n${textContent}\n</parent_agent_message>`;
    }

    const attrs = buildAttributes({ id: chunk.id, action });
    return `<delegation${attrs}>\n${textContent}\n</delegation>`;
  }
}

// ============ Environment Chunk Renderer ============

export class EnvironmentChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.ENVIRONMENT;
  }

  getRole(_chunk: MemoryChunk): ContextMessageRole {
    return 'user'; // Environment responses are like system/user providing info
  }

  render(chunk: MemoryChunk): string {
    const content = chunk.content;
    const source = 'source' in content ? content.source : 'unknown';
    const toolName = 'toolName' in content ? content.toolName : undefined;
    const skillName = 'skillName' in content ? content.skillName : undefined;
    const callId = 'callId' in content ? content.callId : undefined;
    const success = 'success' in content ? content.success : undefined;

    const textContent = extractTextContent(chunk);

    if (source === 'tool' || source === 'tool_error') {
      const attrs = buildAttributes({
        id: chunk.id,
        tool: toolName,
        call_id: callId,
        success,
        error: source === 'tool_error' ? true : undefined,
      });
      return `<tool_result${attrs}>\n${textContent}\n</tool_result>`;
    }

    if (source === 'skill' || source === 'skill_error') {
      const attrs = buildAttributes({
        id: chunk.id,
        skill: skillName,
        call_id: callId,
        success,
        error: source === 'skill_error' ? true : undefined,
      });
      return `<skill_result${attrs}>\n${textContent}\n</skill_result>`;
    }

    const attrs = buildAttributes({
      id: chunk.id,
      source,
    });
    return `<environment${attrs}>\n${textContent}\n</environment>`;
  }
}

// ============ Working Flow Chunk Renderer ============

export class WorkingFlowChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.WORKING_FLOW;
  }

  getRole(chunk: MemoryChunk): ContextMessageRole {
    const subType = chunk.subType;
    if (subType === WorkingFlowSubType.USER) {
      return 'user';
    }
    return 'assistant';
  }

  render(chunk: MemoryChunk): string {
    const subType = chunk.subType;
    const textContent = extractTextContent(chunk);
    const custom = chunk.metadata.custom;

    // Handle compacted summaries
    if (subType === WorkingFlowSubType.COMPACTED) {
      const attrs = buildAttributes({
        id: chunk.id,
        compacted_at: custom?.compactedAt,
        original_count: custom?.originalChunkCount,
      });
      return `<progress_summary${attrs}>\n${textContent}\n</progress_summary>`;
    }

    // Handle TODO-related chunks
    if (custom?.subType === 'todo') {
      const action =
        'action' in chunk.content ? chunk.content.action : undefined;
      const attrs = buildAttributes({
        id: chunk.id,
        action,
      });
      return `<todo_update${attrs}>\n${textContent}\n</todo_update>`;
    }

    // Handle other subtypes
    const subTypeTag = this.getSubTypeTag(subType);
    const attrs = buildAttributes({
      id: chunk.id,
      subtype: subType,
    });

    return `<${subTypeTag}${attrs}>\n${textContent}\n</${subTypeTag}>`;
  }

  private getSubTypeTag(subType?: WorkingFlowSubType): string {
    switch (subType) {
      case WorkingFlowSubType.USER:
        return 'user_intervention';
      case WorkingFlowSubType.THINKING:
        return 'thinking';
      case WorkingFlowSubType.RESPONSE:
        return 'intermediate_response';
      case WorkingFlowSubType.AGENT_ACTION:
        return 'agent_action';
      case WorkingFlowSubType.ACTION_RESPONSE:
        return 'action_response';
      default:
        return 'working_flow';
    }
  }
}

// ============ Output Chunk Renderer ============

export class OutputChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.type === ChunkType.OUTPUT;
  }

  getRole(_chunk: MemoryChunk): ContextMessageRole {
    return 'assistant';
  }

  render(chunk: MemoryChunk): string {
    const content = chunk.content;
    const action = 'action' in content ? content.action : undefined;
    const textContent = extractTextContent(chunk);

    if (action === 'task_completed') {
      const attrs = buildAttributes({
        id: chunk.id,
      });
      return `<task_completed${attrs}>\n${textContent}\n</task_completed>`;
    }

    if (action === 'task_abandoned') {
      const reason = 'reason' in content ? content.reason : undefined;
      const attrs = buildAttributes({
        id: chunk.id,
        reason,
      });
      return `<task_abandoned${attrs}>\n${textContent}\n</task_abandoned>`;
    }

    if (action === 'task_terminated') {
      const terminatedBy =
        'terminatedBy' in content ? content.terminatedBy : undefined;
      const attrs = buildAttributes({
        id: chunk.id,
        terminated_by: terminatedBy,
      });
      return `<task_terminated${attrs}>\n${textContent}\n</task_terminated>`;
    }

    const attrs = buildAttributes({ id: chunk.id, action });
    return `<output${attrs}>\n${textContent}\n</output>`;
  }
}

// ============ Default Renderers ============

/**
 * Get all default chunk renderers
 */
export function getDefaultRenderers(): IChunkRenderer[] {
  return [
    new SystemChunkRenderer(),
    new AgentChunkRenderer(),
    new WorkflowChunkRenderer(),
    new DelegationChunkRenderer(),
    new EnvironmentChunkRenderer(),
    new WorkingFlowChunkRenderer(),
    new OutputChunkRenderer(),
  ];
}
