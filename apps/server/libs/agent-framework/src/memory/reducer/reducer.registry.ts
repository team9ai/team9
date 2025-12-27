import { MemoryState } from '../types/state.types';
import { AgentEvent, EventType } from '../types/event.types';
import { EventReducer, ReducerRegistry, ReducerResult } from './reducer.types';
import {
  // Input reducers
  UserMessageReducer,
  ParentAgentMessageReducer,
  // LLM response reducers
  LLMTextResponseReducer,
  LLMToolCallReducer,
  LLMSkillCallReducer,
  LLMSubAgentSpawnReducer,
  LLMSubAgentMessageReducer,
  LLMClarificationReducer,
  // Response reducers
  ToolResultReducer,
  SkillResultReducer,
  SubAgentResultReducer,
  // Error reducers
  ToolErrorReducer,
  SubAgentErrorReducer,
  SkillErrorReducer,
  SystemErrorReducer,
  // Control reducers
  TaskCompletedReducer,
  TaskAbandonedReducer,
  TaskTerminatedReducer,
  TodoSetReducer,
  TodoCompletedReducer,
  TodoExpandedReducer,
  TodoUpdatedReducer,
  TodoDeletedReducer,
  MemoryMarkCriticalReducer,
  MemoryForgetReducer,
} from './reducers';

/**
 * Default implementation of ReducerRegistry
 */
export class DefaultReducerRegistry implements ReducerRegistry {
  private reducers: EventReducer[] = [];
  private reducersByEventType: Map<EventType, EventReducer[]> = new Map();

  register(reducer: EventReducer): void {
    if (this.reducers.includes(reducer)) {
      return;
    }

    this.reducers.push(reducer);

    // Index by event types
    for (const eventType of reducer.eventTypes) {
      const list = this.reducersByEventType.get(eventType) ?? [];
      list.push(reducer);
      this.reducersByEventType.set(eventType, list);
    }
  }

  unregister(reducer: EventReducer): void {
    const index = this.reducers.indexOf(reducer);
    if (index === -1) {
      return;
    }

    this.reducers.splice(index, 1);

    // Remove from index
    for (const eventType of reducer.eventTypes) {
      const list = this.reducersByEventType.get(eventType);
      if (list) {
        const idx = list.indexOf(reducer);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      }
    }
  }

  getReducersForEvent(event: AgentEvent): EventReducer[] {
    const candidates = this.reducersByEventType.get(event.type) ?? [];
    return candidates.filter((reducer) => reducer.canHandle(event));
  }

  async reduce(state: MemoryState, event: AgentEvent): Promise<ReducerResult> {
    const reducers = this.getReducersForEvent(event);

    if (reducers.length === 0) {
      return { operations: [], chunks: [] };
    }

    // Collect results from all applicable reducers
    const allOperations: ReducerResult['operations'] = [];
    const allChunks: ReducerResult['chunks'] = [];

    for (const reducer of reducers) {
      const result = await reducer.reduce(state, event);
      allOperations.push(...result.operations);
      allChunks.push(...result.chunks);
    }

    return {
      operations: allOperations,
      chunks: allChunks,
    };
  }

  /**
   * Get all registered reducers
   */
  getAllReducers(): readonly EventReducer[] {
    return this.reducers;
  }

  /**
   * Clear all registered reducers
   */
  clear(): void {
    this.reducers = [];
    this.reducersByEventType.clear();
  }
}

/**
 * Create a reducer registry with all default reducers registered
 */
export function createDefaultReducerRegistry(): ReducerRegistry {
  const registry = new DefaultReducerRegistry();

  // Input reducers
  registry.register(new UserMessageReducer());
  registry.register(new ParentAgentMessageReducer());

  // LLM response reducers
  registry.register(new LLMTextResponseReducer());
  registry.register(new LLMToolCallReducer());
  registry.register(new LLMSkillCallReducer());
  registry.register(new LLMSubAgentSpawnReducer());
  registry.register(new LLMSubAgentMessageReducer());
  registry.register(new LLMClarificationReducer());

  // Response reducers
  registry.register(new ToolResultReducer());
  registry.register(new SkillResultReducer());
  registry.register(new SubAgentResultReducer());

  // Error reducers
  registry.register(new ToolErrorReducer());
  registry.register(new SubAgentErrorReducer());
  registry.register(new SkillErrorReducer());
  registry.register(new SystemErrorReducer());

  // Control reducers
  registry.register(new TaskCompletedReducer());
  registry.register(new TaskAbandonedReducer());
  registry.register(new TaskTerminatedReducer());
  registry.register(new TodoSetReducer());
  registry.register(new TodoCompletedReducer());
  registry.register(new TodoExpandedReducer());
  registry.register(new TodoUpdatedReducer());
  registry.register(new TodoDeletedReducer());
  registry.register(new MemoryMarkCriticalReducer());
  registry.register(new MemoryForgetReducer());

  return registry;
}
