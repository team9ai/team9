import { describe, expect, it } from "vitest";
import { getLabel, operationLabels, toolNameLabels } from "../toolLabels";

describe("toolLabels", () => {
  describe("operationLabels", () => {
    it("should contain all required operation types", () => {
      expect(operationLabels).toHaveProperty("load_tools");
      expect(operationLabels).toHaveProperty("search_tools");
      expect(operationLabels).toHaveProperty("invoke_tool");
    });

    it("should have non-empty labels for each operation type", () => {
      expect(operationLabels.load_tools).toBeTruthy();
      expect(operationLabels.search_tools).toBeTruthy();
      expect(operationLabels.invoke_tool).toBeTruthy();
    });

    it("should have descriptive Chinese labels", () => {
      expect(typeof operationLabels.load_tools).toBe("string");
      expect(operationLabels.load_tools).toMatch(/[\u4e00-\u9fff]/); // Contains Chinese characters
      expect(operationLabels.search_tools).toMatch(/[\u4e00-\u9fff]/);
      expect(operationLabels.invoke_tool).toMatch(/[\u4e00-\u9fff]/);
    });
  });

  describe("toolNameLabels", () => {
    it("should contain common tool names", () => {
      expect(toolNameLabels).toHaveProperty("search_docs");
      expect(toolNameLabels).toHaveProperty("send_message");
      expect(toolNameLabels).toHaveProperty("generate_reply");
    });

    it("should have non-empty labels for each tool name", () => {
      expect(toolNameLabels.search_docs).toBeTruthy();
      expect(toolNameLabels.send_message).toBeTruthy();
      expect(toolNameLabels.generate_reply).toBeTruthy();
    });

    it("should have descriptive Chinese labels", () => {
      expect(typeof toolNameLabels.search_docs).toBe("string");
      expect(toolNameLabels.search_docs).toMatch(/[\u4e00-\u9fff]/);
      expect(toolNameLabels.send_message).toMatch(/[\u4e00-\u9fff]/);
      expect(toolNameLabels.generate_reply).toMatch(/[\u4e00-\u9fff]/);
    });
  });

  describe("getLabel function", () => {
    describe("priority 1: toolName", () => {
      it("should return tool-specific label when toolName exists in toolNameLabels", () => {
        const label = getLabel("load_tools", "search_docs");
        expect(label).toBe(toolNameLabels.search_docs);
      });

      it("should return tool-specific label even if operation type is unknown", () => {
        const label = getLabel("unknown_operation" as any, "send_message");
        expect(label).toBe(toolNameLabels.send_message);
      });

      it("should return tool-specific label for all known tools", () => {
        Object.entries(toolNameLabels).forEach(([toolName, expectedLabel]) => {
          const label = getLabel("invoke_tool", toolName as any);
          expect(label).toBe(expectedLabel);
        });
      });
    });

    describe("priority 2: operationType", () => {
      it("should return operation label when toolName is not in toolNameLabels", () => {
        const label = getLabel("load_tools", "unknown_tool");
        expect(label).toBe(operationLabels.load_tools);
      });

      it("should return operation label when toolName is undefined", () => {
        const label = getLabel("search_tools", undefined);
        expect(label).toBe(operationLabels.search_tools);
      });

      it("should return operation label when toolName is empty string", () => {
        const label = getLabel("invoke_tool", "");
        expect(label).toBe(operationLabels.invoke_tool);
      });

      it("should return operation label for all operation types with unknown tool", () => {
        Object.entries(operationLabels).forEach(([opType, expectedLabel]) => {
          const label = getLabel(opType as any, "unknown_tool");
          expect(label).toBe(expectedLabel);
        });
      });
    });

    describe("priority 3: fallback format", () => {
      it("should return formatted fallback when operation type is unknown and tool name is not in toolNameLabels", () => {
        const label = getLabel("unknown_operation" as any, "unknown_tool");
        expect(label).toBe("正在unknown_operation");
      });

      it("should return formatted fallback with undefined operation", () => {
        const label = getLabel(undefined as any, "unknown_tool");
        expect(typeof label).toBe("string");
      });

      it("should return formatted fallback with empty operation", () => {
        const label = getLabel("" as any, "unknown_tool");
        expect(typeof label).toBe("string");
      });

      it("should handle edge case with both operation and tool unknown", () => {
        const label = getLabel("custom_op" as any, "custom_tool");
        expect(label).toContain("custom_op");
      });
    });

    describe("mixed scenarios", () => {
      it("should prioritize toolName over operationType when both exist", () => {
        const label = getLabel("load_tools", "search_docs");
        expect(label).toBe(toolNameLabels.search_docs);
        expect(label).not.toBe(operationLabels.load_tools);
      });

      it("should fall back to operationType when toolName is not available but operation is", () => {
        const label = getLabel("search_tools", "nonexistent_tool");
        expect(label).toBe(operationLabels.search_tools);
      });

      it("should handle status parameter gracefully (if provided)", () => {
        // The function should work with status even if not used
        const label1 = getLabel("invoke_tool", "send_message");
        const label2 = getLabel("invoke_tool", "send_message", "pending");
        expect(typeof label1).toBe("string");
        expect(typeof label2).toBe("string");
      });

      it("should be case-sensitive for toolName matching", () => {
        const label1 = getLabel("invoke_tool", "search_docs");
        const label2 = getLabel("invoke_tool", "Search_Docs");
        const label3 = getLabel("invoke_tool", "SEARCH_DOCS");

        // Only exact match should use toolNameLabel
        expect(label1).toBe(toolNameLabels.search_docs);
        expect(label2).not.toBe(toolNameLabels.search_docs);
        expect(label3).not.toBe(toolNameLabels.search_docs);
      });

      it("should handle all combinations of operation types and known tools", () => {
        const operations = Object.keys(operationLabels) as any[];
        const tools = Object.keys(toolNameLabels) as any[];

        operations.forEach((op) => {
          tools.forEach((tool) => {
            const label = getLabel(op, tool);
            // Should always return tool-specific label
            expect(label).toBe(toolNameLabels[tool]);
          });
        });
      });
    });

    describe("null and undefined handling", () => {
      it("should handle null operationType", () => {
        const label = getLabel(null as any, "send_message");
        expect(typeof label).toBe("string");
      });

      it("should handle null toolName", () => {
        const label = getLabel("load_tools", null as any);
        expect(label).toBe(operationLabels.load_tools);
      });

      it("should handle both null", () => {
        const label = getLabel(null as any, null as any);
        expect(typeof label).toBe("string");
      });

      it("should handle whitespace-only toolName as invalid", () => {
        const label = getLabel("invoke_tool", "   ");
        // Whitespace-only should not match toolNameLabels
        expect(label).toBe(operationLabels.invoke_tool);
      });
    });
  });
});
