import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeepResearchPlanCard } from "../DeepResearchPlanCard";
import type { Message } from "@/types/im";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
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
  });

  it("renders a plan-oriented card instead of raw markdown", () => {
    render(<DeepResearchPlanCard message={makeMessage()} />);

    expect(screen.getByText("猜想未来科技与社会趋势")).toBeInTheDocument();
    expect(screen.getByText("研究网站")).toBeInTheDocument();
    expect(screen.getByText("分析结果")).toBeInTheDocument();
    expect(screen.getByText("生成报告")).toBeInTheDocument();
    expect(screen.getByText("修改方案")).toBeInTheDocument();
    expect(screen.getByText("开始研究")).toBeInTheDocument();
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

  it("sends start-research metadata for the approved plan", async () => {
    render(<DeepResearchPlanCard message={makeMessage()} />);

    fireEvent.click(screen.getByRole("button", { name: /开始研究/ }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        content: "开始研究",
        metadata: {
          deepResearchAction: {
            source: "team9",
            action: "start_research",
            planInteractionId: "interaction-plan-1",
            planMessageId: "plan-msg-1",
            taskId: "task-1",
          },
        },
      });
    });
  });

  it("sends modify-plan metadata in the same thread when the plan is a reply", async () => {
    render(
      <DeepResearchPlanCard message={makeMessage({ parentId: "root-1" })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改方案/ }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        content: "修改研究方案",
        parentId: "root-1",
        metadata: {
          deepResearchAction: {
            source: "team9",
            action: "modify_plan",
            planInteractionId: "interaction-plan-1",
            planMessageId: "plan-msg-1",
            taskId: "task-1",
          },
        },
      });
    });
  });
});
