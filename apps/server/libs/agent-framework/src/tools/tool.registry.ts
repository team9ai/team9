/**
 * Tool Registry
 * Manages tool registration, lookup, and execution with category support
 */

import type {
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  ToolExecutionContext,
  ToolCategory,
  Tool,
} from './tool.types.js';
import { controlTools } from './control/index.js';

/**
 * Interface for tool registry
 */
export interface IToolRegistry {
  /** Register a tool */
  register(tool: Tool): void;

  /** Register multiple tools */
  registerAll(tools: Tool[]): void;

  /** Unregister a tool by name */
  unregister(name: string): void;

  /** Get complete tool by name */
  getTool(name: string): Tool | undefined;

  /** Get tool definition by name */
  getDefinition(name: string): ToolDefinition | undefined;

  /** Get tool executor by name */
  getExecutor(name: string): ToolExecutor | undefined;

  /** Check if tool exists */
  has(name: string): boolean;

  /** Get all tool names */
  getAllToolNames(): string[];

  /** Get tools by category */
  getToolsByCategory(category: ToolCategory): Tool[];

  /** Get tool definitions by names */
  getDefinitionsByNames(names: string[]): ToolDefinition[];

  /** Execute a tool by name */
  execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;

  /** Format tool list for LLM context (grouped by category) */
  formatToolListForContext(): string;
}

/**
 * Tool Registry implementation
 */
export class ToolRegistry implements IToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      console.warn(
        `[ToolRegistry] Tool "${tool.definition.name}" already registered, overwriting`,
      );
    }
    this.tools.set(tool.definition.name, tool);
  }

  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  getExecutor(name: string): ToolExecutor | undefined {
    return this.tools.get(name)?.executor;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getToolsByCategory(category: ToolCategory): Tool[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.category === category,
    );
  }

  getDefinitionsByNames(names: string[]): ToolDefinition[] {
    return names
      .map((name) => this.getDefinition(name))
      .filter((d): d is ToolDefinition => d !== undefined);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        callId: context.callId,
        success: false,
        content: null,
        error: `Tool not found: ${name}`,
      };
    }

    if (!tool.executor) {
      return {
        callId: context.callId,
        success: false,
        content: null,
        error: `Tool "${name}" has no executor`,
      };
    }

    try {
      return await tool.executor(args, context);
    } catch (error) {
      return {
        callId: context.callId,
        success: false,
        content: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Format a single tool for display in context
   */
  private formatToolForContext(tool: Tool): string {
    const def = tool.definition;
    const params = def.parameters;

    // Build parameter list
    const paramList: string[] = [];
    if (params.properties) {
      for (const [name, prop] of Object.entries(params.properties)) {
        const required = params.required?.includes(name) ? ' (required)' : '';
        const enumVals = prop.enum ? ` [${prop.enum.join('|')}]` : '';
        paramList.push(
          `    - ${name}: ${prop.type}${enumVals}${required} - ${prop.description || ''}`,
        );
      }
    }

    const paramsStr =
      paramList.length > 0 ? `\n  Parameters:\n${paramList.join('\n')}` : '';

    return `- ${def.name}: ${def.description}${paramsStr}`;
  }

  /**
   * Format tool list for LLM context, grouped by category
   * Only includes non-control tools (common, agent, workflow)
   */
  formatToolListForContext(): string {
    const sections: string[] = [];

    const common = this.getToolsByCategory('common');
    if (common.length > 0) {
      sections.push(
        'Common Tools:\n' +
          common.map((t) => this.formatToolForContext(t)).join('\n\n'),
      );
    }

    const agent = this.getToolsByCategory('agent');
    if (agent.length > 0) {
      sections.push(
        'Agent Tools:\n' +
          agent.map((t) => this.formatToolForContext(t)).join('\n\n'),
      );
    }

    const workflow = this.getToolsByCategory('workflow');
    if (workflow.length > 0) {
      sections.push(
        'Workflow Tools:\n' +
          workflow.map((t) => this.formatToolForContext(t)).join('\n\n'),
      );
    }

    if (sections.length === 0) {
      return '';
    }

    return (
      '[AVAILABLE TOOLS] (use invoke_tool to call)\n\n' + sections.join('\n\n')
    );
  }
}

/**
 * Create a default executor for control tools (no-op, handled by framework)
 */
function createControlToolExecutor(toolName: string): ToolExecutor {
  return async (_args, context) => {
    // Control tools don't execute here - they're handled by the framework
    // This executor just returns success to satisfy the Tool interface
    return {
      callId: context.callId,
      success: true,
      content: {
        tool: toolName,
        message: 'Control tool - handled by framework',
      },
    };
  };
}

/**
 * Create a default tool registry with control tools pre-registered
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register all control tools with default executors
  for (const controlTool of controlTools) {
    registry.register({
      definition: controlTool,
      executor: createControlToolExecutor(controlTool.name),
      category: 'control',
    });
  }

  return registry;
}
