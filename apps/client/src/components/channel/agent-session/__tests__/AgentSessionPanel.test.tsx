import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionPanel } from "../AgentSessionPanel";
import type {
  AgentSessionBinding,
  SafeSessionComponentsResponse,
} from "@/types/im";

const mockChannelsApi = vi.hoisted(() => ({
  pauseAgentSession: vi.fn(),
  resumeAgentSession: vi.fn(),
}));

vi.mock("@/services/api/im", () => ({
  default: { channels: mockChannelsApi },
}));

const binding: AgentSessionBinding = {
  channelId: "ch-1",
  channelType: "direct" as const,
  kind: "dm" as const,
  supported: true,
  tenantId: "tenant-1",
  agentId: "agent-1",
  botUserId: "bot-user-1",
  sessionId: "session-1",
  status: { exists: true, activityState: "active" as const, queueLength: 1 },
};

beforeEach(() => {
  mockChannelsApi.pauseAgentSession.mockReset();
  mockChannelsApi.resumeAgentSession.mockReset();
});

function renderPanel({
  binding: panelBinding = binding,
  components,
  isLoading = false,
  isError = false,
}: {
  binding?: AgentSessionBinding;
  components?: SafeSessionComponentsResponse;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentSessionPanel
        binding={panelBinding}
        components={components}
        isLoading={isLoading}
        isError={isError}
        width={360}
        onWidthChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("AgentSessionPanel", () => {
  it("renders user-facing status and todo data by default", () => {
    renderPanel({
      components: {
        sessionId: "session-1",
        components: [
          {
            id: "todo",
            typeKey: "todo",
            runtimeInjectedOnly: false,
            latestData: {
              data: {
                todos: [
                  {
                    id: "1",
                    content: "整理员工关系跟进清单",
                    activeForm: "整理 HRBP 员工关系跟进清单",
                    status: "completed",
                  },
                  {
                    id: "2",
                    content: "更新劳动力数据追踪表",
                    activeForm: "更新劳动力数据追踪表中",
                    status: "in_progress",
                  },
                ],
              },
              capturedAtCallId: null,
              capturedAt: 1700000000000,
            },
          },
          {
            id: "persona",
            typeKey: "persona",
            runtimeInjectedOnly: false,
            latestData: {
              data: { mood: "focused" },
              capturedAtCallId: null,
              capturedAt: 1700000000000,
            },
          },
        ],
      },
    });

    expect(screen.getByText("Agent Session")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("整理员工关系跟进清单")).toBeInTheDocument();
    expect(screen.getByText("更新劳动力数据追踪表")).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
    expect(screen.getByText("正在进行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /暂停/ })).toBeInTheDocument();
    expect(screen.queryByText("persona")).not.toBeInTheDocument();
    expect(screen.queryByText(/focused/)).not.toBeInTheDocument();
  });

  it("shows pause by default even when the session is inactive", () => {
    renderPanel({
      binding: {
        ...binding,
        status: {
          exists: true,
          activityState: "inactive",
          queueLength: 0,
        },
      },
    });

    expect(screen.getByText("未运行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /暂停/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /恢复/ }),
    ).not.toBeInTheDocument();
  });

  it("switches to resume only after pause succeeds", async () => {
    mockChannelsApi.pauseAgentSession.mockResolvedValueOnce(undefined);
    mockChannelsApi.resumeAgentSession.mockResolvedValueOnce(undefined);

    renderPanel({
      binding: {
        ...binding,
        status: {
          exists: true,
          activityState: "inactive",
          queueLength: 0,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /暂停/ }));

    await waitFor(() => {
      expect(mockChannelsApi.pauseAgentSession).toHaveBeenCalledWith("ch-1");
    });
    expect(await screen.findByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /恢复/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /恢复/ }));

    await waitFor(() => {
      expect(mockChannelsApi.resumeAgentSession).toHaveBeenCalledWith("ch-1");
    });
    await waitFor(() => {
      expect(screen.getByText("未运行")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /暂停/ })).toBeInTheDocument();
  });

  it("reveals session id, component data, and config through the hidden debug gesture", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderPanel({
      components: {
        sessionId: "session-1",
        components: [
          {
            id: "persona",
            typeKey: "persona",
            runtimeInjectedOnly: false,
            declaredConfig: {
              promptKey: "staff-profile",
              token: "[redacted]",
            },
            effectiveConfig: {
              promptKey: "staff-profile",
              temperature: 0.2,
            },
            latestData: {
              data: { mood: "focused" },
              capturedAtCallId: null,
              capturedAt: 1700000000000,
            },
          },
        ],
      },
    });

    expect(screen.queryByText("persona")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Agent Session"), { altKey: true });

    expect(screen.getByText("Session ID")).toBeInTheDocument();
    expect(screen.getByText("session-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制 session id" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("session-1");
    });
    expect(screen.getByText("persona")).toBeInTheDocument();
    expect(screen.getByText("data")).toBeInTheDocument();
    expect(screen.getByText(/focused/)).toBeInTheDocument();
    expect(screen.getByText("config")).toBeInTheDocument();
    expect(screen.getByText(/temperature/)).toBeInTheDocument();
    expect(screen.getByText(/\[redacted\]/)).toBeInTheDocument();
  });

  it("keeps falsy snapshot data visible in hidden debug mode", () => {
    renderPanel({
      components: {
        sessionId: "session-1",
        components: [
          {
            id: "empty-result",
            typeKey: "empty-result",
            runtimeInjectedOnly: false,
            latestData: {
              data: null,
              capturedAtCallId: null,
              capturedAt: 1700000000000,
            },
          },
        ],
      },
    });

    fireEvent.click(screen.getByText("Agent Session"), { altKey: true });

    expect(screen.getByText("null")).toBeInTheDocument();
    expect(screen.queryByText("No snapshot yet")).not.toBeInTheDocument();
  });

  it("does not fake an empty todo snapshot when persisted data is missing", () => {
    renderPanel({
      components: {
        sessionId: "session-1",
        components: [
          {
            id: "todo",
            typeKey: "todo",
            runtimeInjectedOnly: false,
            latestData: null,
          },
        ],
      },
    });

    expect(screen.queryByText("TODO")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无 TODO")).not.toBeInTheDocument();
    expect(screen.queryByText(/"todos"/)).not.toBeInTheDocument();
  });

  it("hides the todo section while loading if there is no todo content yet", () => {
    renderPanel({ isLoading: true });

    expect(screen.queryByText("TODO")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading TODO")).not.toBeInTheDocument();
  });

  it("uses todo-shaped runtime snapshot data even when the component id differs", () => {
    renderPanel({
      components: {
        sessionId: "session-1",
        components: [
          {
            id: "todo",
            typeKey: "todo",
            runtimeInjectedOnly: false,
            latestData: null,
          },
          {
            id: "todo-1700000000000",
            typeKey: "todo-1700000000000",
            runtimeInjectedOnly: true,
            latestData: {
              data: {
                todos: [
                  {
                    id: "1",
                    content: "确认 Q2 绩效周期关键节点",
                    activeForm: "确认 Q2 绩效周期关键节点",
                    status: "pending",
                  },
                ],
              },
              capturedAtCallId: null,
              capturedAt: 1700000000000,
            },
          },
        ],
      },
    });

    expect(screen.getByText("确认 Q2 绩效周期关键节点")).toBeInTheDocument();
    expect(screen.getByText("未完成")).toBeInTheDocument();
  });

  it("renders unsupported fallback", () => {
    renderPanel({
      binding: {
        ...binding,
        supported: false,
        kind: null,
        sessionId: null,
        unsupportedReason: "not_hive_managed",
      },
    });

    expect(screen.getByText("Runtime details unavailable")).toBeInTheDocument();
    expect(screen.getByText("not_hive_managed")).toBeInTheDocument();
  });
});
