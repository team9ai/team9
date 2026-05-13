import { describe, expect, it } from "vitest";
import {
  buildToolDisplayState,
  extractToolResultImages,
  unwrapToolResultContent,
} from "../tool-events";
import type { AgentEventMetadata } from "@/types/im";

function callMeta(
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "running",
    toolCallId: "tc-1",
    toolName: "send_message",
    toolArgs: { message: "hello" },
    ...overrides,
  };
}

function resultMeta(
  overrides: Partial<AgentEventMetadata> = {},
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status: "completed",
    toolCallId: "tc-1",
    success: true,
    ...overrides,
  };
}

describe("unwrapToolResultContent", () => {
  it("unwraps text blocks from tool result content wrappers", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: '{"success":false}' }],
      details: {},
    });

    expect(unwrapToolResultContent(raw)).toBe('{"success":false}');
  });

  it("keeps image content blocks so read_image base64 is visible", () => {
    const raw = JSON.stringify({
      content: [
        {
          type: "text",
          text: "[read_image] /Users/winrey/Downloads/example.jpg",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "/9j/4AAQSkZJRgABAQAAAQABAAD",
          },
        },
      ],
    });

    const unwrapped = unwrapToolResultContent(raw);

    expect(unwrapped).toContain(
      "[read_image] /Users/winrey/Downloads/example.jpg",
    );
    expect(unwrapped).toContain('"type": "image"');
    expect(unwrapped).toContain('"media_type": "image/jpeg"');
    expect(unwrapped).toContain("/9j/4AAQSkZJRgABAQAAAQABAAD");
  });
});

describe("extractToolResultImages", () => {
  it("extracts direct image blocks with base64 data as data URLs", () => {
    const images = extractToolResultImages(
      JSON.stringify({
        type: "image",
        data: "/9j/4AAQSkZJRgABAQAAAQABAAD",
      }),
    );

    expect(images).toEqual([
      {
        alt: "Tool result image 1",
        mediaType: "image/jpeg",
        src: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD",
      },
    ]);
  });

  it("extracts Anthropic-style image source blocks from tool result wrappers", () => {
    const images = extractToolResultImages(
      JSON.stringify({
        content: [
          { type: "text", text: "[read_image] /tmp/shot.png" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
            },
          },
        ],
      }),
    );

    expect(images).toEqual([
      {
        alt: "Tool result image 1",
        mediaType: "image/png",
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      },
    ]);
  });
});

describe("buildToolDisplayState", () => {
  it("builds a local run_command display state with split streams", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "run_command",
        toolArgs: {
          name: "echo hello",
          backend: "ahand:user-computer:ff00",
          command: "echo hello",
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: JSON.stringify({
        stdout: "hello\n",
        stderr: "",
        exitCode: 0,
      }),
    });

    expect(state.commandExecution).toEqual({
      command: "echo hello",
      backend: "ahand:user-computer:ff00",
      targetKind: "local",
      targetName: undefined,
      stdout: "hello\n",
      stderr: "",
      exitCode: "0",
    });
  });

  it("classifies cloud run_command backends for display copy", () => {
    const cloudComputer = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "run_command",
        toolArgs: {
          backend: "cloud-computer:e2b_id_xxxxx",
          command: "pwd",
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"stdout":"/workspace\\n","stderr":""}',
    }).commandExecution;
    const cloudSandbox = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "run_command",
        toolArgs: {
          backend: "just-bash-team9-workspace",
          command: "ls",
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"stdout":"file.txt\\n","stderr":""}',
    }).commandExecution;

    expect(cloudComputer?.targetKind).toBe("cloud-computer");
    expect(cloudComputer?.targetName).toBe("e2b_id_xxxxx");
    expect(cloudSandbox?.targetKind).toBe("cloud-sandbox");
    expect(cloudSandbox?.targetName).toBeUndefined();
    expect(cloudSandbox?.backend).toBe("just-bash-team9-workspace");
  });

  it("classifies non-local ahand run_command backends separately from generic backends", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "run_command",
        toolArgs: {
          backend: "ahand:office-linux:ff01",
          command: "hostname",
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"stdout":"office-linux\\n","stderr":""}',
    });

    expect(state.commandExecution?.targetKind).toBe("ahand-device");
    expect(state.commandExecution?.targetName).toBeUndefined();
    expect(state.commandExecution?.backend).toBe("ahand:office-linux:ff01");
  });

  it("treats success false as failure even when status is completed", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: false }),
      resultContent: '{"ok":false}',
    });

    expect(state.status).toBe("error");
    expect(state.isError).toBe(true);
    expect(state.indicator).toBe("cross");
  });

  it("detects legacy wrapped success false payloads as failure", () => {
    const wrapped = JSON.stringify({
      content: [{ type: "text", text: '{"success":false,"error":"denied"}' }],
    });

    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: undefined }),
      resultContent: wrapped,
    });

    expect(state.status).toBe("error");
    expect(state.errorMessage).toBe("denied");
  });

  it("detects tool-not-found text errors as failure even when old metadata says success", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({ toolName: "invoke_tool" }),
      resultMetadata: resultMeta({ success: true }),
      resultContent:
        "tool not found: completeRoutine. Use search_tools to find available tools.",
    });

    expect(state.status).toBe("error");
    expect(state.isError).toBe(true);
    expect(state.indicator).toBe("cross");
    expect(state.errorMessage).toBe(
      "tool not found: completeRoutine. Use search_tools to find available tools.",
    );
  });

  it("renders a missing result as running", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolArgs: undefined,
        toolArgsText: '{"message":"hel',
      }),
    });

    expect(state.status).toBe("loading");
    expect(state.isRunning).toBe(true);
    expect(state.argsText).toBe('{"message":"hel');
  });

  it("uses structured args for expanded text when partial args text also exists", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({ toolArgsText: '{"message":"hel' }),
    });

    expect(state.argsText).toBe(JSON.stringify({ message: "hello" }, null, 2));
  });

  it("uses streaming args text while structured args are still being generated", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolArgs: {},
        toolArgsText: '{"message":"hel',
        toolPhase: "args_streaming",
      }),
    });

    expect(state.argsSummary).toBe('{"message":"hel');
    expect(state.argsText).toBe('{"message":"hel');
  });

  it("surfaces the nested invoke_tool target and params while args are still streaming", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "invoke_tool",
        toolArgs: undefined,
        toolArgsText:
          '{"name":"write_file","params":{"path":"/tmp/lia_stream_v7.py","content":"import time',
        toolPhase: "args_streaming",
      }),
    });

    expect(state.toolName).toBe("write_file");
    expect(state.argsSummary).toBe(
      '{"path":"/tmp/lia_stream_v7.py","content":"import time',
    );
    expect(state.argsText).toBe(
      '{"path":"/tmp/lia_stream_v7.py","content":"import time',
    );
  });

  it("parses completed streaming args text once the tool call starts executing", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "run_command",
        toolArgs: undefined,
        toolArgsText: JSON.stringify({
          backend: "ahand:user-computer:ff00",
          command: "pnpm test",
        }),
        toolPhase: "executing",
      }),
      resultMetadata: resultMeta({ status: "running" }),
      resultContent: "",
    });

    expect(state.argsText).toContain('"command": "pnpm test"');
    expect(state.commandExecution).toEqual({
      backend: "ahand:user-computer:ff00",
      command: "pnpm test",
      targetKind: "local",
      targetName: undefined,
      stdout: "",
      stderr: "",
    });
  });

  it("extracts run_command message results for the friendly display", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "run_command",
        toolArgs: {
          backend: "ahand:user-computer:ff00",
          command: "python3 long-script.py",
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: JSON.stringify({
        message: "Command is still running in the background.",
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });

    expect(state.commandExecution).toEqual({
      backend: "ahand:user-computer:ff00",
      command: "python3 long-script.py",
      message: "Command is still running in the background.",
      targetKind: "local",
      targetName: undefined,
      stdout: "",
      stderr: "",
      exitCode: "0",
    });
  });

  it("parses completed streaming invoke_tool args into the nested display tool", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "invoke_tool",
        toolArgs: undefined,
        toolArgsText: JSON.stringify({
          name: "wait",
          params: { seconds: 30, reason: "rate limit" },
        }),
        toolPhase: "executing",
      }),
      resultMetadata: resultMeta({ status: "running" }),
      resultContent: "",
    });

    expect(state.toolName).toBe("wait");
    expect(state.argsSummary).toContain('seconds="30"');
    expect(state.argsSummary).toContain('reason="rate limit"');
    expect(state.argsText).toContain('"seconds": 30');
    expect(state.argsText).not.toContain('"name": "wait"');
  });

  it("uses completed result as success when no failure evidence exists", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"success":true}',
    });

    expect(state.status).toBe("success");
    expect(state.isSuccess).toBe(true);
    expect(state.indicator).toBe("check");
  });

  it("unwraps invoke_tool metadata to display the actual nested tool", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "invoke_tool",
        toolArgs: {
          name: "wait",
          params: {
            seconds: 30,
            reason: "测试 wait 重新触发",
            prompt: "30 秒等待完成后继续回复",
          },
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"success":true}',
    });

    expect(state.toolName).toBe("wait");
    expect(state.argsSummary).toContain('seconds="30"');
    expect(state.argsSummary).toContain('reason="测试 wait 重新触发"');
    expect(state.argsText).toContain('"seconds": 30');
    expect(state.argsText).not.toContain('"name": "wait"');
  });

  it("extracts loaded tool names from load_tools args", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "load_tools",
        toolArgs: { names: ["PresentChoices", "SearchDocs"] },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: "Loaded: PresentChoices, SearchDocs",
    });

    expect(state.loadedToolNames).toEqual(["PresentChoices", "SearchDocs"]);
  });

  it("builds a TodoWrite display with every todo item in source order", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta({
        toolName: "TodoWrite",
        toolArgs: {
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
        },
      }),
      resultMetadata: resultMeta({ success: true }),
      resultContent: "ok",
    });

    expect(state.todoWrite).toEqual({
      total: 4,
      pending: 1,
      inProgress: 2,
      completed: 1,
      items: [
        {
          content: "验证 TODO 工具的显示效果",
          activeForm: "正在验证 TODO 展示",
          status: "in_progress",
        },
        { content: "看现有样式", status: "completed" },
        { content: "接入多行状态", status: "in_progress" },
        { content: "补测试", status: "pending" },
      ],
    });
  });

  it("keeps explicitly successful results as success when content has an error field", () => {
    const state = buildToolDisplayState({
      callMetadata: callMeta(),
      resultMetadata: resultMeta({ success: true }),
      resultContent: '{"error":"domain field, not failure"}',
    });

    expect(state.status).toBe("success");
    expect(state.isSuccess).toBe(true);
  });
});
