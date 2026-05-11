import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentGroupList } from "../AgentGroupList";
import type { TopicSessionGroup } from "@/services/api/im";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      _key === "newTopic" ? "新建话题" : (options?.defaultValue ?? _key),
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

function makeGroup(overrides: Partial<TopicSessionGroup>): TopicSessionGroup {
  return {
    agentUserId: "agent-user-1",
    agentId: "agent-1",
    agentDisplayName: "Agent",
    agentAvatarUrl: null,
    legacyDirectChannelId: null,
    totalCount: 0,
    recentSessions: [],
    ...overrides,
  };
}

describe("AgentGroupList", () => {
  it("renders agent metadata labels next to names", () => {
    render(
      <AgentGroupList
        linkPrefix="/channels"
        groups={[
          makeGroup({
            agentUserId: "common-agent",
            agentDisplayName: "Idea Curator",
            agentSubtitle: "Product Manager",
          }),
          makeGroup({
            agentUserId: "openclaw-agent",
            agentDisplayName: "OpenClaw Bot",
            agentSubtitle: "OpenClaw",
          }),
          makeGroup({
            agentUserId: "personal-agent",
            agentDisplayName: "Personal Staff",
            agentSubtitle: "Winrey",
          }),
          makeGroup({
            agentUserId: "model-agent",
            agentDisplayName: "ChatGPT",
            agentSubtitle: "Model",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Product Manager")).toBeInTheDocument();
    expect(screen.getByText("OpenClaw")).toBeInTheDocument();
    expect(screen.getByText("Winrey")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("right-aligns subtitles and overlays the new topic button in the right slot", () => {
    render(
      <AgentGroupList
        linkPrefix="/channels"
        groups={[
          makeGroup({
            agentUserId: "common-agent",
            agentDisplayName: "Idea Curator",
            agentSubtitle: "Product Manager",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Product Manager")).toHaveClass("ml-auto");
    expect(screen.getByRole("button", { name: "新建话题" })).toHaveClass(
      "absolute",
      "right-2",
    );
  });
});
