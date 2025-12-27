import type {
  MemoryObserver,
  ObserverManager,
  EventDispatchInfo,
  ReducerExecuteInfo,
  StateChangeInfo,
  SubAgentSpawnInfo,
  SubAgentResultInfo,
  CompactionStartInfo,
  CompactionEndInfo,
  ErrorInfo,
} from './observer.types.js';

/**
 * Default implementation of ObserverManager
 */
export class DefaultObserverManager implements ObserverManager {
  private observers: Set<MemoryObserver> = new Set();

  /**
   * Add an observer
   * @returns Unsubscribe function
   */
  addObserver(observer: MemoryObserver): () => void {
    this.observers.add(observer);
    return () => this.removeObserver(observer);
  }

  /**
   * Remove an observer
   */
  removeObserver(observer: MemoryObserver): void {
    this.observers.delete(observer);
  }

  /**
   * Get the number of observers
   */
  get observerCount(): number {
    return this.observers.size;
  }

  /**
   * Notify all observers of an event dispatch
   */
  notifyEventDispatch(info: EventDispatchInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onEventDispatch?.(info);
      } catch (error) {
        console.error('Observer error in onEventDispatch:', error);
      }
    }
  }

  /**
   * Notify all observers of reducer execution
   */
  notifyReducerExecute(info: ReducerExecuteInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onReducerExecute?.(info);
      } catch (error) {
        console.error('Observer error in onReducerExecute:', error);
      }
    }
  }

  /**
   * Notify all observers of state change
   */
  notifyStateChange(info: StateChangeInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onStateChange?.(info);
      } catch (error) {
        console.error('Observer error in onStateChange:', error);
      }
    }
  }

  /**
   * Notify all observers of sub-agent spawn
   */
  notifySubAgentSpawn(info: SubAgentSpawnInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onSubAgentSpawn?.(info);
      } catch (error) {
        console.error('Observer error in onSubAgentSpawn:', error);
      }
    }
  }

  /**
   * Notify all observers of sub-agent result
   */
  notifySubAgentResult(info: SubAgentResultInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onSubAgentResult?.(info);
      } catch (error) {
        console.error('Observer error in onSubAgentResult:', error);
      }
    }
  }

  /**
   * Notify all observers of compaction start
   */
  notifyCompactionStart(info: CompactionStartInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onCompactionStart?.(info);
      } catch (error) {
        console.error('Observer error in onCompactionStart:', error);
      }
    }
  }

  /**
   * Notify all observers of compaction end
   */
  notifyCompactionEnd(info: CompactionEndInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onCompactionEnd?.(info);
      } catch (error) {
        console.error('Observer error in onCompactionEnd:', error);
      }
    }
  }

  /**
   * Notify all observers of an error
   */
  notifyError(info: ErrorInfo): void {
    for (const observer of this.observers) {
      try {
        observer.onError?.(info);
      } catch (error) {
        console.error('Observer error in onError:', error);
      }
    }
  }

  /**
   * Clear all observers
   */
  clear(): void {
    this.observers.clear();
  }
}

/**
 * Create a new observer manager
 */
export function createObserverManager(): ObserverManager {
  return new DefaultObserverManager();
}
