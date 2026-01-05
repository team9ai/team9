/**
 * Agent Executor
 *
 * Runtime-level orchestrator that wraps the framework's LLMLoopExecutor
 * and configures it with runtime-specific tool handlers.
 *
 * This class maintains backward compatibility with the original AgentExecutor API
 * while delegating the core LLM loop logic to the framework.
 */

import type {
  MemoryManager,
  ILLMAdapter,
  CustomToolConfig,
  IToolRegistry,
  LLMLoopExecutionResult,
} from '@team9/agent-framework';
import {
  LLMLoopExecutor,
  createDefaultToolRegistry,
} from '@team9/agent-framework';
import { InvokeToolHandler } from './invoke-tool.handler.js';

/**
 * Agent Executor Configuration
 */
export interface AgentExecutorConfig {
  /** Maximum number of LLM turns before stopping */
  maxTurns?: number;
  /** Timeout in milliseconds for each LLM call */
  timeout?: number;
  /** Whether to auto-run after inject */
  autoRun?: boolean;
  /** Available control tool names for this agent */
  tools?: string[];
  /** Custom external tools (registered as common tools by default) */
  customTools?: CustomToolConfig[];
  /** Complete tool registry instance (overrides tools and customTools) */
  toolRegistry?: IToolRegistry;
}

/**
 * Execution result from running the agent loop
 * Alias for LLMLoopExecutionResult for backward compatibility
 */
export type ExecutionResult = LLMLoopExecutionResult;

// Re-export CancellationToken (type) and CancellationTokenSource (class) for backward compatibility
export type { CancellationToken } from '@team9/agent-framework';
export { CancellationTokenSource } from '@team9/agent-framework';

/**
 * Internal config type with resolved defaults
 */
interface ResolvedConfig {
  maxTurns: number;
  timeout: number;
  autoRun: boolean;
  tools: string[];
}

/**
 * AgentExecutor handles the LLM response generation loop
 *
 * This is the runtime-level wrapper that:
 * 1. Initializes the tool registry with custom tools
 * 2. Creates the InvokeToolHandler for external tool execution
 * 3. Delegates to LLMLoopExecutor for the core loop logic
 *
 * Flow:
 * 1. User message is injected into Memory
 * 2. Executor builds context from Memory state
 * 3. Calls LLM to generate a response (with tools)
 * 4. If LLM calls a tool, dispatch tool call event and stop (or auto-execute invoke_tool)
 * 5. If LLM returns text only, dispatch text response and continue loop
 * 6. Loop stops when: tool call, max turns reached, task ended, or cancelled
 */
export class AgentExecutor {
  private config: ResolvedConfig;
  private loopExecutor: LLMLoopExecutor;
  private _toolRegistry: IToolRegistry;
  private invokeToolHandler: InvokeToolHandler;

  constructor(
    memoryManager: MemoryManager,
    llmAdapter: ILLMAdapter,
    config: AgentExecutorConfig = {},
  ) {
    this.config = {
      maxTurns: config.maxTurns ?? 10,
      timeout: config.timeout ?? 60000,
      autoRun: config.autoRun ?? true,
      tools: config.tools ?? [],
    };

    // Initialize tool registry
    this._toolRegistry = this.initializeToolRegistry(config);

    // Create the invoke_tool handler
    this.invokeToolHandler = new InvokeToolHandler(this._toolRegistry);

    // Create the LLM loop executor with our handler
    this.loopExecutor = new LLMLoopExecutor(memoryManager, llmAdapter, {
      maxTurns: this.config.maxTurns,
      timeout: this.config.timeout,
      tools: this.config.tools,
      toolCallHandlers: [this.invokeToolHandler],
    });

    console.log(
      '[AgentExecutor] Initialized with control tools:',
      this.config.tools,
    );
    console.log(
      '[AgentExecutor] Tool registry has',
      this._toolRegistry.getAllToolNames().length,
      'tools',
    );
  }

  /**
   * Initialize tool registry with control tools and custom tools
   */
  private initializeToolRegistry(config: AgentExecutorConfig): IToolRegistry {
    // If a complete registry is provided, use it directly
    if (config.toolRegistry) {
      return config.toolRegistry;
    }

    // Create default registry with control tools
    const registry = createDefaultToolRegistry();

    // Register custom tools
    if (config.customTools && config.customTools.length > 0) {
      for (const custom of config.customTools) {
        registry.register({
          definition: custom.definition,
          executor: custom.executor,
          category: custom.category ?? 'common',
        });
      }
      console.log(
        '[AgentExecutor] Registered',
        config.customTools.length,
        'custom tools',
      );
    }

    return registry;
  }

  /**
   * Get the tool registry for external access (e.g., for invoke_tool handling)
   */
  get toolRegistry(): IToolRegistry {
    return this._toolRegistry;
  }

  /**
   * Cancel any currently running execution for the given thread
   * If an LLM call is in progress, the response will be discarded when it returns
   *
   * @param threadId - Optional thread ID to cancel. If not provided, cancels current execution.
   * @returns true if there was an execution to cancel, false otherwise
   */
  cancel(threadId?: string): boolean {
    return this.loopExecutor.cancel(threadId);
  }

  /**
   * Check if execution is currently running
   */
  isRunning(): boolean {
    return this.loopExecutor.isRunning();
  }

  /**
   * Check if execution is cancelled
   */
  isCancelled(): boolean {
    return this.loopExecutor.isCancelled();
  }

  /**
   * Run agent loop until it needs to wait for external response or reaches max turns
   *
   * Continues running when:
   * - LLM_TEXT_RESPONSE: just output, can continue
   * - After receiving TOOL_RESULT/SKILL_RESULT/SUBAGENT_RESULT
   *
   * Stops running when:
   * - LLM_TOOL_CALL: wait for tool execution (except invoke_tool which is auto-executed)
   * - LLM_SKILL_CALL: wait for skill execution
   * - LLM_SUBAGENT_SPAWN: wait for subagent
   * - LLM_CLARIFICATION: wait for user clarification
   * - TASK_COMPLETED/TASK_ABANDONED/TASK_TERMINATED: task ended
   * - Max turns reached
   * - Cancelled via cancel()
   */
  async run(threadId: string): Promise<ExecutionResult> {
    return this.loopExecutor.run(threadId);
  }
}

/**
 * Create an agent executor
 */
export function createAgentExecutor(
  memoryManager: MemoryManager,
  llmAdapter: ILLMAdapter,
  config?: AgentExecutorConfig,
): AgentExecutor {
  return new AgentExecutor(memoryManager, llmAdapter, config);
}
