/**
 * ComponentContext - Runtime context for components
 */

import type { MemoryChunk } from '../types/chunk.types.js';
import type { MemoryState } from '../types/state.types.js';
import type {
  ComponentContext,
  ComponentRuntimeState,
} from './component.interface.js';

/**
 * Default implementation of ComponentContext
 */
export class DefaultComponentContext implements ComponentContext {
  public readonly threadId: string;
  public readonly componentId: string;
  private readonly state: MemoryState;
  private readonly runtimeState: ComponentRuntimeState;

  constructor(
    threadId: string,
    componentId: string,
    state: MemoryState,
    runtimeState: ComponentRuntimeState,
  ) {
    this.threadId = threadId;
    this.componentId = componentId;
    this.state = state;
    this.runtimeState = runtimeState;
  }

  getOwnedChunks(): MemoryChunk[] {
    return this.runtimeState.chunkIds
      .map((id) => this.state.chunks.get(id))
      .filter((chunk): chunk is MemoryChunk => chunk !== undefined);
  }

  getData<T>(key: string): T | undefined {
    return this.runtimeState.data[key] as T | undefined;
  }

  setData<T>(key: string, value: T): void {
    this.runtimeState.data[key] = value;
  }
}

/**
 * Factory function to create ComponentContext
 */
export function createComponentContext(
  threadId: string,
  componentId: string,
  state: MemoryState,
  runtimeState: ComponentRuntimeState,
): ComponentContext {
  return new DefaultComponentContext(
    threadId,
    componentId,
    state,
    runtimeState,
  );
}
