import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeepResearchPlanCard } from "../DeepResearchPlanCard";
import type { Message } from "@/types/im";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  sessionAction: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock("@/services/api/im", () => ({
  default: {
    deepResearchSessions: {
      action: mocks.sessionAction,
    },
    messages: {
      sendMessage: mocks.sendMessage,
    },
  },
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "plan-msg-1",
    channelId: "ch-1",
    senderId: "bot-1",
    content:
      "# 猜想未来科技与社会趋势\n\n" +
      "1. 检索当前最热门的前沿科技趋势。\n" +
      "2. 查找近期引发讨论但尚无定论的现象。\n" +
      "3. 收集专家预测和行业智库报告。\n" +
      "4. 筛选最具启发性的几个方向。\n" +
      "5. 评估这些猜想发生的可能性。",
    type: "text",
    metadata: {
      deepResearch: {
        kind: "plan",
        interactionId: "interaction-plan-1",
        taskId: "task-1",
        session: {
          childChannelId: "deep-child-1",
          parentChannelId: "ch-1",
        },
      },
    },
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("DeepResearchPlanCard", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue({});
    mocks.sessionAction.mockReset();
    mocks.sessionAction.mockResolvedValue({ accepted: true });
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue({});
  });

  it("renders a plan-oriented card instead of raw markdown", () => {
    render(<DeepResearchPlanCard message={makeMessage()} />);

    expect(screen.getByText("猜想未来科技与社会趋势")).toBeInTheDocument();
    expect(screen.getByText("Research websites")).toBeInTheDocument();
    expect(screen.getByText("Analyze results")).toBeInTheDocument();
    expect(screen.getByText("Generate report")).toBeInTheDocument();
    expect(screen.getByText("Modify plan")).toBeInTheDocument();
    expect(screen.getByText("Start research")).toBeInTheDocument();
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
  });

  it("parses capability-hub Title/Input/Research Plan markdown as a plan card", () => {
    render(
      <DeepResearchPlanCard
        message={makeMessage({
          content:
            "**Title:** 伊朗当前局势深度研究\n\n" +
            "**Input:** 深度研究伊朗局势\n\n" +
            "**Research Plan:**\n" +
            "(1) 梳理国内政治格局与最高领袖权力结构。\n" +
            "(2) 调查核谈判进展与 IAEA 最新信息。\n" +
            "(3) 分析经济制裁压力与民众生活影响。",
        })}
      />,
    );

    expect(screen.getByText("伊朗当前局势深度研究")).toBeInTheDocument();
    expect(
      screen.getByText("梳理国内政治格局与最高领袖权力结构。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("调查核谈判进展与 IAEA 最新信息。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Input:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Research Plan:/)).not.toBeInTheDocument();
  });

  it("starts research through the isolated deep research session action endpoint", async () => {
    render(<DeepResearchPlanCard message={makeMessage()} />);

    fireEvent.click(screen.getByRole("button", { name: /Start research/ }));

    await waitFor(() => {
      expect(mocks.sessionAction).toHaveBeenCalledWith("deep-child-1", {
        action: "start_research",
        planMessageId: "plan-msg-1",
        planInteractionId: "interaction-plan-1",
        input: "Start research",
      });
      expect(mocks.mutateAsync).not.toHaveBeenCalled();
    });
  });

  it("disables plan actions for legacy plans without an isolated session", () => {
    render(
      <DeepResearchPlanCard
        message={makeMessage({
          metadata: {
            deepResearch: {
              kind: "plan",
              interactionId: "interaction-plan-1",
              taskId: "task-1",
            },
          },
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Start research/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Modify plan/ })).toBeDisabled();
  });

  it("can retry the original prompt in the parent channel without Deep Research metadata", async () => {
    render(
      <DeepResearchPlanCard
        message={makeMessage({
          content:
            "**Title:** 中印关系研究\n\n" +
            "**Input:** 1962 年中印战争对中印关系的影响\n\n" +
            "**Research Plan:**\n" +
            "(1) 梳理战争后的外交变化。\n" +
            "(2) 分析边界争议的长期影响。",
          metadata: {
            deepResearch: {
              kind: "plan",
              interactionId: "interaction-plan-1",
              taskId: "task-1",
              session: {
                childChannelId: "deep-child-1",
                parentChannelId: "parent-1",
              },
            },
          },
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Retry without Deep Research/ }),
    );

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith("parent-1", {
        content:
          "Answer this directly without Deep Research: 1962 年中印战争对中印关系的影响",
        metadata: {
          deepResearchBypass: expect.objectContaining({
            source: "team9",
            planMessageId: "plan-msg-1",
            planInteractionId: "interaction-plan-1",
            childChannelId: "deep-child-1",
          }),
        },
      });
      expect(mocks.sendMessage.mock.calls[0]?.[1]?.metadata).not.toHaveProperty(
        "deepResearchRequest",
      );
      expect(mocks.sessionAction).not.toHaveBeenCalled();
      expect(mocks.mutateAsync).not.toHaveBeenCalled();
    });
  });

  it("submits plan-edit instructions through the isolated action endpoint", async () => {
    render(
      <DeepResearchPlanCard message={makeMessage({ parentId: "root-1" })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Modify plan/ }));
    fireEvent.change(
      screen.getByPlaceholderText("Tell me how to adjust the research plan..."),
      {
        target: { value: "重点比较竞品硬件，减少历史背景。" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Submit changes/ }));

    await waitFor(() => {
      expect(mocks.sessionAction).toHaveBeenCalledWith("deep-child-1", {
        action: "modify_plan",
        planMessageId: "plan-msg-1",
        planInteractionId: "interaction-plan-1",
        input: "重点比较竞品硬件，减少历史背景。",
      });
      expect(mocks.mutateAsync).not.toHaveBeenCalled();
    });
  });
});
