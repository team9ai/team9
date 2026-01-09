/**
 * ComponentManager - Global component registry
 *
 * This is a stateless utility class for component registration.
 * Thread/Agent-specific component state should be managed by the Thread/Agent itself.
 */

import type { ComponentConstructor } from './component.interface.js';
import { ComponentRegistry, IComponentRegistry } from './component-registry.js';

/**
 * Configuration for ComponentManager
 */
export interface ComponentManagerConfig {
  /** Base component constructors that are always enabled */
  baseComponents?: ComponentConstructor[];
}

/**
 * ComponentManager manages global component registration
 *
 * Note: This is a stateless registry. Thread-specific component state
 * should be managed by the Thread/Agent, not here.
 */
export class ComponentManager {
  /** Global component registry */
  private readonly registry: ComponentRegistry;

  constructor(config?: ComponentManagerConfig) {
    this.registry = new ComponentRegistry();

    // Register base components
    if (config?.baseComponents) {
      for (const constructor of config.baseComponents) {
        this.registry.registerBase(constructor);
      }
    }
  }

  // ============ Registry Access ============

  /**
   * Get the component registry for use with BlueprintLoader
   * Composition over inheritance - expose registry instead of implementing interface
   */
  getRegistry(): IComponentRegistry {
    return this.registry;
  }

  // ============ Component Registration ============

  /**
   * Register a component constructor
   * Key is automatically extracted from component.id
   * @throws Error if component with same ID already registered
   */
  register(constructor: ComponentConstructor): void {
    this.registry.register(constructor);
  }

  /**
   * Unregister a component
   * @throws Error if component is a base component
   */
  unregister(key: string): void {
    this.registry.unregister(key);
  }

  /**
   * Get a registered component constructor by key
   */
  get(key: string): ComponentConstructor | undefined {
    return this.registry.get(key);
  }

  /**
   * Check if a component is registered
   */
  has(key: string): boolean {
    return this.registry.has(key);
  }

  /**
   * Get all registered component keys
   */
  getAllKeys(): string[] {
    return this.registry.getAllKeys();
  }

  /**
   * Get base component keys (always enabled)
   */
  getBaseComponentKeys(): string[] {
    return this.registry.getBaseComponentKeys();
  }

  /**
   * Check if a component is a base component
   */
  isBaseComponent(key: string): boolean {
    return this.registry.isBase(key);
  }
}

/**
 * Create a new ComponentManager
 */
export function createComponentManager(
  config?: ComponentManagerConfig,
): ComponentManager {
  return new ComponentManager(config);
}
