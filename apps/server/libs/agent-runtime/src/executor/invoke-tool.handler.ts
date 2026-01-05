/**
 * InvokeToolHandler
 *
 * Handles `invoke_tool` calls by executing external tools via the ToolRegistry.
 * This handler is runtime-specific because it needs access to the actual tool
 * implementations (like SEMrush API, etc.) that are registered in the runtime.
 */

import type {
  IToolCallHandler,
  ToolCallHandlerContext,
  ToolCallHandlerResult,
} from '@team9/agent-framework';
import type { IToolRegistry, AgentEvent } from '@team9/agent-framework';
import { EventType } from '@team9/agent-framework';

/**
 * Handler for `invoke_tool` control tool calls
 *
 * When the LLM calls `invoke_tool`, this handler:
 * 1. Extracts the target tool name and arguments
 * 2. Executes the tool via the ToolRegistry
 * 3. Creates a TOOL_RESULT event with the result
 * 4. Signals the loop to continue (shouldContinue=true)
 */
export class InvokeToolHandler implements IToolCallHandler {
  constructor(private toolRegistry: IToolRegistry) {}

  /**
   * Check if this handler can process the tool call
   */
  canHandle(toolName: string): boolean {
    return toolName === 'invoke_tool';
  }

  /**
   * Handle the invoke_tool call
   */
  async handle(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolCallHandlerContext,
  ): Promise<ToolCallHandlerResult> {
    const externalToolName = args.tool_name as string | undefined;
    const externalToolArgs = (args.arguments as Record<string, unknown>) ?? {};

    if (!externalToolName) {
      console.warn('[InvokeToolHandler] Missing tool_name in invoke_tool call');
      // Return error result event
      const errorEvent: AgentEvent = {
        type: EventType.TOOL_RESULT,
        toolName: 'invoke_tool',
        callId: context.callId,
        success: false,
        result: { error: 'Missing tool_name parameter' },
        timestamp: Date.now(),
      };
      return {
        shouldContinue: true,
        resultEvents: [errorEvent],
      };
    }

    console.log(
      '[InvokeToolHandler] Executing tool:',
      externalToolName,
      externalToolArgs,
    );

    try {
      // Execute the external tool
      const toolResult = await this.toolRegistry.execute(
        externalToolName,
        externalToolArgs,
        {
          threadId: context.threadId,
          callId: context.callId,
        },
      );

      console.log(
        '[InvokeToolHandler] Tool result:',
        toolResult.success,
        toolResult.content,
      );

      // Create TOOL_RESULT event
      const resultContent = toolResult.success
        ? toolResult.content
        : { error: toolResult.error, content: toolResult.content };

      const toolResultEvent: AgentEvent = {
        type: EventType.TOOL_RESULT,
        toolName: externalToolName,
        callId: context.callId,
        success: toolResult.success,
        result: resultContent,
        timestamp: Date.now(),
      };

      return {
        shouldContinue: true,
        resultEvents: [toolResultEvent],
      };
    } catch (error) {
      console.error('[InvokeToolHandler] Tool execution error:', error);

      // Create error result event
      const errorEvent: AgentEvent = {
        type: EventType.TOOL_RESULT,
        toolName: externalToolName,
        callId: context.callId,
        success: false,
        result: {
          error: error instanceof Error ? error.message : String(error),
        },
        timestamp: Date.now(),
      };

      return {
        shouldContinue: true,
        resultEvents: [errorEvent],
      };
    }
  }
}

/**
 * Create an InvokeToolHandler instance
 */
export function createInvokeToolHandler(
  toolRegistry: IToolRegistry,
): InvokeToolHandler {
  return new InvokeToolHandler(toolRegistry);
}
