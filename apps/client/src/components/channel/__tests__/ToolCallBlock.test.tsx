import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
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

    it("shows nested invoke_tool wait calls as a wait operation", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("invoke_tool", {
            name: "wait",
            params: {
              seconds: 30,
              reason: "test wait resume",
              prompt: "resume after waiting",
            },
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent='{"success":true}'
        />,
      );

      expect(screen.getByText("Wait completed")).toBeInTheDocument();
      expect(screen.getByText(/wait\(seconds="30"/)).toBeInTheDocument();
      expect(screen.queryByText(/invoke_tool/)).not.toBeInTheDocument();
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

    it("renders load_tools as a loaded tool summary in zh-CN", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        const { container } = render(
          <ToolCallBlock
            callMetadata={makeCallMeta("load_tools", {
              names: ["PresentChoices"],
            })}
            resultMetadata={makeResultMeta("completed")}
            resultContent="Loaded: PresentChoices"
          />,
        );

        expect(screen.getByText("工具加载完成")).toBeInTheDocument();
        expect(screen.getByText(/加载了工具/)).toBeInTheDocument();
        expect(screen.queryByText(/load_tools/)).not.toBeInTheDocument();
        expect(container.querySelector("em")?.textContent).toBe(
          "PresentChoices",
        );
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("renders TodoWrite as compact one-line TODO items in zh-CN", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        render(
          <ToolCallBlock
            callMetadata={makeCallMeta("TodoWrite", {
              todos: [
                {
                  content: "验证 TODO 工具的显示效果",
                  activeForm: "正在验证 TODO 展示",
                  status: "in_progress",
                },
                { content: "看现有样式", status: "completed" },
                { content: "接入多行状态", status: "in_progress" },
                { content: "补测试", status: "pending" },
              ],
            })}
            resultMetadata={makeResultMeta("completed")}
            resultContent="ok"
          />,
        );

        expect(screen.getByText("TODO 更新完成")).toBeInTheDocument();
        expect(screen.getByText("TODO 4 项")).toBeInTheDocument();
        expect(screen.queryByText(/TodoWrite/)).not.toBeInTheDocument();
        expect(
          screen.queryByText("正在验证 TODO 展示"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByText("验证 TODO 工具的显示效果"),
        ).toBeInTheDocument();
        expect(screen.getByText("接入多行状态")).toBeInTheDocument();
        expect(screen.getByText("补测试")).toBeInTheDocument();
        expect(screen.queryByText("进行中")).not.toBeInTheDocument();
        expect(screen.queryByText("完成")).not.toBeInTheDocument();
        expect(screen.queryByText("未完成")).not.toBeInTheDocument();
        expect(screen.getAllByTestId("todo-write-status-icon")).toHaveLength(4);
        for (const item of screen.getAllByTestId("todo-write-item")) {
          expect(item).toHaveClass("items-center");
          expect(
            item.querySelectorAll("[data-testid='todo-write-title']"),
          ).toHaveLength(1);
        }

        fireEvent.click(screen.getByText("TODO 更新完成"));
        expect(screen.getByText("参数")).toBeInTheDocument();
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

    it("shows streaming tool args immediately while the call is being generated", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("RunScript", undefined, {
            status: "running",
            toolArgsText: '{"cmd":"pnpm test',
            toolPhase: "args_streaming",
          })}
          resultContent=""
        />,
      );

      expect(screen.getByText("Args")).toBeInTheDocument();
      expect(screen.getByText('{"cmd":"pnpm test')).toBeInTheDocument();
      expect(screen.queryByText("Result")).not.toBeInTheDocument();
    });

    it("formats a completed streaming tool call before the result arrives", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", undefined, {
            status: "running",
            toolArgsText: JSON.stringify({
              backend: "ahand:user-computer:ff00",
              command: "pnpm test",
            }),
            toolPhase: "executing",
          })}
          resultContent=""
        />,
      );

      expect(screen.getByText("Run command locally")).toBeInTheDocument();
      expect(screen.getByText("pnpm test")).toBeInTheDocument();
      expect(screen.queryByText(/run_command\(/)).not.toBeInTheDocument();
      expect(screen.queryByText("Args")).not.toBeInTheDocument();
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
    it("renders run_command as a readable Chinese command summary with split streams", async () => {
      await act(async () => {
        await changeLanguage("zh-CN");
      });
      try {
        render(
          <ToolCallBlock
            callMetadata={makeCallMeta("run_command", {
              name: "echo hello",
              backend: "ahand:user-computer:ff00",
              command: "echo hello",
            })}
            resultMetadata={makeResultMeta("completed")}
            resultContent={JSON.stringify({
              stdout: "hello\n",
              stderr: "warn\n",
              exitCode: 0,
            })}
          />,
        );

        expect(screen.getByText("在本机执行命令")).toBeInTheDocument();
        expect(screen.getByText("echo hello")).toBeInTheDocument();

        fireEvent.click(screen.getByText("在本机执行命令"));

        expect(screen.getByText("stdout")).toBeInTheDocument();
        expect(screen.getByText("hello")).toBeInTheDocument();
        expect(screen.getByText("stderr")).toBeInTheDocument();
        expect(screen.getByText("warn")).toBeInTheDocument();
        expect(screen.queryByText("参数")).not.toBeInTheDocument();
        expect(screen.queryByText("结果")).not.toBeInTheDocument();
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("hides empty run_command streams and zero exitCode when stdout has content", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", {
            backend: "ahand:user-computer:ff00",
            command: "echo hello",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify({
            stdout: "hello\n",
            stderr: "",
            exitCode: 0,
          })}
        />,
      );

      fireEvent.click(screen.getByText("Run command locally"));

      expect(screen.getByText("stdout")).toBeInTheDocument();
      expect(screen.getByText("hello")).toBeInTheDocument();
      expect(screen.queryByText("stderr")).not.toBeInTheDocument();
      expect(screen.queryByText("exitCode")).not.toBeInTheDocument();
    });

    it("shows zero exitCode when run_command streams are both empty", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", {
            backend: "ahand:user-computer:ff00",
            command: "true",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify({
            stdout: "",
            stderr: "",
            exitCode: 0,
          })}
        />,
      );

      fireEvent.click(screen.getByText("Run command locally"));

      expect(screen.queryByText("stdout")).not.toBeInTheDocument();
      expect(screen.queryByText("stderr")).not.toBeInTheDocument();
      expect(screen.getByText("exitCode")).toBeInTheDocument();
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("shows the command and message when run_command has no stdout or stderr", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", {
            backend: "ahand:user-computer:ff00",
            command: "python3 long-script.py",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify({
            message: "Command is still running in the background.",
            stdout: "",
            stderr: "",
            exitCode: 0,
          })}
        />,
      );

      fireEvent.click(screen.getByText("Run command locally"));

      expect(screen.getByText("command")).toBeInTheDocument();
      expect(screen.getAllByText("python3 long-script.py").length).toBe(2);
      expect(screen.getByText("message")).toBeInTheDocument();
      expect(
        screen.getByText("Command is still running in the background."),
      ).toBeInTheDocument();
      expect(screen.queryByText("stdout")).not.toBeInTheDocument();
      expect(screen.queryByText("stderr")).not.toBeInTheDocument();
      expect(screen.getByText("exitCode")).toBeInTheDocument();
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("shows non-zero run_command exitCode alongside output", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", {
            backend: "ahand:user-computer:ff00",
            command: "false",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify({
            stdout: "failed\n",
            stderr: "",
            exitCode: 2,
          })}
        />,
      );

      fireEvent.click(screen.getByText("Run command locally"));

      expect(screen.getByText("stdout")).toBeInTheDocument();
      expect(screen.getByText("failed")).toBeInTheDocument();
      expect(screen.queryByText("stderr")).not.toBeInTheDocument();
      expect(screen.getByText("exitCode")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("shows the run_command json toggle only after expansion", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", {
            backend: "ahand:user-computer:ff00",
            command: "echo hello",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify({
            stdout: "hello\n",
            stderr: "",
            exitCode: 0,
          })}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "json" }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Run command locally"));

      expect(screen.getByRole("button", { name: "json" })).toBeInTheDocument();
    });

    it("adds a fullscreen control to expanded raw blocks", () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen Args" }));

      const dialog = screen.getByRole("dialog", { name: "Args" });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveClass("bg-black/60");
      expect(dialog).toHaveClass("p-6");
      expect(dialog).toHaveClass("pt-12");

      const fullscreenPanel = within(dialog)
        .getByText(/"channelId": "ch-456"/)
        .closest("[data-fullscreen-panel]");
      expect(fullscreenPanel).toHaveClass("h-full");
      expect(within(dialog).getByText(/"channelId": "ch-456"/)).toHaveClass(
        "!max-h-none",
      );
      expect(
        within(dialog).getByText(/"channelId": "ch-456"/),
      ).toBeInTheDocument();
    });

    it("formats fullscreen JSON and can switch to raw", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("QueryChannel", {
            channelId: "ch-456",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent='{"name":"general","count":2}'
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));
      fireEvent.click(
        screen.getByRole("button", { name: "Fullscreen Result" }),
      );

      const dialog = screen.getByRole("dialog", { name: "Result" });
      expect(within(dialog).getByText(/"name": "general"/)).toBeInTheDocument();
      expect(within(dialog).getByText(/"count": 2/)).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "raw" }));

      expect(
        within(dialog).getByText('{"name":"general","count":2}'),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "formatted" }),
      ).toBeInTheDocument();
    });

    it("toggles raw JSON for run_command from the json button", () => {
      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("run_command", {
            name: "echo hello",
            backend: "ahand:user-computer:ff00",
            command: "echo hello",
          })}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify({
            stdout: "hello\n",
            stderr: "",
            exitCode: 0,
          })}
        />,
      );

      fireEvent.click(screen.getByText("Run command locally"));
      fireEvent.click(screen.getByRole("button", { name: "json" }));

      expect(screen.getByText("Args")).toBeInTheDocument();
      expect(
        screen.getByText(/"backend": "ahand:user-computer:ff00"/),
      ).toBeInTheDocument();
      expect(screen.getByText("Result")).toBeInTheDocument();
      expect(screen.getByText(/"stdout": "hello\\n"/)).toBeInTheDocument();
    });

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

    it("renders JSON string results as the raw string content rather than escaped JSON", () => {
      const agentVisibleResult = '{"name":"twitter_get_user_tweets"}';

      render(
        <ToolCallBlock
          callMetadata={makeCallMeta("invoke_tool")}
          resultMetadata={makeResultMeta("completed")}
          resultContent={JSON.stringify(agentVisibleResult)}
        />,
      );

      fireEvent.click(screen.getByText("Tool call completed"));

      expect(screen.getByText(agentVisibleResult)).toBeInTheDocument();
      expect(
        screen.queryByText(/\\"twitter_get_user_tweets\\"/),
      ).not.toBeInTheDocument();
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
