/**
 * Unit tests for the agent event metadata normalizer.
 *
 * Covers the happy path for each existing field, the thinking-event fields
 * (thinking text, tokens, durationMs, startedAt) added in Task 6.1, and a
 * set of bad-case inputs (wrong type, missing fields, malformed selections)
 * to ensure defensive defaults are applied.
 */

import { describe, it, expect } from "vitest";
import {
  getAgentEventMetadata,
  normalizeTrackingSnapshot,
} from "../agent-event-metadata";
import type { AgentEventMetadata } from "@/types/im";

const FALLBACK: AgentEventMetadata = {
  agentEventType: "writing",
  status: "completed",
};

describe("getAgentEventMetadata", () => {
  describe("happy path", () => {
    it("returns minimal metadata when only required fields are present", () => {
      const result = getAgentEventMetadata(
        { agentEventType: "thinking", status: "running" },
        FALLBACK,
      );
      expect(result).toEqual({
        agentEventType: "thinking",
        status: "running",
      });
    });

    it("passes through tool call metadata fields", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "tool_call",
          status: "running",
          toolName: "search",
          toolCallId: "call_123",
          toolArgs: { query: "hello" },
        },
        FALLBACK,
      );
      expect(result).toEqual({
        agentEventType: "tool_call",
        status: "running",
        toolName: "search",
        toolCallId: "call_123",
        toolArgs: { query: "hello" },
      });
    });

    it("passes through tool_result success flag", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "tool_result",
          status: "completed",
          success: true,
        },
        FALLBACK,
      );
      expect(result.success).toBe(true);
    });

    it("passes through a2ui surface fields", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "a2ui_surface_update",
          status: "running",
          surfaceId: "surface-1",
          payload: [{ foo: 1 }, { bar: 2 }],
          surfaceMetadata: { catalogId: "cat-1" },
        },
        FALLBACK,
      );
      expect(result).toEqual({
        agentEventType: "a2ui_surface_update",
        status: "running",
        surfaceId: "surface-1",
        payload: [{ foo: 1 }, { bar: 2 }],
        surfaceMetadata: { catalogId: "cat-1" },
      });
    });

    it("normalizes selections with selected arrays and otherText", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "a2ui_response",
          status: "resolved",
          responderId: "user-1",
          responderName: "Alice",
          selections: {
            q1: { selected: ["a", "b", 123], otherText: "custom" },
            q2: { selected: ["x"], otherText: null },
          },
        },
        FALLBACK,
      );
      expect(result.responderId).toBe("user-1");
      expect(result.responderName).toBe("Alice");
      // 123 should be filtered out because it's not a string
      expect(result.selections).toEqual({
        q1: { selected: ["a", "b"], otherText: "custom" },
        q2: { selected: ["x"], otherText: null },
      });
    });
  });

  describe("thinking event fields (Task 6.1)", () => {
    it("passes through thinking content text", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "thinking",
          status: "completed",
          thinking: "Let me think about this...",
        },
        FALLBACK,
      );
      expect(result.thinking).toBe("Let me think about this...");
    });

    it("passes through token counts and duration", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "thinking",
          status: "completed",
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
          durationMs: 2500,
          startedAt: "2026-04-09T12:00:00.000Z",
        },
        FALLBACK,
      );
      expect(result).toMatchObject({
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
        durationMs: 2500,
        startedAt: "2026-04-09T12:00:00.000Z",
      });
    });

    it("accepts zero token counts and zero duration", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "thinking",
          status: "running",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: 0,
        },
        FALLBACK,
      );
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.durationMs).toBe(0);
    });

    it("drops non-string thinking", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "thinking",
          status: "running",
          thinking: 42,
        },
        FALLBACK,
      );
      expect(result.thinking).toBeUndefined();
    });

    it("drops non-finite or non-number token/duration values", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "thinking",
          status: "running",
          inputTokens: "not-a-number",
          outputTokens: Number.NaN,
          totalTokens: Number.POSITIVE_INFINITY,
          durationMs: null,
          startedAt: 1700000000000,
        },
        FALLBACK,
      );
      expect(result.inputTokens).toBeUndefined();
      expect(result.outputTokens).toBeUndefined();
      expect(result.totalTokens).toBeUndefined();
      expect(result.durationMs).toBeUndefined();
      expect(result.startedAt).toBeUndefined();
    });
  });

  describe("bad case", () => {
    it("returns fallback when value is not a record", () => {
      expect(getAgentEventMetadata(null, FALLBACK)).toBe(FALLBACK);
      expect(getAgentEventMetadata("thinking", FALLBACK)).toBe(FALLBACK);
      expect(getAgentEventMetadata(42, FALLBACK)).toBe(FALLBACK);
      expect(getAgentEventMetadata(undefined, FALLBACK)).toBe(FALLBACK);
    });

    it("returns fallback when agentEventType is invalid", () => {
      expect(
        getAgentEventMetadata(
          { agentEventType: "unknown", status: "running" },
          FALLBACK,
        ),
      ).toBe(FALLBACK);
    });

    it("returns fallback when status is invalid", () => {
      expect(
        getAgentEventMetadata(
          { agentEventType: "thinking", status: "weird" },
          FALLBACK,
        ),
      ).toBe(FALLBACK);
    });

    it("ignores optional fields with wrong types", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "tool_call",
          status: "running",
          toolName: 123,
          toolCallId: {},
          toolArgs: "not-an-object",
          success: "yes",
          surfaceId: 999,
          payload: "not-an-array",
          surfaceMetadata: null,
          selections: "not-an-object",
          responderId: 1,
          responderName: null,
        },
        FALLBACK,
      );
      expect(result).toEqual({
        agentEventType: "tool_call",
        status: "running",
      });
    });

    it("drops non-object selection entries", () => {
      const result = getAgentEventMetadata(
        {
          agentEventType: "a2ui_response",
          status: "resolved",
          selections: {
            q1: "not-an-object",
            q2: null,
            q3: { selected: "not-an-array", otherText: 42 },
          },
        },
        FALLBACK,
      );
      // q1 and q2 are filtered out, q3 produces empty selected and null otherText
      expect(result.selections).toEqual({
        q3: { selected: [], otherText: null },
      });
    });
  });
});

describe("normalizeTrackingSnapshot", () => {
  it("normalizes each latest message and keeps counts", () => {
    const snapshot = normalizeTrackingSnapshot({
      totalMessageCount: 2,
      latestMessages: [
        {
          id: "m1",
          content: "hello",
          metadata: {
            agentEventType: "thinking",
            status: "completed",
            thinking: "reasoning...",
            totalTokens: 10,
            durationMs: 500,
          },
          createdAt: "2026-04-09T00:00:00.000Z",
        },
        {
          id: "m2",
          content: "world",
          metadata: { agentEventType: "invalid" },
          createdAt: "2026-04-09T00:00:01.000Z",
        },
      ],
    });

    expect(snapshot.totalMessageCount).toBe(2);
    expect(snapshot.latestMessages).toHaveLength(2);
    expect(snapshot.latestMessages[0].metadata).toMatchObject({
      agentEventType: "thinking",
      status: "completed",
      thinking: "reasoning...",
      totalTokens: 10,
      durationMs: 500,
    });
    // m2 should fall back to default writing/completed
    expect(snapshot.latestMessages[1].metadata).toEqual({
      agentEventType: "writing",
      status: "completed",
    });
  });
});
