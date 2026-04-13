import { describe, expect, it } from "vitest";
import {
  FALLBACK_KEY_BASE,
  getLabelKey,
  operationLabelKeys,
  toolNameLabelKeys,
  type StatusType,
} from "../toolLabels";

const STATUSES: StatusType[] = ["loading", "success", "error"];

describe("toolLabels", () => {
  describe("operationLabelKeys", () => {
    it("should contain all required operation types", () => {
      expect(operationLabelKeys).toHaveProperty("load_tools");
      expect(operationLabelKeys).toHaveProperty("search_tools");
      expect(operationLabelKeys).toHaveProperty("invoke_tool");
    });

    it("should map each operation to a namespaced i18n key", () => {
      expect(operationLabelKeys.load_tools).toBe("tracking.ops.loadTools");
      expect(operationLabelKeys.search_tools).toBe("tracking.ops.searchTools");
      expect(operationLabelKeys.invoke_tool).toBe("tracking.ops.invokeTool");
    });

    it("should expose only string values", () => {
      Object.values(operationLabelKeys).forEach((key) => {
        expect(typeof key).toBe("string");
        expect(key.length).toBeGreaterThan(0);
      });
    });
  });

  describe("toolNameLabelKeys", () => {
    it("should contain common tool names", () => {
      expect(toolNameLabelKeys).toHaveProperty("search_docs");
      expect(toolNameLabelKeys).toHaveProperty("send_message");
      expect(toolNameLabelKeys).toHaveProperty("generate_reply");
    });

    it("should map each tool to a namespaced i18n key", () => {
      expect(toolNameLabelKeys.search_docs).toBe("tracking.tools.searchDocs");
      expect(toolNameLabelKeys.send_message).toBe("tracking.tools.sendMessage");
      expect(toolNameLabelKeys.generate_reply).toBe(
        "tracking.tools.generateReply",
      );
    });

    it("should expose only string values", () => {
      Object.values(toolNameLabelKeys).forEach((key) => {
        expect(typeof key).toBe("string");
        expect(key.length).toBeGreaterThan(0);
      });
    });
  });

  describe("getLabelKey function", () => {
    describe("priority 1: toolName", () => {
      it("should return tool-specific key when toolName exists in toolNameLabelKeys", () => {
        const descriptor = getLabelKey("load_tools", "search_docs", "loading");
        expect(descriptor.key).toBe("tracking.tools.searchDocs.loading");
        expect(descriptor.values).toBeUndefined();
      });

      it("should return tool-specific key with different statuses", () => {
        STATUSES.forEach((status) => {
          const descriptor = getLabelKey("load_tools", "search_docs", status);
          expect(descriptor.key).toBe(`tracking.tools.searchDocs.${status}`);
        });
      });

      it("should return tool-specific key even if operation type is unknown", () => {
        const descriptor = getLabelKey(
          "unknown_operation",
          "send_message",
          "success",
        );
        expect(descriptor.key).toBe("tracking.tools.sendMessage.success");
      });

      it("should return tool-specific key for all known tools with all statuses", () => {
        Object.entries(toolNameLabelKeys).forEach(
          ([toolName, expectedBase]) => {
            STATUSES.forEach((status) => {
              const descriptor = getLabelKey("invoke_tool", toolName, status);
              expect(descriptor.key).toBe(`${expectedBase}.${status}`);
            });
          },
        );
      });
    });

    describe("priority 2: operationType", () => {
      it("should return operation key when toolName is not in toolNameLabelKeys", () => {
        const descriptor = getLabelKey("load_tools", "unknown_tool", "loading");
        expect(descriptor.key).toBe("tracking.ops.loadTools.loading");
        expect(descriptor.values).toBeUndefined();
      });

      it("should return operation key with different statuses when toolName is not in toolNameLabelKeys", () => {
        STATUSES.forEach((status) => {
          const descriptor = getLabelKey("load_tools", "unknown_tool", status);
          expect(descriptor.key).toBe(`tracking.ops.loadTools.${status}`);
        });
      });

      it("should return operation key when toolName is undefined", () => {
        const descriptor = getLabelKey("search_tools", undefined, "success");
        expect(descriptor.key).toBe("tracking.ops.searchTools.success");
      });

      it("should return operation key when toolName is empty string", () => {
        const descriptor = getLabelKey("invoke_tool", "", "error");
        expect(descriptor.key).toBe("tracking.ops.invokeTool.error");
      });

      it("should return operation key for all operation types and statuses with unknown tool", () => {
        Object.entries(operationLabelKeys).forEach(([opType, expectedBase]) => {
          STATUSES.forEach((status) => {
            const descriptor = getLabelKey(opType, "unknown_tool", status);
            expect(descriptor.key).toBe(`${expectedBase}.${status}`);
          });
        });
      });
    });

    describe("priority 3: fallback key", () => {
      it("should return fallback key when operation type is unknown and tool name is not registered", () => {
        const descriptor = getLabelKey(
          "unknown_operation",
          "unknown_tool",
          "loading",
        );
        expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.loading`);
        expect(descriptor.values).toEqual({ name: "unknown_tool" });
      });

      it("should return fallback key with different statuses", () => {
        STATUSES.forEach((status) => {
          const descriptor = getLabelKey("custom_op", "custom_tool", status);
          expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.${status}`);
          expect(descriptor.values).toEqual({ name: "custom_tool" });
        });
      });

      it("should use 'unknown' as op name when operationType is undefined and no tool provided", () => {
        const descriptor = getLabelKey(undefined, undefined, "loading");
        expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.loading`);
        expect(descriptor.values).toEqual({ name: "unknown" });
      });

      it("should fall back to operation name when tool name is not provided", () => {
        const descriptor = getLabelKey("custom_op", undefined, "success");
        expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.success`);
        expect(descriptor.values).toEqual({ name: "custom_op" });
      });

      it("should interpolate the tool name when both tool and op are unknown", () => {
        const descriptor = getLabelKey("custom_op", "custom_tool", "error");
        expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.error`);
        expect(descriptor.values).toEqual({ name: "custom_tool" });
      });

      it("should produce different keys for different statuses", () => {
        const loading = getLabelKey("custom_op", "custom_tool", "loading");
        const error = getLabelKey("custom_op", "custom_tool", "error");
        expect(loading.key).not.toBe(error.key);
      });
    });

    describe("mixed scenarios", () => {
      it("should prioritize toolName over operationType when both exist", () => {
        const descriptor = getLabelKey("load_tools", "search_docs", "loading");
        expect(descriptor.key).toBe("tracking.tools.searchDocs.loading");
        expect(descriptor.key).not.toBe("tracking.ops.loadTools.loading");
      });

      it("should fall back to operationType when toolName is not registered but operation is", () => {
        const descriptor = getLabelKey(
          "search_tools",
          "nonexistent_tool",
          "success",
        );
        expect(descriptor.key).toBe("tracking.ops.searchTools.success");
      });

      it("should use default status (loading) when status is not provided", () => {
        const descriptor1 = getLabelKey("invoke_tool", "send_message");
        const descriptor2 = getLabelKey(
          "invoke_tool",
          "send_message",
          "loading",
        );
        expect(descriptor1.key).toBe(descriptor2.key);
        expect(descriptor1.key).toBe("tracking.tools.sendMessage.loading");
      });

      it("should handle status parameter with all valid values", () => {
        STATUSES.forEach((status) => {
          const descriptor = getLabelKey("invoke_tool", "send_message", status);
          expect(descriptor.key).toBe(`tracking.tools.sendMessage.${status}`);
        });
      });

      it("should be case-sensitive for toolName matching", () => {
        const descriptor1 = getLabelKey(
          "invoke_tool",
          "search_docs",
          "loading",
        );
        const descriptor2 = getLabelKey(
          "invoke_tool",
          "Search_Docs",
          "loading",
        );
        const descriptor3 = getLabelKey(
          "invoke_tool",
          "SEARCH_DOCS",
          "loading",
        );

        // Only exact match should use the tool-specific key
        expect(descriptor1.key).toBe("tracking.tools.searchDocs.loading");
        expect(descriptor2.key).toBe("tracking.ops.invokeTool.loading");
        expect(descriptor3.key).toBe("tracking.ops.invokeTool.loading");
      });

      it("should handle all combinations of operation types, tools, and statuses", () => {
        const operations = Object.keys(operationLabelKeys);
        const tools = Object.keys(toolNameLabelKeys);

        operations.forEach((op) => {
          tools.forEach((tool) => {
            STATUSES.forEach((status) => {
              const descriptor = getLabelKey(op, tool, status);
              // Tool-specific always wins when tool is registered
              expect(descriptor.key).toBe(
                `${toolNameLabelKeys[tool]}.${status}`,
              );
            });
          });
        });
      });
    });

    describe("null and undefined handling", () => {
      it("should handle null operationType with valid toolName", () => {
        const descriptor = getLabelKey(
          null as unknown as string,
          "send_message",
          "loading",
        );
        expect(descriptor.key).toBe("tracking.tools.sendMessage.loading");
      });

      it("should handle null operationType with invalid toolName", () => {
        const descriptor = getLabelKey(
          null as unknown as string,
          "invalid_tool",
          "error",
        );
        expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.error`);
        expect(descriptor.values).toEqual({ name: "invalid_tool" });
      });

      it("should handle null toolName with valid operationType", () => {
        const descriptor = getLabelKey(
          "load_tools",
          null as unknown as string,
          "success",
        );
        expect(descriptor.key).toBe("tracking.ops.loadTools.success");
      });

      it("should handle both null", () => {
        const descriptor = getLabelKey(
          null as unknown as string,
          null as unknown as string,
          "loading",
        );
        expect(descriptor.key).toBe(`${FALLBACK_KEY_BASE}.loading`);
      });

      it("should handle undefined operationType", () => {
        const descriptor = getLabelKey(undefined, "send_message", "success");
        expect(descriptor.key).toBe("tracking.tools.sendMessage.success");
      });

      it("should handle undefined toolName", () => {
        const descriptor = getLabelKey("load_tools", undefined, "error");
        expect(descriptor.key).toBe("tracking.ops.loadTools.error");
      });

      it("should handle whitespace-only toolName as invalid", () => {
        const descriptor = getLabelKey("invoke_tool", "   ", "loading");
        // Whitespace-only should not match the tool-specific registry
        expect(descriptor.key).toBe("tracking.ops.invokeTool.loading");
      });

      it("should not crash with null status and default to loading", () => {
        const descriptor = getLabelKey(
          "load_tools",
          "search_docs",
          null as unknown as StatusType,
        );
        const expected = getLabelKey("load_tools", "search_docs", "loading");
        expect(descriptor.key).toBe(expected.key);
        expect(descriptor.key).toBe("tracking.tools.searchDocs.loading");
      });

      it("should handle invalid status values by defaulting to loading", () => {
        const invalidStatuses = [
          "invalid",
          "pending",
          "failed",
          123,
          {},
          [],
        ] as unknown[];
        invalidStatuses.forEach((invalidStatus) => {
          const descriptor = getLabelKey(
            "load_tools",
            "search_docs",
            invalidStatus as StatusType,
          );
          const expected = getLabelKey("load_tools", "search_docs", "loading");
          expect(descriptor.key).toBe(expected.key);
        });
      });
    });
  });
});
