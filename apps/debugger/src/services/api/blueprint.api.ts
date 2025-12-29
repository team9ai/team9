import { api } from "./client";
import type { Blueprint } from "@/types";

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
}

export const blueprintApi = {
  /**
   * Create or update blueprint
   */
  async save(blueprint: Blueprint): Promise<Blueprint> {
    const response = await api.post<{ blueprint: Blueprint }>(
      "/blueprints",
      blueprint,
    );
    return response.blueprint;
  },

  /**
   * List all blueprints
   */
  async list(): Promise<Blueprint[]> {
    const response = await api.get<{ blueprints: Blueprint[] }>("/blueprints");
    return response.blueprints;
  },

  /**
   * Get blueprint by ID
   */
  async get(id: string): Promise<Blueprint> {
    const response = await api.get<{ blueprint: Blueprint }>(
      `/blueprints/${id}`,
    );
    return response.blueprint;
  },

  /**
   * Update blueprint
   */
  async update(id: string, updates: Partial<Blueprint>): Promise<Blueprint> {
    const response = await api.put<{ blueprint: Blueprint }>(
      `/blueprints/${id}`,
      updates,
    );
    return response.blueprint;
  },

  /**
   * Delete blueprint
   */
  async delete(id: string): Promise<void> {
    await api.delete(`/blueprints/${id}`);
  },

  /**
   * Validate blueprint
   */
  async validate(blueprint: Blueprint): Promise<BlueprintValidationResult> {
    return api.post<BlueprintValidationResult>(
      "/blueprints/validate",
      blueprint,
    );
  },
};
