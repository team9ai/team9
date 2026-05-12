import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelView } from "../ChannelView";

const viewState = vi.hoisted(() => ({
  channel: {
    id: "channel-1",
    tenantId: "tenant-1",
    type: "direct",
    name: "Agent",
    isArchived: false,
    otherUser: { id: "bot-user-1", userType: "bot" },
  } as any,
  agentSession: {
    data: {
      channelId: "channel-1",
      channelType: "direct",
      kind: "dm",
      supported: true,
      tenantId: "tenant-1",
      agentId: "agent-1",
      botUserId: "bot-user-1",
      sessionId: "session-1",
    },
  } as any,
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@/stores", () => ({
  useUser: () => ({ id: "user-1" }),
}));

vi.mock("@/hooks/useThread", () => ({
  useThreadStore: (selector: (state: unknown) => unknown) =>
    selector({
      primaryThread: { isOpen: false, rootMessageId: null },
      secondaryThread: { isOpen: false, rootMessageId: null },
      openPrimaryThread: vi.fn(),
      closePrimaryThread: vi.fn(),
    }),
}));

vi.mock("@/hooks/useSyncChannel", () => ({
  useSyncChannel: vi.fn(),
}));

vi.mock("@/hooks/useEffectOncePerKey", () => ({
  useEffectOncePerKey: vi.fn(),
}));

vi.mock("@/services/websocket", () => ({
  default: {
    onNewMessage: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannel: () => ({
    data: viewState.channel,
    isLoading: false,
  }),
  useChannelMembers: () => ({ data: [] }),
  useMarkAsRead: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useMessages", () => ({
  useChannelMessages: () => ({
    data: { pages: [{ messages: [] }] },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    fetchPreviousPage: vi.fn(),
  }),
  useSendMessage: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useChannelTabs", () => ({
  useChannelTabs: () => ({ data: [] }),
}));

vi.mock("@/hooks/useChannelViews", () => ({
  useChannelViews: () => ({ data: [] }),
}));

vi.mock("@/hooks/useMessageJump", () => ({
  useMessageJump: () => ({
    jumpToMessage: vi.fn(),
    highlightId: null,
    seq: 0,
  }),
}));

vi.mock("@/hooks/useBotModelSwitch", () => ({
  useBotModelSwitch: () => ({ agentModelFamily: null }),
}));

vi.mock("@/hooks/useChannelModel", () => ({
  useChannelModel: () => ({
    data: null,
    isError: true,
    isUpdating: false,
    updateModel: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOpenClawBotInstanceStatus", () => ({
  useOpenClawBotInstanceStatus: () => ({
    isInstanceStopped: false,
    isInstanceStarting: false,
    isOpenClawBot: false,
    canStart: false,
    startInstance: vi.fn(),
    isStarting: false,
  }),
}));

vi.mock("@/hooks/useBotStartupCountdown", () => ({
  useBotStartupCountdown: () => ({
    phase: "ready",
    remainingSeconds: 0,
    startChatting: vi.fn(),
    showOverlay: false,
  }),
}));

vi.mock("@/hooks/useChannelAgentSession", () => ({
  useChannelAgentSession: () => viewState.agentSession,
}));

vi.mock("@/hooks/useAgentSessionComponents", () => ({
  useAgentSessionComponents: () => ({
    data: { sessionId: "session-1", components: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../agent-session/AgentSessionPanel", () => ({
  AgentSessionPanel: () => <aside>Agent Session Panel</aside>,
}));

vi.mock("../ChannelHeader", () => ({ ChannelHeader: () => <div /> }));
vi.mock("../ChannelTabs", () => ({ ChannelTabs: () => <div /> }));
vi.mock("../ChannelContent", () => ({
  ChannelContent: () => <div data-testid="channel-content" />,
}));
vi.mock("../ThreadPanel", () => ({ ThreadPanel: () => <aside /> }));
vi.mock("../JoinChannelPrompt", () => ({ JoinChannelPrompt: () => null }));
vi.mock("../BotStartupOverlay", () => ({ BotStartupOverlay: () => null }));
vi.mock("../BotInstanceStoppedBanner", () => ({
  BotInstanceStoppedBanner: () => null,
}));
vi.mock("../views/TableView", () => ({ TableView: () => <div /> }));
vi.mock("../views/BoardView", () => ({ BoardView: () => <div /> }));
vi.mock("../views/CalendarView", () => ({ CalendarView: () => <div /> }));
vi.mock("@/services/api/file", () => ({
  fileApi: { getDownloadUrl: vi.fn() },
}));

describe("ChannelView agent session panel", () => {
  beforeEach(() => {
    viewState.channel = {
      id: "channel-1",
      tenantId: "tenant-1",
      type: "direct",
      name: "Agent",
      isArchived: false,
      otherUser: { id: "bot-user-1", userType: "bot" },
    };
    viewState.agentSession = {
      data: {
        channelId: "channel-1",
        channelType: "direct",
        kind: "dm",
        supported: true,
        tenantId: "tenant-1",
        agentId: "agent-1",
        botUserId: "bot-user-1",
        sessionId: "session-1",
      },
    };
  });

  it("renders the session panel for a supported binding", () => {
    render(<ChannelView channelId="channel-1" />);

    expect(screen.getByText("Agent Session Panel")).toBeInTheDocument();
  });

  it("hides no_bot unsupported bindings on ordinary channels", () => {
    viewState.channel = {
      id: "channel-1",
      tenantId: "tenant-1",
      type: "public",
      name: "General",
      isArchived: false,
      otherUser: undefined,
    };
    viewState.agentSession = {
      data: {
        channelId: "channel-1",
        channelType: "public",
        kind: null,
        supported: false,
        unsupportedReason: "no_bot",
        tenantId: "tenant-1",
        agentId: null,
        botUserId: null,
        sessionId: null,
      },
    };

    render(<ChannelView channelId="channel-1" />);

    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();
  });

  it("keeps chat visible when only the agent session panel is open", async () => {
    render(<ChannelView channelId="channel-1" />);

    await waitFor(() =>
      expect(screen.getByText("Agent Session Panel")).toBeInTheDocument(),
    );
    const chatShell = screen.getByTestId("channel-content").closest(".flex-1");
    expect(chatShell?.className).not.toContain("hidden");
  });
});
