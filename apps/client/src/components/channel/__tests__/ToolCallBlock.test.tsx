import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "@/i18n";
import { ToolCallBlock } from "../ToolCallBlock";
import type { AgentEventMetadata } from "@/types/im";

beforeEach(async () => {
  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

function makeCallMeta(
  toolName: string,
  toolArgs?: Record<string, unknown>,
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "completed",
    toolName,
    toolCallId: "tc-1",
    toolArgs,
  };
}

function makeResultMeta(
  status: "completed" | "failed" | "running" = "completed",
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status,
    success: status === "completed",
    toolCallId: "tc-1",
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

    it("treats missing result content as running (loading label)", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("SearchFiles")}
          resultMetadata={makeResultMeta("completed")}
          resultContent=""
        />,
      );

      // Missing result content → still loading regardless of status
      expect(screen.getByText("Calling tool")).toBeInTheDocument();
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

    it("renders the zh localized label when the language is set to zh", async () => {
      await act(async () => {
        await i18n.changeLanguage("zh");
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

    it("shows failure cross for failed result", () => {
      const { container } = render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript")}
          resultMetadata={makeResultMeta("failed")}
          resultContent="permission denied"
        />,
      );

      expect(screen.getByText("\u2718")).toBeInTheDocument();
      expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
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

    it("uses a green dot for successful result", () => {
      const { container } = render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Tool")}
          resultMetadata={makeResultMeta("completed")}
          resultContent="ok"
        />,
      );

      expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
      expect(container.querySelector(".bg-red-500")).not.toBeInTheDocument();
    });

    it("uses an animated green dot while running", () => {
      const { container } = render(
        <ToolCallBlock
          callMetadata={makeCallMeta("Tool")}
          resultMetadata={makeResultMeta("running")}
          resultContent=""
        />,
      );

      expect(
        container.querySelector(".bg-emerald-500.animate-pulse"),
      ).toBeInTheDocument();
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
