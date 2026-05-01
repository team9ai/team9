import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "@/i18n";
import { changeLanguage } from "@/i18n/loadLanguage";
import { ToolCallBlock } from "../ToolCallBlock";
import type { AgentEventMetadata, Message } from "@/types/im";

const mockUseFullContent = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useMessages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMessages")>();
  return {
    ...actual,
    useFullContent: (...args: unknown[]) => mockUseFullContent(...args),
  };
});

beforeEach(async () => {
  mockUseFullContent.mockReturnValue({ data: undefined });
  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

function makeCallMeta(
  toolName: string,
  toolArgs?: Record<string, unknown>,
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "completed",
    toolName,
    toolCallId: "tc-1",
    toolArgs,
    ...overrides,
  };
}

function makeResultMeta(
  status: "completed" | "failed" | "running" = "completed",
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status,
    success: status === "completed",
    toolCallId: "tc-1",
    ...overrides,
  };
}

describe("ToolCallBlock", () => {
  describe("label copy", () => {
    it("shows the success label when the result is completed", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles")}
          resultMetadata={makeResultMeta("completed")}
          resultContent='{"found": true}'
        />,
      );

      expect(screen.getByText("Tool call completed")).toBeInTheDocument();
    });

    it("shows the error label when the result is failed", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles")}
          resultMetadata={makeResultMeta("failed")}
          resultContent="permission denied"
        />,
      );

      expect(screen.getByText("Tool call failed")).toBeInTheDocument();
    });

    it("shows the loading label when the result is still running", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles")}
          resultMetadata={makeResultMeta("running")}
          resultContent=""
        />,
      );

      expect(screen.getByText("Calling tool")).toBeInTheDocument();
    });

    it("uses completed result metadata even when result content is empty", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles")}
          resultMetadata={makeResultMeta("completed")}
          resultContent=""
        />,
      );

      expect(screen.getByText("Tool call completed")).toBeInTheDocument();
    });

    it("uses tool-specific copy when the tool has a dedicated label (send_message success)", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("send_message", { message: "hi" })}
          resultMetadata={makeResultMeta("completed")}
          resultContent="ok"
        />,
      );

      expect(screen.getByText("Message sent")).toBeInTheDocument();
    });

    it("uses tool-specific loading copy (send_message running)", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("send_message", { message: "hi" })}
          resultMetadata={makeResultMeta("running")}
          resultContent=""
        />,
      );

      expect(screen.getByText("Sending message")).toBeInTheDocument();
    });

    it("uses tool-specific error copy (send_message failed)", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("send_message", { message: "hi" })}
          resultMetadata={makeResultMeta("failed")}
          resultContent="error"
        />,
      );

      expect(screen.getByText("Failed to send message")).toBeInTheDocument();
    });

    it("renders the zh-CN localized label when the language is set to zh-CN", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        render(
          <ToolCallBlock
            callMetadata={makeCallMeta("send_message", { message: "hi" })}
            resultMetadata={makeResultMeta("completed")}
            resultContent="ok"
          />,
        );

        expect(screen.getByText("消息发送完成")).toBeInTheDocument();
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });
  });

  describe("params summary (formatParams)", () => {
    it('renders a configured tool with friendly key="value" pairs', () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SendToChannel", {
            channelName: "general",
            message: "Hello world",
            userId: "user123",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent='{"ok":true}'
        />,
      );

      // formatParams extracts only keyParams (channelName, message)
      expect(
        screen.getByText(
          'SendToChannel(channelName="general", message="Hello world")',
        ),
      ).toBeInTheDocument();
    });

    it("truncates long params with '(N more)' hint", () => {
      const longMessage = "a".repeat(100);
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SendToChannel", {
            channelName: "general",
            message: longMessage,
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent="ok"
        />,
      );

      // truncate limit for message is 50 → "aaaa...aaa...(50 more)"
      expect(screen.getByText(/channelName="general"/)).toBeInTheDocument();
      expect(screen.getByText(/\(50 more\)/)).toBeInTheDocument();
    });

    it("falls back to JSON representation for unknown tools", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("UnknownTool", {
            foo: "bar",
            nested: { a: 1 },
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent="ok"
        />,
      );

      expect(
        screen.getByText('UnknownTool({"foo":"bar","nested":{"a":1}})'),
      ).toBeInTheDocument();
    });

    it("renders tool name alone when no params are provided", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="ok"
        />,
      );

      expect(screen.getByText("SearchFiles")).toBeInTheDocument();
    });
  });

  describe("status indicators", () => {
    it("shows success check mark for completed result", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("ReadFile")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="file contents"
        />,
      );

      expect(screen.getByText("\u2714")).toBeInTheDocument();
    });

    it("shows failure cross and a red wrench icon for failed result", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript")}
          resultMetadata={makeResultMeta("failed")}
          resultContent="permission denied"
        />,
      );

      expect(screen.getByText("\u2718")).toBeInTheDocument();
      const icon = screen.getByTestId("event-icon");
      expect(icon).toHaveClass("text-red-500");
      expect(icon).not.toHaveClass("animate-pulse");
    });

    it("keeps failed row text neutral while retaining failure indicators", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript")}
          resultMetadata={makeResultMeta("failed")}
          resultContent="permission denied"
        />,
      );

      const label = screen.getByText("Tool call failed");
      expect(label).toHaveClass("text-foreground/70");
      expect(label).not.toHaveClass("text-red-500");

      const displayLine = screen.getByText("RunScript");
      expect(displayLine).toHaveClass("text-foreground/80");
      expect(displayLine).not.toHaveClass("text-red-400");

      expect(screen.getByText("\u2718")).toHaveClass("text-red-400");
    });

    it("does NOT show a result indicator while still running", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("ReadFile")}
          resultMetadata={makeResultMeta("running")}
          resultContent=""
        />,
      );

      expect(screen.queryByText("\u2714")).not.toBeInTheDocument();
      expect(screen.queryByText("\u2718")).not.toBeInTheDocument();
    });

    it("shows failure when result success is false even if status is completed", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript")}
          resultMetadata={makeResultMeta("completed", { success: false })}
          resultContent='{"success":false,"error":"script failed"}'
        />,
      );

      expect(screen.getByText("Tool call failed")).toBeInTheDocument();
      expect(screen.getByText("\u2718")).toBeInTheDocument();
      expect(screen.queryByText("\u2714")).not.toBeInTheDocument();
    });

    it("shows failure when wrapped legacy result content has success false", () => {
      const wrappedContent = JSON.stringify({
        content: [
          {
            type: "text",
            text: '{"success":false,"error":"permission denied"}',
          },
        ],
      });

      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript")}
          resultMetadata={makeResultMeta("completed", { success: undefined })}
          resultContent={wrappedContent}
        />,
      );

      expect(screen.getByText("Tool call failed")).toBeInTheDocument();
      expect(screen.getByText("\u2718")).toBeInTheDocument();
    });

    it("shows failure for tool-not-found text results from old completed metadata", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("invoke_tool")}
          resultMetadata={makeResultMeta("completed", { success: true })}
          resultContent="tool not found: completeRoutine. Use search_tools to find available tools."
        />,
      );

      expect(screen.getByText("Tool call failed")).toBeInTheDocument();
      expect(screen.getByText("\u2718")).toBeInTheDocument();
      expect(screen.queryByText("\u2714")).not.toBeInTheDocument();
    });

    it("renders a running tool call without result metadata", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript", undefined, {
            status: "running",
            toolArgsText: '{"cmd":"pnpm test',
          })}
          resultContent=""
        />,
      );

      expect(screen.getByText("Calling tool")).toBeInTheDocument();
      expect(screen.queryByText("\u2714")).not.toBeInTheDocument();
      expect(screen.queryByText("\u2718")).not.toBeInTheDocument();
      expect(screen.getByText(/RunScript/)).toBeInTheDocument();
    });

    it("uses an emerald wrench icon for successful result", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Tool")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="ok"
        />,
      );

      const icon = screen.getByTestId("event-icon");
      expect(icon).toHaveClass("text-emerald-500");
      expect(icon).not.toHaveClass("text-red-500");
      expect(icon).not.toHaveClass("animate-pulse");
    });

    it("pulses a yellow wrench icon while running", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Tool")}
          resultMetadata={makeResultMeta("running")}
          resultContent=""
        />,
      );

      const icon = screen.getByTestId("event-icon");
      expect(icon).toHaveClass("text-yellow-400");
      expect(icon).toHaveClass("animate-pulse");
    });
  });

  describe("expand / collapse behaviour", () => {
    it("shows both args and result when expanded", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("QueryChannel", {
            channelId: "ch-456",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent='{"name": "general"}'
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      expect(screen.getByText("Args")).toBeInTheDocument();
      expect(screen.getByText(/"channelId": "ch-456"/)).toBeInTheDocument();

      expect(screen.getByText("Result")).toBeInTheDocument();
    });

    it("hides the Args section when no toolArgs are provided", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SimpleTool")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="done"
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      expect(screen.queryByText("Args")).not.toBeInTheDocument();
      expect(screen.getByText("Result")).toBeInTheDocument();
    });

    it("hides the Result section when there is no result content", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles", { query: "foo" })}
          resultMetadata={makeResultMeta("running")}
          resultContent=""
        />,
      );

      fireEvent.click(screen.getByText("Calling tool"));

      expect(screen.getByText("Args")).toBeInTheDocument();
      expect(screen.queryByText("Result")).not.toBeInTheDocument();
    });

    it("can expand on failure to display the error detail", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript", { cmd: "./run.sh" })}
          resultMetadata={makeResultMeta("failed")}
          resultContent="permission denied"
        />,
      );

      fireEvent.click(screen.getByText("Tool call failed"));

      expect(screen.getByText("Args")).toBeInTheDocument();
      expect(screen.getByText("Result")).toBeInTheDocument();
      expect(screen.getByText("permission denied")).toBeInTheDocument();
    });

    it("uses fetched full content for expanded truncated result messages", () => {
      const resultMessage: Pick<
        Message,
        "id" | "type" | "content" | "isTruncated" | "fullContentLength"
      > = {
        id: "msg-result-1",
        type: "tracking",
        content: '{"preview":true}',
        isTruncated: true,
        fullContentLength: 5000,
      };
      mockUseFullContent.mockReturnValue({
        data: { content: '{"full":true,"value":"complete result"}' },
      });

      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("ReadLargeResult")}
          resultMetadata={makeResultMeta("completed")}
          resultContent='{"preview":true}'
          resultMessage={resultMessage}
        />,
      );

      expect(mockUseFullContent).toHaveBeenLastCalledWith(
        "msg-result-1",
        false,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      expect(mockUseFullContent).toHaveBeenLastCalledWith("msg-result-1", true);
      expect(screen.getByText(/"full": true/)).toBeInTheDocument();
      expect(screen.getByText(/"complete result"/)).toBeInTheDocument();
      expect(screen.queryByText(/"preview": true/)).not.toBeInTheDocument();
    });

    it("toggles collapse state when clicked twice", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Search")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="toggle content"
        />,
      );

      const label = screen.getByText("Tool call completed");

      // Expand
      fireEvent.click(label);
      expect(screen.getByText("Result")).toBeInTheDocument();

      // Collapse — Result header disappears when collapsed
      fireEvent.click(label);
      expect(screen.queryByText("Result")).not.toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("falls back to 'Unknown tool' when toolName is missing", () => {
      const meta: AgentEventMetadata = {
        agentEventType: "tool_call",
        status: "completed",
        toolCallId: "tc-1",
      };
      render(
        <ToolCallBlock
          callMetadata={meta}
          resultMetadata={makeResultMeta("completed")}
          resultContent="result"
        />,
      );

      expect(screen.getByText("Unknown tool")).toBeInTheDocument();
    });

    it("unwraps nested content structure in the expanded result", () => {
      const wrappedContent = JSON.stringify({
        content: [{ type: "text", text: '{"success":true}' }],
        details: {},
      });

      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("ReportSteps")}
          resultMetadata={makeResultMeta("completed")}
          resultContent={wrappedContent}
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      // The expanded Result pre shows the unwrapped + re-formatted JSON
      expect(screen.getByText(/"success": true/)).toBeInTheDocument();
    });

    it("falls back to the raw result when nested content has no text blocks", () => {
      const wrappedContent = JSON.stringify({
        content: [{ type: "image", url: "x" }],
      });

      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Tool")}
          resultMetadata={makeResultMeta("completed")}
          resultContent={wrappedContent}
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      // No text-type blocks → unwrap falls through to raw content
      expect(screen.getByText(/"type": "image"/)).toBeInTheDocument();
    });

    it("gracefully handles non-JSON result content in the expanded pre", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Echo")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="plain text"
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      expect(screen.getByText("plain text")).toBeInTheDocument();
    });
  });
});
