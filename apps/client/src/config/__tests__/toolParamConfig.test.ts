import { describe, expect, it } from "vitest";
import {
  toolParamConfig,
  ToolParamConfigItem,
  formatParams,
} from "../toolParamConfig";

describe("toolParamConfig", () => {
  describe("config structure", () => {
    it("should be an object with tool configurations", () => {
      expect(typeof toolParamConfig).toBe("object");
      expect(toolParamConfig).not.toBeNull();
    });

    it("should contain SendToChannel configuration", () => {
      expect(toolParamConfig).toHaveProperty("SendToChannel");
      const config = toolParamConfig.SendToChannel as ToolParamConfigItem;
      expect(config.keyParams).toContain("channelName");
      expect(config.keyParams).toContain("message");
    });

    it("should contain SearchDocs configuration", () => {
      expect(toolParamConfig).toHaveProperty("SearchDocs");
      const config = toolParamConfig.SearchDocs as ToolParamConfigItem;
      expect(config.keyParams).toContain("query");
      expect(config.keyParams).toContain("limit");
    });

    it("should contain InvokeAPI configuration", () => {
      expect(toolParamConfig).toHaveProperty("InvokeAPI");
      const config = toolParamConfig.InvokeAPI as ToolParamConfigItem;
      expect(config.keyParams).toContain("endpoint");
      expect(config.keyParams).toContain("query");
    });

    it("should have truncate rules for SendToChannel", () => {
      const config = toolParamConfig.SendToChannel as ToolParamConfigItem;
      expect(config.truncate).toBeDefined();
      expect(config.truncate?.message).toBe(50);
    });

    it("should have truncate rules for SearchDocs", () => {
      const config = toolParamConfig.SearchDocs as ToolParamConfigItem;
      expect(config.truncate).toBeDefined();
      expect(config.truncate?.query).toBe(80);
    });

    it("should have truncate rules for InvokeAPI", () => {
      const config = toolParamConfig.InvokeAPI as ToolParamConfigItem;
      expect(config.truncate).toBeDefined();
      expect(config.truncate?.query).toBe(60);
    });
  });

  describe("ToolParamConfigItem interface", () => {
    it("should have keyParams as string array", () => {
      const config: ToolParamConfigItem = {
        keyParams: ["param1", "param2"],
      };
      expect(Array.isArray(config.keyParams)).toBe(true);
      expect(config.keyParams.every((p) => typeof p === "string")).toBe(true);
    });

    it("should optionally have truncate record", () => {
      const configWithoutTruncate: ToolParamConfigItem = {
        keyParams: ["param1"],
      };
      expect(configWithoutTruncate.truncate).toBeUndefined();

      const configWithTruncate: ToolParamConfigItem = {
        keyParams: ["param1"],
        truncate: { param1: 50 },
      };
      expect(configWithTruncate.truncate).toBeDefined();
      expect(typeof configWithTruncate.truncate?.param1).toBe("number");
    });
  });
});

describe("formatParams function", () => {
  describe("basic functionality with configured tools", () => {
    it("should extract key parameters from SendToChannel", () => {
      const params = {
        channelName: "general",
        message: "Hello world",
        userId: "user123",
      };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain('channelName="general"');
      expect(result).toContain('message="Hello world"');
      expect(result).not.toContain("userId");
      expect(result).not.toContain("user123");
    });

    it("should extract key parameters from SearchDocs", () => {
      const params = {
        query: "machine learning",
        limit: 10,
        offset: 0,
      };
      const result = formatParams("SearchDocs", params);
      expect(result).toContain('query="machine learning"');
      expect(result).toContain('limit="10"');
      expect(result).not.toContain("offset");
    });

    it("should extract key parameters from InvokeAPI", () => {
      const params = {
        endpoint: "/api/users",
        method: "GET",
        query: { id: "123" },
        timeout: 5000,
      };
      const result = formatParams("InvokeAPI", params);
      expect(result).toContain('endpoint="/api/users"');
      expect(result).toContain("query");
      expect(result).not.toContain("method");
      expect(result).not.toContain("timeout");
    });
  });

  describe("truncation functionality", () => {
    it("should truncate message parameter in SendToChannel to 50 chars", () => {
      const longMessage = "a".repeat(100);
      const params = {
        channelName: "general",
        message: longMessage,
      };
      const result = formatParams("SendToChannel", params);
      // Should show truncated message with indication
      expect(result).toContain("...");
      expect(result).toContain("words more");
    });

    it("should show correct word count for truncated message", () => {
      const longMessage = "a".repeat(100);
      const params = {
        channelName: "general",
        message: longMessage,
      };
      const result = formatParams("SendToChannel", params);
      const moreWords = 100 - 50;
      expect(result).toContain(`${moreWords} words more`);
    });

    it("should truncate query parameter in SearchDocs to 80 chars", () => {
      const longQuery = "b".repeat(150);
      const params = {
        query: longQuery,
        limit: 10,
      };
      const result = formatParams("SearchDocs", params);
      expect(result).toContain("...");
      expect(result).toContain("words more");
      const moreWords = 150 - 80;
      expect(result).toContain(`${moreWords} words more`);
    });

    it("should truncate query parameter in InvokeAPI to 60 chars", () => {
      const longQuery = "c".repeat(120);
      const params = {
        endpoint: "/api/test",
        query: longQuery,
      };
      const result = formatParams("InvokeAPI", params);
      expect(result).toContain("...");
      expect(result).toContain("words more");
      const moreWords = 120 - 60;
      expect(result).toContain(`${moreWords} words more`);
    });

    it("should not truncate parameters shorter than limit", () => {
      const params = {
        channelName: "general",
        message: "Short message",
      };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain("Short message");
      expect(result).not.toContain("...");
    });

    it("should handle exactly truncate limit length", () => {
      const message = "a".repeat(50);
      const params = {
        channelName: "general",
        message: message,
      };
      const result = formatParams("SendToChannel", params);
      // Should not truncate when exactly at limit
      expect(result).toContain(message);
      expect(result).not.toContain("words more");
    });

    it("should handle one char over truncate limit", () => {
      const message = "a".repeat(51);
      const params = {
        channelName: "general",
        message: message,
      };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain("...");
      expect(result).toContain("1 words more");
    });
  });

  describe("null and undefined handling", () => {
    it("should handle null parameters", () => {
      const params = {
        channelName: null,
        message: "test",
      };
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
      expect(result).toBeTruthy();
    });

    it("should handle undefined parameters", () => {
      const params = {
        channelName: undefined,
        message: "test",
      };
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
      expect(result).toBeTruthy();
    });

    it("should handle missing optional parameters", () => {
      const params = {
        channelName: "general",
      };
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
      expect(result).toContain("general");
    });

    it("should handle empty object", () => {
      const params = {};
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
    });

    it("should handle null params object gracefully", () => {
      const result = formatParams("SendToChannel", null as any);
      expect(typeof result).toBe("string");
    });

    it("should handle undefined params object gracefully", () => {
      const result = formatParams("SendToChannel", undefined as any);
      expect(typeof result).toBe("string");
    });
  });

  describe("data type handling", () => {
    it("should handle number values", () => {
      const params = {
        query: "test",
        limit: 42,
      };
      const result = formatParams("SearchDocs", params);
      expect(result).toContain("42");
    });

    it("should handle boolean values in key parameters", () => {
      // Test with an unknown tool that will show all params including booleans
      const params = {
        flag1: true,
        flag2: false,
      };
      const result = formatParams("CustomTool", params);
      expect(result).toContain("true");
      expect(result).toContain("false");
    });

    it("should handle array values", () => {
      const params = {
        endpoint: "/api/test",
        query: ["item1", "item2"],
      };
      const result = formatParams("InvokeAPI", params);
      expect(typeof result).toBe("string");
      // Array should be serialized
      expect(result).toContain("item1");
    });

    it("should handle object values", () => {
      const params = {
        endpoint: "/api/test",
        query: { key: "value", nested: { deep: true } },
      };
      const result = formatParams("InvokeAPI", params);
      expect(typeof result).toBe("string");
      expect(result).toContain("key");
    });

    it("should handle nested objects", () => {
      const params = {
        endpoint: "/api/users",
        query: {
          filter: {
            name: "John",
            age: 30,
          },
        },
      };
      const result = formatParams("InvokeAPI", params);
      expect(typeof result).toBe("string");
      expect(result).toContain("filter");
    });

    it("should handle Symbol type by converting to string", () => {
      // Testing the final fallback case in valueToString
      const sym = Symbol("test");
      const params = {
        endpoint: "/api/test",
        query: sym,
      };
      const result = formatParams("InvokeAPI", params);
      expect(typeof result).toBe("string");
      expect(result).toContain("Symbol");
    });
  });

  describe("unknown tools fallback", () => {
    it("should return JSON representation for unknown tools", () => {
      const params = {
        someParam: "value",
        anotherParam: 123,
      };
      const result = formatParams("UnknownTool", params);
      expect(typeof result).toBe("string");
      // Should contain JSON representation or similar
      expect(result).toContain("someParam");
    });

    it("should handle empty string tool name as unknown", () => {
      const params = {
        key: "value",
      };
      const result = formatParams("", params);
      expect(typeof result).toBe("string");
    });

    it("should return complete JSON for unknown tools", () => {
      const params = {
        param1: "value1",
        param2: "value2",
        param3: "value3",
      };
      const result = formatParams("CustomTool", params);
      expect(typeof result).toBe("string");
      // For unknown tools, should show all parameters
      expect(result).toContain("param1");
      expect(result).toContain("param2");
      expect(result).toContain("param3");
    });
  });

  describe("format output consistency", () => {
    it("should always return string", () => {
      const testCases = [
        {
          tool: "SendToChannel",
          params: { channelName: "test", message: "msg" },
        },
        { tool: "SearchDocs", params: { query: "q", limit: 5 } },
        { tool: "InvokeAPI", params: { endpoint: "/api", query: "q" } },
        { tool: "UnknownTool", params: { key: "value" } },
        { tool: "", params: {} },
      ];

      testCases.forEach(({ tool, params }) => {
        const result = formatParams(tool, params);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it("should include key parameter names in output", () => {
      const params = {
        channelName: "general",
        message: "hello",
      };
      const result = formatParams("SendToChannel", params);
      // Should show which parameters are being displayed
      expect(result).toContain("channelName");
      expect(result).toContain("message");
    });

    it("should include key parameter values in output", () => {
      const params = {
        query: "search term",
        limit: 20,
      };
      const result = formatParams("SearchDocs", params);
      expect(result).toContain("search term");
      expect(result).toContain("20");
    });
  });

  describe("edge cases", () => {
    it("should handle very long tool names", () => {
      const longToolName = "A".repeat(1000);
      const params = { key: "value" };
      const result = formatParams(longToolName, params);
      expect(typeof result).toBe("string");
    });

    it("should handle parameters with special characters", () => {
      const params = {
        channelName: "special!@#$%^&*()",
        message: "message with \n newlines \t tabs",
      };
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
    });

    it("should handle unicode in parameters", () => {
      const params = {
        channelName: "通道",
        message: "你好世界",
      };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain("通道");
      expect(result).toContain("你好世界");
    });

    it("should handle empty string parameters", () => {
      const params = {
        channelName: "",
        message: "",
      };
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
    });

    it("should handle very large parameter values", () => {
      const largeString = "x".repeat(10000);
      const params = {
        channelName: "test",
        message: largeString,
      };
      const result = formatParams("SendToChannel", params);
      expect(typeof result).toBe("string");
      expect(result).toContain("...");
      expect(result).toContain("words more");
    });

    it("should handle nested truncation with multiple long parameters", () => {
      const params = {
        endpoint: "a".repeat(100),
        query: "b".repeat(100),
      };
      const result = formatParams("InvokeAPI", params);
      expect(typeof result).toBe("string");
      // Both should be truncated
      expect((result.match(/\.\.\./g) || []).length).toBeGreaterThan(0);
    });
  });

  describe("truncation word count calculation", () => {
    it("should calculate correct word count for 1 character over limit", () => {
      const message = "a".repeat(51);
      const params = { channelName: "test", message };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain("1 words more");
    });

    it("should calculate correct word count for 10 characters over limit", () => {
      const message = "a".repeat(60);
      const params = { channelName: "test", message };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain("10 words more");
    });

    it("should calculate correct word count for 100 characters over limit", () => {
      const message = "a".repeat(150);
      const params = { channelName: "test", message };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain("100 words more");
    });
  });
});
