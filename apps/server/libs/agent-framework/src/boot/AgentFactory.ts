/**
 * AgentFactory - User-friendly entry point for creating and managing agents
 *
 * Provides a simplified API for:
 * - Registering components and tools
 * - Creating agents from blueprints
 * - Restoring agents from persisted state
 */

import {
  AgentOrchestrator,
  AgentOrchestratorConfig,
} from '../manager/agent-orchestrator.js';
import { BlueprintLoader } from '../blueprint/blueprint-loader.js';
import { ComponentRegistry } from '../components/component-registry.js';
import { createDefaultReducerRegistry } from '../reducer/reducer.registry.js';
import type { ComponentConstructor } from '../components/component.interface.js';
import type { Tool } from '../tools/tool.types.js';
import type { Blueprint } from '../blueprint/blueprint.types.js';
import type { AgentFactoryConfig, CreateAgentOptions } from './types.js';
import { Agent } from './Agent.js';

/**
 * AgentFactory creates and manages agent instances
 *
 * Usage:
 * ```typescript
 * const factory = new AgentFactory({
 *   storage: new InMemoryStorageProvider(),
 *   llmAdapter: myLLMAdapter,
 *   defaultLLMConfig: { model: 'gpt-4' },
 *   components: [MyComponent, AnotherComponent],
 *   tools: [myTool],
 * });
 *
 * const agent = await factory.createAgent(blueprint);
 * await agent.dispatch(someEvent);
 * ```
 */
export class AgentFactory {
  private readonly _componentRegistry: ComponentRegistry;
  private readonly orchestrator: AgentOrchestrator;
  private readonly blueprintLoader: BlueprintLoader;
  private readonly agents: Map<string, Agent> = new Map();
  private readonly _tools: Tool[] = [];

  constructor(config: AgentFactoryConfig) {
    // Create registries
    const reducerRegistry = createDefaultReducerRegistry();
    this._componentRegistry = new ComponentRegistry();

    // Register components from config
    if (config.components) {
      for (const constructor of config.components) {
        this._componentRegistry.register(constructor);
      }
    }

    // Register tools from config
    if (config.tools) {
      this._tools.push(...config.tools);
    }

    // Create orchestrator config
    const orchestratorConfig: AgentOrchestratorConfig = {
      llm: config.defaultLLMConfig,
      autoCompactEnabled: config.autoCompactEnabled ?? true,
      tokenThresholds: config.tokenThresholds,
      defaultExecutionMode: config.defaultExecutionMode ?? 'auto',
    };

    // Create orchestrator
    this.orchestrator = new AgentOrchestrator(
      config.storage,
      reducerRegistry,
      config.llmAdapter,
      orchestratorConfig,
    );

    // Create blueprint loader
    this.blueprintLoader = new BlueprintLoader(
      this.orchestrator,
      this._componentRegistry,
    );
  }

  // ============ Registration ============

  /**
   * Register a component constructor
   * @param constructor - The component constructor to register
   */
  registerComponent(constructor: ComponentConstructor): void {
    this._componentRegistry.register(constructor);
  }

  /**
   * Register a tool
   * @param tool - The tool to register
   */
  registerTool(tool: Tool): void {
    this._tools.push(tool);
  }

  // ============ Agent Lifecycle ============

  /**
   * Create a new agent from a blueprint
   * @param blueprint - The blueprint definition
   * @param options - Optional creation options
   * @returns The created agent
   */
  async createAgent(
    blueprint: Blueprint,
    options?: CreateAgentOptions,
  ): Promise<Agent> {
    // Create thread from blueprint
    const result = await this.blueprintLoader.createThreadFromBlueprint(
      blueprint,
      options
        ? {
            llmConfigOverride: options.llmConfigOverride,
          }
        : undefined,
    );

    // Initialize execution mode if specified
    if (options?.executionMode) {
      this.orchestrator.initializeExecutionMode(
        result.thread.id,
        options.executionMode,
      );
    }

    // Get component instances from the blueprint
    const componentInstances = this.getComponentInstances(blueprint);

    // Create agent wrapper
    const agent = new Agent(
      this.orchestrator,
      result.thread.id,
      blueprint.name,
      [...result.tools, ...this._tools],
      componentInstances,
    );

    // Cache agent
    this.agents.set(result.thread.id, agent);

    return agent;
  }

  /**
   * Restore an agent from persisted state
   * @param threadId - The thread ID to restore
   * @returns The restored agent
   * @throws Error if thread not found
   */
  async restoreAgent(threadId: string): Promise<Agent> {
    // Check cache first
    const cached = this.agents.get(threadId);
    if (cached) {
      return cached;
    }

    // Load thread from storage
    const thread = await this.orchestrator.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // Create agent wrapper (without component instances for restored agents)
    const agent = new Agent(
      this.orchestrator,
      threadId,
      thread.blueprintName,
      this._tools,
      [],
    );

    // Cache agent
    this.agents.set(threadId, agent);

    return agent;
  }

  /**
   * Get a cached agent by thread ID
   * @param threadId - The thread ID
   * @returns The agent or undefined if not cached
   */
  getAgent(threadId: string): Agent | undefined {
    return this.agents.get(threadId);
  }

  /**
   * Delete an agent and its persisted data
   * @param threadId - The thread ID to delete
   */
  async deleteAgent(threadId: string): Promise<void> {
    await this.orchestrator.deleteThread(threadId);
    this.agents.delete(threadId);
  }

  // ============ Internal Helpers ============

  /**
   * Get component instances from a blueprint
   * @internal
   */
  private getComponentInstances(
    blueprint: Blueprint,
  ): import('../components/component.interface.js').IComponent[] {
    if (!blueprint.components || blueprint.components.length === 0) {
      return [];
    }

    const instances: import('../components/component.interface.js').IComponent[] =
      [];
    for (const entry of blueprint.components) {
      const Constructor = this._componentRegistry.get(entry.componentKey);
      if (Constructor) {
        instances.push(new Constructor(entry.config));
      }
    }
    return instances;
  }
}
