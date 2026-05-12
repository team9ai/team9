import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  recoverLatestMessages: vi.fn(),
  sendMessageMutateAsync: vi.fn(),
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
    recoverLatestMessages: viewState.recoverLatestMessages,
  }),
  useSendMessage: () => ({ mutateAsync: viewState.sendMessageMutateAsync }),
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
  useChannelAgentSession: (_channelId: string, enabled: boolean) =>
    enabled ? viewState.agentSession : { data: undefined },
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

vi.mock("../ChannelHeader", () => ({
  ChannelHeader: ({
    showAgentSessionToggle,
    isAgentSessionPanelOpen,
    onToggleAgentSessionPanel,
  }: {
    showAgentSessionToggle?: boolean;
    isAgentSessionPanelOpen?: boolean;
    onToggleAgentSessionPanel?: () => void;
  }) => (
    <div>
      {showAgentSessionToggle && (
        <button
          type="button"
          aria-label={
            isAgentSessionPanelOpen
              ? "Hide agent session panel"
              : "Show agent session panel"
          }
          onClick={onToggleAgentSessionPanel}
        >
          Agent Session Toggle
        </button>
      )}
    </div>
  ),
}));
vi.mock("../ChannelTabs", () => ({ ChannelTabs: () => <div /> }));
vi.mock("../ChannelContent", () => ({
  ChannelContent: ({
    onSend,
  }: {
    onSend?: (payload: { content: string }) => Promise<void>;
  }) => (
    <div data-testid="channel-content">
      <button type="button" onClick={() => void onSend?.({ content: "ping" })}>
        Send test message
      </button>
    </div>
  ),
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
    vi.useRealTimers();
    viewState.recoverLatestMessages = vi.fn().mockResolvedValue(undefined);
    viewState.sendMessageMutateAsync = vi.fn().mockResolvedValue(undefined);
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

  it("keeps the session panel collapsed until the header toggle is clicked", () => {
    render(<ChannelView channelId="channel-1" />);

    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show agent session panel" }),
    );

    expect(screen.getByText("Agent Session Panel")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide agent session panel" }),
    );

    expect(screen.queryByText("Agent Session Panel")).not.toBeInTheDocument();
  });

  it("requests the session binding for topic-session channels even before otherUser is hydrated", () => {
    viewState.channel = {
      id: "topic-1",
      tenantId: "tenant-1",
      type: "topic-session",
      name: "Topic",
      isArchived: false,
      otherUser: undefined,
    };
    viewState.agentSession = {
      data: {
        channelId: "topic-1",
        channelType: "topic-session",
        kind: "topic-session",
        supported: true,
        tenantId: "tenant-1",
        agentId: "agent-1",
        botUserId: "bot-user-1",
        sessionId: "team9/tenant-1/agent-1/dm/topic-1",
      },
    };

    render(<ChannelView channelId="topic-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Show agent session panel" }),
    );

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
    fireEvent.click(
      screen.getByRole("button", { name: "Show agent session panel" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Agent Session Panel")).toBeInTheDocument(),
    );
    const chatShell = screen.getByTestId("channel-content").closest(".flex-1");
    expect(chatShell?.className).not.toContain("hidden");
  });

  it("recovers latest messages while waiting for a bot reply so missed websocket pushes recover", async () => {
    vi.useFakeTimers();

    render(<ChannelView channelId="channel-1" />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Send test message" }),
      );
      await Promise.resolve();
    });

    expect(viewState.sendMessageMutateAsync).toHaveBeenCalled();
    expect(viewState.recoverLatestMessages).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(viewState.recoverLatestMessages).toHaveBeenCalledTimes(1);
  });

  it("does not overlap recovery requests on slow networks", async () => {
    vi.useFakeTimers();
    let resolveRecovery: (() => void) | undefined;
    viewState.recoverLatestMessages = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );

    render(<ChannelView channelId="channel-1" />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Send test message" }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    expect(viewState.recoverLatestMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRecovery?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(viewState.recoverLatestMessages).toHaveBeenCalledTimes(2);
  });

  it("stops recovery polling after bounded attempts", async () => {
    vi.useFakeTimers();

    render(<ChannelView channelId="channel-1" />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Send test message" }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000);
    });

    expect(viewState.recoverLatestMessages).toHaveBeenCalledTimes(40);
  });
});
