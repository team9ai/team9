import { describe, expect, it } from "vitest";
import {
  getLabel,
  operationLabels,
  toolNameLabels,
  StatusType,
} from "../toolLabels";

describe("toolLabels", () => {
  describe("operationLabels", () => {
    it("should contain all required operation types", () => {
      expect(operationLabels).toHaveProperty("load_tools");
      expect(operationLabels).toHaveProperty("search_tools");
      expect(operationLabels).toHaveProperty("invoke_tool");
    });

    it("should have nested structure with all status types", () => {
      expect(operationLabels.load_tools).toHaveProperty("loading");
      expect(operationLabels.load_tools).toHaveProperty("success");
      expect(operationLabels.load_tools).toHaveProperty("error");
      expect(operationLabels.search_tools).toHaveProperty("loading");
      expect(operationLabels.search_tools).toHaveProperty("success");
      expect(operationLabels.search_tools).toHaveProperty("error");
      expect(operationLabels.invoke_tool).toHaveProperty("loading");
      expect(operationLabels.invoke_tool).toHaveProperty("success");
      expect(operationLabels.invoke_tool).toHaveProperty("error");
    });

    it("should have non-empty labels for each status", () => {
      const statuses: StatusType[] = ["loading", "success", "error"];
      Object.values(operationLabels).forEach((labels) => {
        statuses.forEach((status) => {
          expect(labels[status]).toBeTruthy();
          expect(typeof labels[status]).toBe("string");
        });
      });
    });

    it("should have descriptive Chinese labels", () => {
      const statuses: StatusType[] = ["loading", "success", "error"];
      Object.values(operationLabels).forEach((labels) => {
        statuses.forEach((status) => {
          expect(labels[status]).toMatch(/[\u4e00-\u9fff]/); // Contains Chinese characters
        });
      });
    });
  });

  describe("toolNameLabels", () => {
    it("should contain common tool names", () => {
      expect(toolNameLabels).toHaveProperty("search_docs");
      expect(toolNameLabels).toHaveProperty("send_message");
      expect(toolNameLabels).toHaveProperty("generate_reply");
    });

    it("should have nested structure with all status types", () => {
      expect(toolNameLabels.search_docs).toHaveProperty("loading");
      expect(toolNameLabels.search_docs).toHaveProperty("success");
      expect(toolNameLabels.search_docs).toHaveProperty("error");
      expect(toolNameLabels.send_message).toHaveProperty("loading");
      expect(toolNameLabels.send_message).toHaveProperty("success");
      expect(toolNameLabels.send_message).toHaveProperty("error");
      expect(toolNameLabels.generate_reply).toHaveProperty("loading");
      expect(toolNameLabels.generate_reply).toHaveProperty("success");
      expect(toolNameLabels.generate_reply).toHaveProperty("error");
    });

    it("should have non-empty labels for each status", () => {
      const statuses: StatusType[] = ["loading", "success", "error"];
      Object.values(toolNameLabels).forEach((labels) => {
        statuses.forEach((status) => {
          expect(labels[status]).toBeTruthy();
          expect(typeof labels[status]).toBe("string");
        });
      });
    });

    it("should have descriptive Chinese labels", () => {
      const statuses: StatusType[] = ["loading", "success", "error"];
      Object.values(toolNameLabels).forEach((labels) => {
        statuses.forEach((status) => {
          expect(labels[status]).toMatch(/[\u4e00-\u9fff]/);
        });
      });
    });
  });

  describe("getLabel function", () => {
    describe("priority 1: toolName", () => {
      it("should return tool-specific label when toolName exists in toolNameLabels", () => {
        const label = getLabel("load_tools", "search_docs", "loading");
        expect(label).toBe(toolNameLabels.search_docs.loading);
      });

      it("should return tool-specific label with different statuses", () => {
        const statuses: StatusType[] = ["loading", "success", "error"];
        statuses.forEach((status) => {
          const label = getLabel("load_tools", "search_docs", status);
          expect(label).toBe(toolNameLabels.search_docs[status]);
        });
      });

      it("should return tool-specific label even if operation type is unknown", () => {
        const label = getLabel(
          "unknown_operation" as any,
          "send_message",
          "success",
        );
        expect(label).toBe(toolNameLabels.send_message.success);
      });

      it("should return tool-specific label for all known tools with all statuses", () => {
        const statuses: StatusType[] = ["loading", "success", "error"];
        Object.entries(toolNameLabels).forEach(([toolName, expectedLabels]) => {
          statuses.forEach((status) => {
            const label = getLabel("invoke_tool", toolName as any, status);
            expect(label).toBe(expectedLabels[status]);
          });
        });
      });
    });

    describe("priority 2: operationType", () => {
      it("should return operation label when toolName is not in toolNameLabels", () => {
        const label = getLabel("load_tools", "unknown_tool", "loading");
        expect(label).toBe(operationLabels.load_tools.loading);
      });

      it("should return operation label with different statuses when toolName is not in toolNameLabels", () => {
        const statuses: StatusType[] = ["loading", "success", "error"];
        statuses.forEach((status) => {
          const label = getLabel("load_tools", "unknown_tool", status);
          expect(label).toBe(operationLabels.load_tools[status]);
        });
      });

      it("should return operation label when toolName is undefined", () => {
        const label = getLabel("search_tools", undefined, "success");
        expect(label).toBe(operationLabels.search_tools.success);
      });

      it("should return operation label when toolName is empty string", () => {
        const label = getLabel("invoke_tool", "", "error");
        expect(label).toBe(operationLabels.invoke_tool.error);
      });

      it("should return operation label for all operation types and statuses with unknown tool", () => {
        const statuses: StatusType[] = ["loading", "success", "error"];
        Object.entries(operationLabels).forEach(([opType, expectedLabels]) => {
          statuses.forEach((status) => {
            const label = getLabel(opType as any, "unknown_tool", status);
            expect(label).toBe(expectedLabels[status]);
          });
        });
      });
    });

    describe("priority 3: fallback format", () => {
      it("should return formatted fallback when operation type is unknown and tool name is not in toolNameLabels", () => {
        const label = getLabel(
          "unknown_operation" as any,
          "unknown_tool",
          "loading",
        );
        expect(label).toContain("unknown_operation");
        expect(label).toContain("unknown_tool");
      });

      it("should return formatted fallback with different statuses", () => {
        const statuses: StatusType[] = ["loading", "success", "error"];
        statuses.forEach((status) => {
          const label = getLabel("custom_op" as any, "custom_tool", status);
          expect(typeof label).toBe("string");
          expect(label).toContain("custom_op");
        });
      });

      it("should return formatted fallback with undefined operation", () => {
        const label = getLabel(undefined as any, "unknown_tool", "loading");
        expect(typeof label).toBe("string");
        expect(label).toContain("unknown");
      });

      it("should return formatted fallback with empty operation", () => {
        const label = getLabel("" as any, "unknown_tool", "success");
        expect(typeof label).toBe("string");
      });

      it("should handle edge case with both operation and tool unknown and different statuses", () => {
        const label1 = getLabel("custom_op" as any, "custom_tool", "loading");
        const label2 = getLabel("custom_op" as any, "custom_tool", "error");
        expect(label1).toContain("custom_op");
        expect(label2).toContain("custom_op");
        expect(label1).not.toBe(label2); // Different status should produce different fallback
      });
    });

    describe("mixed scenarios", () => {
      it("should prioritize toolName over operationType when both exist", () => {
        const label = getLabel("load_tools", "search_docs", "loading");
        expect(label).toBe(toolNameLabels.search_docs.loading);
        expect(label).not.toBe(operationLabels.load_tools.loading);
      });

      it("should fall back to operationType when toolName is not available but operation is", () => {
        const label = getLabel("search_tools", "nonexistent_tool", "success");
        expect(label).toBe(operationLabels.search_tools.success);
      });

      it("should use default status (loading) when status is not provided", () => {
        const label1 = getLabel("invoke_tool", "send_message");
        const label2 = getLabel("invoke_tool", "send_message", "loading");
        expect(label1).toBe(label2);
        expect(label1).toBe(toolNameLabels.send_message.loading);
      });

      it("should handle status parameter with all valid values", () => {
        const statuses: StatusType[] = ["loading", "success", "error"];
        statuses.forEach((status) => {
          const label = getLabel("invoke_tool", "send_message", status);
          expect(label).toBe(toolNameLabels.send_message[status]);
        });
      });

      it("should be case-sensitive for toolName matching", () => {
        const label1 = getLabel("invoke_tool", "search_docs", "loading");
        const label2 = getLabel("invoke_tool", "Search_Docs", "loading");
        const label3 = getLabel("invoke_tool", "SEARCH_DOCS", "loading");

        // Only exact match should use toolNameLabel
        expect(label1).toBe(toolNameLabels.search_docs.loading);
        expect(label2).not.toBe(toolNameLabels.search_docs.loading);
        expect(label3).not.toBe(toolNameLabels.search_docs.loading);
      });

      it("should handle all combinations of operation types, tools, and statuses", () => {
        const operations = Object.keys(operationLabels) as any[];
        const tools = Object.keys(toolNameLabels) as any[];
        const statuses: StatusType[] = ["loading", "success", "error"];

        operations.forEach((op) => {
          tools.forEach((tool) => {
            statuses.forEach((status) => {
              const label = getLabel(op, tool, status);
              // Should always return tool-specific label
              expect(label).toBe(toolNameLabels[tool][status]);
            });
          });
        });
      });
    });

    describe("null and undefined handling", () => {
      it("should handle null operationType with valid toolName", () => {
        const label = getLabel(null as any, "send_message", "loading");
        expect(label).toBe(toolNameLabels.send_message.loading);
      });

      it("should handle null operationType with invalid toolName", () => {
        const label = getLabel(null as any, "invalid_tool", "error");
        expect(typeof label).toBe("string");
      });

      it("should handle null toolName with valid operationType", () => {
        const label = getLabel("load_tools", null as any, "success");
        expect(label).toBe(operationLabels.load_tools.success);
      });

      it("should handle both null", () => {
        const label = getLabel(null as any, null as any, "loading");
        expect(typeof label).toBe("string");
      });

      it("should handle undefined operationType", () => {
        const label = getLabel(undefined as any, "send_message", "success");
        expect(label).toBe(toolNameLabels.send_message.success);
      });

      it("should handle undefined toolName", () => {
        const label = getLabel("load_tools", undefined, "error");
        expect(label).toBe(operationLabels.load_tools.error);
      });

      it("should handle whitespace-only toolName as invalid", () => {
        const label = getLabel("invoke_tool", "   ", "loading");
        // Whitespace-only should not match toolNameLabels
        expect(label).toBe(operationLabels.invoke_tool.loading);
      });

      it("should not crash with null status and default to loading", () => {
        const label = getLabel("load_tools", "search_docs", null as any);
        const expectedLabel = getLabel("load_tools", "search_docs", "loading");
        expect(label).toBe(expectedLabel);
        expect(label).toBe(toolNameLabels.search_docs.loading);
      });

      it("should handle invalid status values by defaulting to loading", () => {
        const invalidStatuses = [
          "invalid",
          "pending",
          "failed",
          123,
          {},
          [],
        ] as any[];
        invalidStatuses.forEach((invalidStatus) => {
          const label = getLabel("load_tools", "search_docs", invalidStatus);
          const expectedLabel = getLabel(
            "load_tools",
            "search_docs",
            "loading",
          );
          expect(label).toBe(expectedLabel);
        });
      });
    });
  });
});
