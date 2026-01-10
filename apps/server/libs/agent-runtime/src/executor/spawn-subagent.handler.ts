/**
 * SpawnSubagentHandler
 *
 * Handles `spawn_subagent` tool calls by creating and running subagent threads.
 * This handler manages the lifecycle of subagents including:
 * - Creating child threads with inherited context
 * - Running subagents asynchronously
 * - Monitoring subagent progress
 * - Propagating results back to parent agents
 */

import type {
  IToolCallHandler,
  ToolCallHandlerContext,
  ToolCallHandlerResult,
  AgentEvent,
  Blueprint,
  AgentOrchestrator,
  MemoryState,
  MemoryChunk,
  ILLMAdapter,
} from '@team9/agent-framework';
import {
  EventType,
  buildInheritedContext,
  createSubagentContextSummary,
} from '@team9/agent-framework';

/**
 * Callback for when a subagent completes
 */
export type SubagentCompleteCallback = (
  parentThreadId: string,
  childThreadId: string,
  subagentKey: string,
  result: unknown,
  success: boolean,
) => Promise<void>;

/**
 * Callback for subagent step events
 */
export type SubagentStepCallback = (
  parentThreadId: string,
  childThreadId: string,
  subagentKey: string,
  event: AgentEvent,
) => void;

/**
 * Callback when subagent is created (for setting up observers)
 */
export type SubagentCreatedCallback = (
  parentAgentId: string,
  childThreadId: string,
  subagentKey: string,
  memoryManager: AgentOrchestrator,
) => void;

/**
 * Configuration for SpawnSubagentHandler
 */
export interface SpawnSubagentHandlerConfig {
  /** Parent blueprint containing subagent definitions */
  parentBlueprint: Blueprint;
  /** Factory function to create a new MemoryManager for subagent */
  createMemoryManager: (blueprint: Blueprint) => Promise<AgentOrchestrator>;
  /** Factory function to create a new LLM adapter for subagent */
  createLLMAdapter: (blueprint: Blueprint) => ILLMAdapter;
  /** Callback when subagent completes */
  onSubagentComplete?: SubagentCompleteCallback;
  /** Callback for subagent step events */
  onSubagentStep?: SubagentStepCallback;
  /** Callback when subagent is created (for setting up observers) */
  onSubagentCreated?: SubagentCreatedCallback;
  /** Parent agent ID for callbacks */
  parentAgentId?: string;
}

/**
 * Handler for `spawn_subagent` control tool calls
 *
 * When the LLM calls `spawn_subagent`, this handler:
 * 1. Validates the subagent key exists in the blueprint
 * 2. Creates a new thread with inherited context
 * 3. Links the child thread to the parent
 * 4. Starts the subagent execution asynchronously
 * 5. Returns immediately (shouldContinue=false) to wait for results
 */
/**
 * Pending spawn information stored until event is processed
 */
interface PendingSpawnInfo {
  parentThreadId: string;
  subagentKey: string;
  task: string;
  blueprint: Blueprint;
  context?: Record<string, unknown>;
  orchestrator: AgentOrchestrator;
}

export class SpawnSubagentHandler implements IToolCallHandler {
  private config: SpawnSubagentHandlerConfig;
  private runningSubagents: Map<
    string,
    {
      parentThreadId: string;
      subagentKey: string;
      executor: unknown; // AgentExecutor, but avoid circular dependency
    }
  > = new Map();
  private pendingSpawns: Map<string, PendingSpawnInfo> = new Map();

  constructor(config: SpawnSubagentHandlerConfig) {
    this.config = config;
  }

  /**
   * Check if this handler can process the tool call
   */
  canHandle(toolName: string): boolean {
    return toolName === 'spawn_subagent';
  }

  /**
   * Handle the spawn_subagent call
   *
   * This handler only validates parameters and returns an LLM_SUBAGENT_SPAWN event.
   * The actual subagent execution is triggered when the event is processed
   * (via onSpawnEvent callback).
   */
  async handle(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolCallHandlerContext,
  ): Promise<ToolCallHandlerResult> {
    const subagentKey = args.subagent_key as string | undefined;
    const task = args.task as string | undefined;
    const subagentContext = args.context as Record<string, unknown> | undefined;

    // Validate required parameters
    if (!subagentKey) {
      console.warn(
        '[SpawnSubagentHandler] Missing subagent_key in spawn_subagent call',
      );
      return this.createErrorResult(
        context.callId,
        'Missing subagent_key parameter',
      );
    }

    if (!task) {
      console.warn(
        '[SpawnSubagentHandler] Missing task in spawn_subagent call',
      );
      return this.createErrorResult(context.callId, 'Missing task parameter');
    }

    // Get subagent blueprint
    const subagentBlueprint =
      this.config.parentBlueprint.subAgents?.[subagentKey];
    if (!subagentBlueprint) {
      console.warn(
        `[SpawnSubagentHandler] Subagent '${subagentKey}' not found in blueprint`,
      );
      return this.createErrorResult(
        context.callId,
        `Subagent '${subagentKey}' not found in blueprint configuration`,
      );
    }

    console.log(
      '[SpawnSubagentHandler] Creating spawn event for subagent:',
      subagentKey,
      'with task:',
      task.substring(0, 100),
    );

    // Store pending spawn info for later execution when event is processed
    const spawnId = `spawn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.pendingSpawns.set(spawnId, {
      parentThreadId: context.threadId,
      subagentKey,
      task,
      blueprint: subagentBlueprint,
      context: subagentContext,
      orchestrator: context.orchestrator,
    });

    // Create spawn event - actual execution happens when this event is processed
    const spawnEvent: AgentEvent = {
      type: EventType.LLM_SUBAGENT_SPAWN,
      subAgentId: spawnId, // Temporary ID, will be replaced with actual thread ID
      agentType: subagentKey,
      task,
      config: subagentContext,
      timestamp: Date.now(),
    };

    // Return with spawn event - stop the loop to wait for subagent result
    return {
      shouldContinue: false, // Stop the parent loop, wait for subagent result
      resultEvents: [spawnEvent],
    };
  }

  /**
   * Called when LLM_SUBAGENT_SPAWN event is being processed
   * This is where the actual subagent execution is triggered
   */
  async onSpawnEvent(spawnId: string): Promise<string | null> {
    const pendingSpawn = this.pendingSpawns.get(spawnId);
    if (!pendingSpawn) {
      console.warn(
        '[SpawnSubagentHandler] No pending spawn found for:',
        spawnId,
      );
      return null;
    }

    this.pendingSpawns.delete(spawnId);

    const {
      parentThreadId,
      subagentKey,
      task,
      blueprint,
      context: subagentContext,
      orchestrator,
    } = pendingSpawn;

    try {
      // Get parent state for context inheritance
      const parentState = await orchestrator.getCurrentState(parentThreadId);
      if (!parentState) {
        console.error('[SpawnSubagentHandler] Parent thread state not found');
        return null;
      }

      // Create child thread with subagent
      const childThreadId = await this.createSubagentThread(
        { threadId: parentThreadId, callId: '', orchestrator },
        blueprint,
        subagentKey,
        task,
        parentState,
        subagentContext,
      );

      console.log(
        '[SpawnSubagentHandler] Created and started subagent thread:',
        childThreadId,
      );

      return childThreadId;
    } catch (error) {
      console.error('[SpawnSubagentHandler] Error in onSpawnEvent:', error);
      return null;
    }
  }

  /**
   * Create a subagent thread with inherited context
   */
  private async createSubagentThread(
    context: ToolCallHandlerContext,
    blueprint: Blueprint,
    subagentKey: string,
    task: string,
    parentState: MemoryState,
    subagentContext?: Record<string, unknown>,
  ): Promise<string> {
    // Create memory manager for subagent
    const subagentMemoryManager =
      await this.config.createMemoryManager(blueprint);

    // Build inherited context from parent
    const parentChunks = await this.getParentChunks(context, parentState);
    const inheritedContext = buildInheritedContext(parentState, parentChunks);

    // Create context summary for the subagent
    const contextSummary = createSubagentContextSummary(inheritedContext, task);

    // Create thread with parent reference
    const { thread } = await subagentMemoryManager.createThread({
      parentThreadId: context.threadId,
      blueprintKey: subagentKey,
      custom: {
        task,
        parentContext: subagentContext,
        contextSummary,
      },
    });

    // Link child to parent
    await context.orchestrator.addChildThread(context.threadId, thread.id);

    // Inject initial user message (the task)
    const initialMessage: AgentEvent = {
      type: EventType.USER_MESSAGE,
      content: task,
      timestamp: Date.now(),
    };
    await subagentMemoryManager.dispatch(thread.id, initialMessage);

    // Start subagent execution asynchronously
    this.runSubagentAsync(
      thread.id,
      context.threadId,
      subagentKey,
      subagentMemoryManager,
      blueprint,
    );

    return thread.id;
  }

  /**
   * Get parent chunks for context inheritance
   */
  private async getParentChunks(
    context: ToolCallHandlerContext,
    parentState: MemoryState,
  ): Promise<Map<string, MemoryChunk>> {
    const chunks = new Map<string, MemoryChunk>();

    // Get chunks from state directly via orchestrator
    // Note: This is a simplified approach - chunks are already in the state
    for (const chunkId of parentState.chunkIds) {
      const chunk = parentState.chunks.get(chunkId);
      if (chunk) {
        chunks.set(chunkId, chunk);
      }
    }

    return chunks;
  }

  /**
   * Run subagent execution asynchronously
   */
  private async runSubagentAsync(
    childThreadId: string,
    parentThreadId: string,
    subagentKey: string,
    memoryManager: AgentOrchestrator,
    blueprint: Blueprint,
  ): Promise<void> {
    try {
      // Import AgentExecutor dynamically to avoid circular dependency
      const { AgentExecutor } = await import('./agent-executor.js');

      // Create LLM adapter for subagent
      const llmAdapter = this.config.createLLMAdapter(blueprint);

      // Create executor for subagent
      const executor = new AgentExecutor(memoryManager, llmAdapter, {
        tools: blueprint.tools ?? [],
        maxTurns: 10, // Limit subagent turns
      });

      // Track running subagent
      this.runningSubagents.set(childThreadId, {
        parentThreadId,
        subagentKey,
        executor,
      });

      // Notify that subagent is created (for setting up SSE observers in debugger)
      if (this.config.onSubagentCreated && this.config.parentAgentId) {
        this.config.onSubagentCreated(
          this.config.parentAgentId,
          childThreadId,
          subagentKey,
          memoryManager,
        );
      }

      // Set up observer for subagent progress
      const unsubscribe = memoryManager.addObserver({
        onStateChange: (info) => {
          // Notify parent about subagent progress
          if (this.config.onSubagentStep) {
            const event: AgentEvent = {
              type: EventType.LLM_TEXT_RESPONSE,
              content: `Subagent state changed`,
              timestamp: Date.now(),
            };
            this.config.onSubagentStep(
              parentThreadId,
              childThreadId,
              subagentKey,
              event,
            );
          }
        },
      });

      // Run the subagent
      console.log(
        '[SpawnSubagentHandler] Starting subagent execution:',
        childThreadId,
      );
      const result = await executor.run(childThreadId);
      console.log(
        '[SpawnSubagentHandler] Subagent completed:',
        childThreadId,
        result,
      );

      // Clean up
      unsubscribe();
      this.runningSubagents.delete(childThreadId);

      // Notify completion
      if (this.config.onSubagentComplete) {
        await this.config.onSubagentComplete(
          parentThreadId,
          childThreadId,
          subagentKey,
          {
            success: result.success,
            lastResponse: result.lastResponse,
            turnsExecuted: result.turnsExecuted,
          },
          result.success,
        );
      }
    } catch (error) {
      console.error('[SpawnSubagentHandler] Subagent execution error:', error);

      // Clean up
      this.runningSubagents.delete(childThreadId);

      // Notify failure
      if (this.config.onSubagentComplete) {
        await this.config.onSubagentComplete(
          parentThreadId,
          childThreadId,
          subagentKey,
          { error: error instanceof Error ? error.message : String(error) },
          false,
        );
      }
    }
  }

  /**
   * Create an error result for tool call failures
   */
  private createErrorResult(
    callId: string,
    errorMessage: string,
  ): ToolCallHandlerResult {
    const errorEvent: AgentEvent = {
      type: EventType.TOOL_RESULT,
      toolName: 'spawn_subagent',
      callId,
      success: false,
      result: { error: errorMessage },
      timestamp: Date.now(),
    };

    return {
      shouldContinue: true, // Continue with error result
      resultEvents: [errorEvent],
    };
  }

  /**
   * Cancel a running subagent
   */
  cancelSubagent(childThreadId: string): boolean {
    const subagent = this.runningSubagents.get(childThreadId);
    if (subagent && subagent.executor) {
      // Cast to AgentExecutor and cancel
      const executor = subagent.executor as { cancel: () => boolean };
      if (typeof executor.cancel === 'function') {
        return executor.cancel();
      }
    }
    return false;
  }

  /**
   * Get all running subagents for a parent thread
   */
  getRunningSubagents(parentThreadId: string): string[] {
    const result: string[] = [];
    for (const [childId, info] of this.runningSubagents) {
      if (info.parentThreadId === parentThreadId) {
        result.push(childId);
      }
    }
    return result;
  }
}

/**
 * Create a SpawnSubagentHandler instance
 */
export function createSpawnSubagentHandler(
  config: SpawnSubagentHandlerConfig,
): SpawnSubagentHandler {
  return new SpawnSubagentHandler(config);
}
