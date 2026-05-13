import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Radix DropdownMenu opens from pointer events that jsdom does not reproduce
// with fireEvent.click. Keep this test focused on AgentGroupList's menu wiring.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  }>({ open: false, setOpen: () => {} });

  const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
  };

  const DropdownMenuTrigger = ({
    children,
  }: {
    asChild?: boolean;
    children: React.ReactNode;
  }) => {
    const { open, setOpen } = React.useContext(Ctx);
    if (!React.isValidElement(children)) return <>{children}</>;
    const child = children as React.ReactElement<{
      onClick?: (event: React.MouseEvent) => void;
    }>;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        setOpen(!open);
      },
    });
  };

  const DropdownMenuContent = ({
    children,
  }: {
    align?: string;
    className?: string;
    children: React.ReactNode;
  }) => {
    const { open } = React.useContext(Ctx);
    return open ? <div role="menu">{children}</div> : null;
  };

  const DropdownMenuItem = ({
    children,
    disabled,
    onSelect,
    className,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
    className?: string;
  }) => {
    const { setOpen } = React.useContext(Ctx);
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        className={className}
        onClick={() => {
          onSelect?.();
          setOpen(false);
        }}
      >
        {children}
      </button>
    );
  };

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  };
});

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

function makeRecentSessions(
  count: number,
): TopicSessionGroup["recentSessions"] {
  return Array.from({ length: count }, (_, index) => ({
    channelId: `channel-${index + 1}`,
    sessionId: `session-${index + 1}`,
    title: `Topic ${index + 1}`,
    lastMessageAt: `2026-05-13T00:0${index}:00.000Z`,
    unreadCount: 0,
    createdAt: `2026-05-13T00:0${index}:00.000Z`,
  }));
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

  it("shows a compact more row when an expanded agent has hidden topic sessions", () => {
    const onLoadMoreTopicSessions = vi.fn();

    render(
      <AgentGroupList
        linkPrefix="/channels"
        groups={[
          makeGroup({
            agentUserId: "agent-user-1",
            totalCount: 7,
            recentSessions: makeRecentSessions(5),
          }),
        ]}
        initiallyExpandedAgentUserId="agent-user-1"
        onLoadMoreTopicSessions={onLoadMoreTopicSessions}
      />,
    );

    const loadMore = screen.getByRole("button", {
      name: "More",
    });

    expect(screen.getByText("Topic 1")).toBeInTheDocument();
    expect(loadMore).toBeInTheDocument();
    expect(screen.queryByText("+2")).not.toBeInTheDocument();

    fireEvent.click(loadMore);

    expect(onLoadMoreTopicSessions).toHaveBeenCalledWith("agent-user-1");
  });

  it("archives a topic session from the row action menu", async () => {
    const onArchiveTopicSession = vi.fn();

    render(
      <AgentGroupList
        linkPrefix="/channels"
        groups={[
          makeGroup({
            agentUserId: "agent-user-1",
            totalCount: 1,
            recentSessions: makeRecentSessions(1),
          }),
        ]}
        initiallyExpandedAgentUserId="agent-user-1"
        onArchiveTopicSession={onArchiveTopicSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Topic 1 actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(onArchiveTopicSession).toHaveBeenCalledWith("channel-1"),
    );
  });

  it("opens the same topic session actions from the context menu", async () => {
    const onArchiveTopicSession = vi.fn();

    render(
      <AgentGroupList
        linkPrefix="/channels"
        groups={[
          makeGroup({
            agentUserId: "agent-user-1",
            totalCount: 1,
            recentSessions: makeRecentSessions(1),
          }),
        ]}
        initiallyExpandedAgentUserId="agent-user-1"
        onArchiveTopicSession={onArchiveTopicSession}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Topic 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(onArchiveTopicSession).toHaveBeenCalledWith("channel-1"),
    );
  });

  it("confirms before permanently deleting a topic session", async () => {
    const onDeleteTopicSession = vi.fn();

    render(
      <AgentGroupList
        linkPrefix="/channels"
        groups={[
          makeGroup({
            agentUserId: "agent-user-1",
            totalCount: 1,
            recentSessions: makeRecentSessions(1),
          }),
        ]}
        initiallyExpandedAgentUserId="agent-user-1"
        onDeleteTopicSession={onDeleteTopicSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Topic 1 actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onDeleteTopicSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete topic" }));

    await waitFor(() =>
      expect(onDeleteTopicSession).toHaveBeenCalledWith("channel-1"),
    );
  });
});
