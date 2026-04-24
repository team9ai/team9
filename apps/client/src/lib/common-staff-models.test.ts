import { describe, it, expect } from "vitest";
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
  type StaffModelFamily,
} from "./common-staff-models";
import { BASE_MODEL_PRODUCT_FAMILY } from "./base-model-agent";

describe("COMMON_STAFF_MODELS", () => {
  it("labels every model with a family so picker filters can't silently miss any", () => {
    for (const model of COMMON_STAFF_MODELS) {
      expect(model.family).toBeDefined();
      expect(["anthropic", "openai", "google", "other"]).toContain(
        model.family,
      );
    }
  });

  it("keeps the anthropic/openai/google prefix consistent with the declared family", () => {
    for (const model of COMMON_STAFF_MODELS) {
      const [prefix] = model.id.split("/");
      const expected =
        prefix === "anthropic" || prefix === "openai" || prefix === "google"
          ? (prefix as StaffModelFamily)
          : "other";
      expect({ id: model.id, family: model.family }).toEqual({
        id: model.id,
        family: expected,
      });
    }
  });

  it("default model is resolvable and carries a family", () => {
    expect(DEFAULT_STAFF_MODEL).toBeDefined();
    expect(DEFAULT_STAFF_MODEL.family).toBe("anthropic");
  });

  it("filtering by agentModelFamily keeps only matching models (strict filter)", () => {
    const family = BASE_MODEL_PRODUCT_FAMILY.claude;
    const filtered = COMMON_STAFF_MODELS.filter((m) => m.family === family);
    expect(filtered.length).toBeGreaterThan(0);
    for (const model of filtered) {
      expect(model.family).toBe("anthropic");
      expect(model.id.startsWith("anthropic/")).toBe(true);
    }
  });

  it("maps each base-model preset to the expected family", () => {
    expect(BASE_MODEL_PRODUCT_FAMILY.claude).toBe("anthropic");
    expect(BASE_MODEL_PRODUCT_FAMILY.chatgpt).toBe("openai");
    expect(BASE_MODEL_PRODUCT_FAMILY.gemini).toBe("google");
  });

  it("every base-model preset family has at least one matching model (so the dropdown is never empty)", () => {
    for (const family of Object.values(BASE_MODEL_PRODUCT_FAMILY)) {
      const count = COMMON_STAFF_MODELS.filter(
        (m) => m.family === family,
      ).length;
      expect(count).toBeGreaterThan(0);
    }
  });
});
