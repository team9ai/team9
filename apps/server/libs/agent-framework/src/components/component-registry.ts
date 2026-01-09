/**
 * ComponentRegistry - Global component registration and dependency management
 *
 * Stores component constructors (not instances) so components can be
 * instantiated with different configs per thread/blueprint.
 *
 * Component key is automatically extracted from the constructor by
 * instantiating with no config and reading the `id` property.
 */

import type { ComponentConstructor } from './component.interface.js';

/**
 * Interface for component registry
 * Used by BlueprintLoader and other services that need to look up components
 */
export interface IComponentRegistry {
  /**
   * Register a component constructor
   * Key is automatically extracted from component.id
   */
  register(constructor: ComponentConstructor): void;

  /**
   * Get component constructor by key
   */
  get(key: string): ComponentConstructor | undefined;

  /**
   * Check if a component is registered
   */
  has(key: string): boolean;
}

/**
 * ComponentRegistry manages global component registration
 * Stores constructors so components can be instantiated with config
 */
export class ComponentRegistry implements IComponentRegistry {
  /** Registered component constructors (global) */
  private constructors: Map<string, ComponentConstructor> = new Map();

  /** Base component keys (always enabled in threads) */
  private baseComponentKeys: Set<string> = new Set();

  /**
   * Extract component key by instantiating with no config
   * Component must have a default config or handle undefined config
   */
  private extractKey(constructor: ComponentConstructor): string {
    const instance = new constructor();
    return instance.id;
  }

  /**
   * Register a component constructor
   * Key is automatically extracted from component.id
   * @param constructor - Component constructor class
   * @throws Error if key already registered
   */
  register(constructor: ComponentConstructor): void {
    const key = this.extractKey(constructor);
    if (this.constructors.has(key)) {
      throw new Error(`Component already registered: ${key}`);
    }
    this.constructors.set(key, constructor);
  }

  /**
   * Register a base component (always enabled in threads)
   * @param constructor - Component constructor class
   */
  registerBase(constructor: ComponentConstructor): void {
    const key = this.extractKey(constructor);
    this.register(constructor);
    this.baseComponentKeys.add(key);
  }

  /**
   * Unregister a component
   * @throws Error if component is a base component
   */
  unregister(key: string): void {
    if (this.baseComponentKeys.has(key)) {
      throw new Error(`Cannot unregister base component: ${key}`);
    }
    this.constructors.delete(key);
  }

  /**
   * Get a registered component constructor by key
   */
  get(key: string): ComponentConstructor | undefined {
    return this.constructors.get(key);
  }

  /**
   * Check if a component is registered
   */
  has(key: string): boolean {
    return this.constructors.has(key);
  }

  /**
   * Get all registered component keys
   */
  getAllKeys(): string[] {
    return Array.from(this.constructors.keys());
  }

  /**
   * Get base component keys
   */
  getBaseComponentKeys(): string[] {
    return Array.from(this.baseComponentKeys);
  }

  /**
   * Check if a component is a base component
   */
  isBase(key: string): boolean {
    return this.baseComponentKeys.has(key);
  }
}
