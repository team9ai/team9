import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreamingMessageItem } from "../StreamingMessageItem";
import type { StreamingMessage } from "@/stores/useStreamingStore";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/useMessages", () => ({
  useFullContent: () => ({ data: undefined }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({ mutateAsync: vi.fn() }),
}));

function makeStream(
  overrides: Partial<StreamingMessage> = {},
): StreamingMessage {
  return {
    streamId: "stream-1",
    channelId: "channel-1",
    senderId: "bot-1",
    content: "好，走一次完整的工具调用链：",
    thinking: "",
    isThinking: false,
    isStreaming: true,
    startedAt: Date.now(),
    parts: [],
    ...overrides,
  };
}

describe("StreamingMessageItem", () => {
  it("renders the streaming cursor inline with the final text paragraph", () => {
    const { container } = render(
      <StreamingMessageItem stream={makeStream()} members={[]} />,
    );

    const paragraph = screen
      .getByText("好，走一次完整的工具调用链：")
      .closest("p");
    const cursor = container.querySelector(
      '.channel-message-content span[class*="animate-pulse"][class*="bg-foreground"]',
    );

    expect(paragraph).not.toBeNull();
    expect(cursor).not.toBeNull();
    expect(paragraph).toContainElement(cursor as HTMLElement);
  });

  it("shows deep research progress while no report text has arrived yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:15:00.000Z"));

    render(
      <StreamingMessageItem
        stream={makeStream({
          content: "",
          isThinking: true,
          startedAt: new Date("2026-05-18T13:13:00.000Z").getTime(),
          metadata: {
            longRunning: true,
            deepResearch: {
              status: "running",
              phase: "started",
            },
          },
        })}
        members={[]}
      />,
    );

    expect(screen.getByText("深度研究")).toBeInTheDocument();
    expect(
      screen.getAllByText(/正在规划研究并检索资料/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/已运行 2 分钟/).length).toBeGreaterThan(0);
    expect(screen.getByText("系统构建研究框架")).toBeInTheDocument();
    expect(screen.getByText("正在研究网站")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /隐藏思考过程/ }),
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("shows only lightweight status for collaborative planning streams", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:15:00.000Z"));

    render(
      <StreamingMessageItem
        stream={makeStream({
          content: "",
          isThinking: false,
          startedAt: new Date("2026-05-18T13:14:00.000Z").getTime(),
          metadata: {
            longRunning: true,
            deepResearch: {
              kind: "plan",
              status: "running",
              phase: "started",
              progress: {
                phase: "thinking",
                thoughts: [
                  {
                    text: "这段计划阶段思路不应该作为研究过程展示。",
                  },
                ],
                sources: [
                  {
                    url: "https://example.com/plan",
                    title: "Plan source",
                  },
                ],
                queries: ["plan query"],
              },
            },
          },
        })}
        members={[]}
      />,
    );

    expect(screen.getByText("拟定方案中")).toBeInTheDocument();
    expect(screen.getAllByText(/正在拟定研究方案/).length).toBeGreaterThan(0);
    expect(screen.getByText(/已运行 1 分钟/)).toBeInTheDocument();
    expect(
      screen.queryByText(/正在等待研究服务返回可展示过程/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Plan source")).not.toBeInTheDocument();
    expect(screen.queryByText("plan query")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /隐藏思考过程|显示思考过程/ }),
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("renders structured deep research progress by default", () => {
    render(
      <StreamingMessageItem
        stream={makeStream({
          content: "",
          metadata: {
            longRunning: true,
            deepResearch: {
              title: "伊朗局势研究与分析",
              status: "running",
              phase: "searching",
              mode: "max",
              sources: {
                googleSearch: true,
                uploadedFiles: true,
              },
              agentConfig: {
                visualization: "auto",
              },
              progress: {
                phase: "searching",
                activeStep: "正在研究网站",
                thoughts: [
                  {
                    id: "0",
                    title: "梳理研究脉络",
                    text: "先建立政治与经济背景，再核对近期事件。",
                    status: "running",
                  },
                ],
                sources: [
                  {
                    id: "https://example.com/iran",
                    url: "https://example.com/iran",
                    title: "Iran analysis",
                    domain: "example.com",
                    status: "found",
                  },
                ],
                visuals: [
                  {
                    id: "chart-1",
                    url: "data:image/png;base64,iVBORw0KGgo=",
                    title: "地区风险变化图",
                  },
                ],
                queries: ["Iran 2026 politics"],
                counts: { searchQueries: 1, websites: 1 },
              },
            },
          },
        })}
        members={[]}
      />,
    );

    expect(screen.getByText("伊朗局势研究与分析")).toBeInTheDocument();
    expect(screen.getAllByText(/正在研究 1 个网站/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("梳理研究脉络").length).toBeGreaterThan(0);
    expect(screen.getByText("Deep Research Max")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Visuals")).toBeInTheDocument();
    expect(
      screen.getByText("先建立政治与经济背景，再核对近期事件。"),
    ).toBeInTheDocument();
    expect(screen.getByText("Iran analysis")).toBeInTheDocument();
    expect(screen.getByText("地区风险变化图")).toBeInTheDocument();
    expect(screen.getByText("Iran 2026 politics")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /隐藏思考过程|显示思考过程/ }),
    ).not.toBeInTheDocument();
  });
});
