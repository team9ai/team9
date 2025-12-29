import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { blueprints } from '../db/index.js';
import type { Blueprint } from '../types/index.js';

/**
 * Blueprint service for persistent storage
 * Supports both in-memory (for development) and PostgreSQL storage
 */
export class BlueprintService {
  private memoryStorage = new Map<string, Blueprint>();

  constructor(private db: PostgresJsDatabase<Record<string, never>> | null) {}

  /**
   * Save a blueprint
   */
  async save(blueprint: Blueprint): Promise<Blueprint> {
    const id = blueprint.id || `bp_${Date.now()}`;
    const now = new Date();
    const savedBlueprint: Blueprint = { ...blueprint, id };

    if (this.db) {
      // Check if exists
      const existing = await this.db
        .select()
        .from(blueprints)
        .where(eq(blueprints.id, id))
        .limit(1);

      if (existing.length > 0) {
        // Update
        await this.db
          .update(blueprints)
          .set({
            name: savedBlueprint.name,
            data: savedBlueprint,
            updatedAt: now,
          })
          .where(eq(blueprints.id, id));
      } else {
        // Insert
        await this.db.insert(blueprints).values({
          id,
          name: savedBlueprint.name,
          data: savedBlueprint,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      this.memoryStorage.set(id, savedBlueprint);
    }

    return savedBlueprint;
  }

  /**
   * Get a blueprint by ID
   */
  async get(id: string): Promise<Blueprint | null> {
    if (this.db) {
      const rows = await this.db
        .select()
        .from(blueprints)
        .where(eq(blueprints.id, id))
        .limit(1);

      if (rows.length === 0) {
        return null;
      }

      return rows[0].data as Blueprint;
    } else {
      return this.memoryStorage.get(id) || null;
    }
  }

  /**
   * List all blueprints
   */
  async list(): Promise<Blueprint[]> {
    if (this.db) {
      const rows = await this.db.select().from(blueprints);
      return rows.map((row) => row.data as Blueprint);
    } else {
      return Array.from(this.memoryStorage.values());
    }
  }

  /**
   * Update a blueprint
   */
  async update(
    id: string,
    updates: Partial<Blueprint>,
  ): Promise<Blueprint | null> {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const updated: Blueprint = { ...existing, ...updates, id };

    if (this.db) {
      await this.db
        .update(blueprints)
        .set({
          name: updated.name,
          data: updated,
          updatedAt: new Date(),
        })
        .where(eq(blueprints.id, id));
    } else {
      this.memoryStorage.set(id, updated);
    }

    return updated;
  }

  /**
   * Delete a blueprint
   */
  async delete(id: string): Promise<boolean> {
    if (this.db) {
      const result = await this.db
        .delete(blueprints)
        .where(eq(blueprints.id, id));
      return true;
    } else {
      return this.memoryStorage.delete(id);
    }
  }

  /**
   * Check if a blueprint exists
   */
  async exists(id: string): Promise<boolean> {
    if (this.db) {
      const rows = await this.db
        .select({ id: blueprints.id })
        .from(blueprints)
        .where(eq(blueprints.id, id))
        .limit(1);
      return rows.length > 0;
    } else {
      return this.memoryStorage.has(id);
    }
  }
}
