import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { IMUser } from "@/types/im";
import type {
  TrackingDeactivatedEvent,
  TrackingActivatedEvent,
} from "@/types/ws-events";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above imports, so any
// variable they reference must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

type WsCallback = (...args: unknown[]) => void;

// Store to capture ChannelContent props so we can invoke callbacks in tests
interface CapturedProps {
  onSend?: (
    payload: { content: string; contentAst?: Record<string, unknown> },
    attachments?: unknown[],
  ) => Promise<void>;
  onLoadMore?: () => void;
  onLoadNewer?: () => void;
}

const {
  mockUseChannelObserver,
  mockUseChannelMessages,
  mockUseSendMessage,
  mockUseSyncChannel,
  mockUseChannelMembers,
  mockWsService,
  trackingDeactivatedListeners,
  trackingActivatedListeners,
  capturedProps,
} = vi.hoisted(() => {
  const trackingDeactivatedListeners: WsCallback[] = [];
  const trackingActivatedListeners: WsCallback[] = [];
  const capturedProps: CapturedProps = {};

  return {
    mockUseChannelObserver: vi.fn(),
    mockUseChannelMessages: vi.fn(),
    mockUseSendMessage: vi.fn(),
    mockUseSyncChannel: vi.fn(),
    mockUseChannelMembers: vi.fn(),
    mockWsService: {
      on: vi.fn(),
      off: vi.fn(),
      onTrackingDeactivated: vi.fn((cb: WsCallback) => {
        trackingDeactivatedListeners.push(cb);
      }),
      offTrackingDeactivated: vi.fn(),
      onTrackingActivated: vi.fn((cb: WsCallback) => {
        trackingActivatedListeners.push(cb);
      }),
      offTrackingActivated: vi.fn(),
    },
    trackingDeactivatedListeners,
    trackingActivatedListeners,
    capturedProps,
  };
});

vi.mock("@/hooks/useChannelObserver", () => ({
  useChannelObserver: (...args: unknown[]) => mockUseChannelObserver(...args),
}));

vi.mock("@/hooks/useMessages", () => ({
  useChannelMessages: (...args: unknown[]) => mockUseChannelMessages(...args),
  useSendMessage: (...args: unknown[]) => mockUseSendMessage(...args),
}));

vi.mock("@/hooks/useSyncChannel", () => ({
  useSyncChannel: (...args: unknown[]) => mockUseSyncChannel(...args),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: (...args: unknown[]) => mockUseChannelMembers(...args),
}));

vi.mock("../ChannelContent", () => ({
  ChannelContent: (props: Record<string, unknown>) => {
    // Capture callback props for invocation in tests
    capturedProps.onSend = props.onSend as CapturedProps["onSend"];
    capturedProps.onLoadMore = props.onLoadMore as CapturedProps["onLoadMore"];
    capturedProps.onLoadNewer =
      props.onLoadNewer as CapturedProps["onLoadNewer"];

    return (
      <div
        data-testid="channel-content"
        data-channel-id={props.channelId}
        data-channel-type={props.channelType}
        data-read-only={props.readOnly ? "true" : "false"}
        data-has-more-unsynced={props.hasMoreUnsynced ? "true" : "false"}
        data-input-placeholder={props.inputPlaceholder ?? ""}
        data-is-send-disabled={props.isSendDisabled ? "true" : "false"}
        data-has-on-send={props.onSend ? "true" : "false"}
      />
    );
  },
}));

vi.mock("@/services/websocket", () => ({
  default: mockWsService,
}));

// Now import the component under test (after mocks are set up)
import { TrackingModal } from "../TrackingModal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBotUser(overrides: Partial<IMUser> = {}): IMUser {
  return {
    id: "bot-1",
    email: "bot@test.com",
    username: "test-bot",
    displayName: "Test Bot",
    status: "online",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultMutateAsync = vi.fn().mockResolvedValue(undefined);

function setupDefaultMocks() {
  mockUseChannelMessages.mockReturnValue({
    data: { pages: [{ messages: [] }] },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    fetchPreviousPage: vi.fn(),
  });

  mockUseSendMessage.mockReturnValue({
    mutateAsync: defaultMutateAsync,
    isPending: false,
  });

  mockUseSyncChannel.mockReturnValue({
    hasMoreUnsynced: false,
  });

  mockUseChannelMembers.mockReturnValue({
    data: [],
  });
}

const BASE_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  trackingChannelId: "tracking-ch-1",
  botUser: makeBotUser(),
  isActivated: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TrackingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackingDeactivatedListeners.length = 0;
    trackingActivatedListeners.length = 0;
    setupDefaultMocks();
  });

  // ── Rendering ───────────────────────────────────────

  it("returns null when isOpen=false", () => {
    const { container } = render(
      <TrackingModal {...BASE_PROPS} isOpen={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders modal with header when open", () => {
    render(<TrackingModal {...BASE_PROPS} />);

    expect(screen.getByText("Test Bot")).toBeInTheDocument();
    expect(screen.getByText("Tracking Channel")).toBeInTheDocument();
  });

  it("renders ChannelContent with trackingChannelId", () => {
    render(<TrackingModal {...BASE_PROPS} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toBeInTheDocument();
    expect(content).toHaveAttribute("data-channel-id", "tracking-ch-1");
    expect(content).toHaveAttribute("data-channel-type", "tracking");
  });

  it("shows loading spinner when messages are loading", () => {
    mockUseChannelMessages.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      hasPreviousPage: false,
      isFetchingPreviousPage: false,
      fetchPreviousPage: vi.fn(),
    });

    render(<TrackingModal {...BASE_PROPS} />);

    expect(screen.getByText("Loading messages...")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-content")).not.toBeInTheDocument();
  });

  // ── useChannelObserver ──────────────────────────────

  it("calls useChannelObserver with trackingChannelId when open", () => {
    render(<TrackingModal {...BASE_PROPS} />);
    expect(mockUseChannelObserver).toHaveBeenCalledWith("tracking-ch-1");
  });

  it("calls useChannelObserver with null when closed", () => {
    render(<TrackingModal {...BASE_PROPS} isOpen={false} />);
    expect(mockUseChannelObserver).toHaveBeenCalledWith(null);
  });

  // ── Running badge ───────────────────────────────────

  it("shows Running badge when isActivated=true", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("does not show Running badge when isActivated=false", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={false} />);
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  // ── readOnly ────────────────────────────────────────

  it("passes readOnly=true to ChannelContent when isActivated=false", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={false} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-read-only", "true");
  });

  it("passes readOnly=false to ChannelContent when isActivated=true", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-read-only", "false");
  });

  // ── Close button ────────────────────────────────────

  it("renders close button that calls onClose", () => {
    const onClose = vi.fn();
    render(<TrackingModal {...BASE_PROPS} onClose={onClose} />);

    const buttons = screen.getAllByRole("button");
    const closeButton = buttons.find((btn) => btn.querySelector("svg"));
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Edge cases ──────────────────────────────────────

  it("renders with undefined trackingChannelId gracefully", () => {
    render(<TrackingModal {...BASE_PROPS} trackingChannelId={undefined} />);

    expect(screen.getByText("Test Bot")).toBeInTheDocument();
    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-channel-id", "");
  });

  it("falls back to username when displayName is missing", () => {
    const botUser = makeBotUser({ displayName: undefined });
    render(<TrackingModal {...BASE_PROPS} botUser={botUser} />);

    expect(screen.getByText("test-bot")).toBeInTheDocument();
  });

  it("shows bot initial in avatar", () => {
    render(<TrackingModal {...BASE_PROPS} />);

    // "T" from "Test Bot"
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("shows 'B' initial when no botUser provided", () => {
    render(<TrackingModal {...BASE_PROPS} botUser={undefined} />);

    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });

  // ── onSend / isSendDisabled ─────────────────────────

  it("passes onSend to ChannelContent when isActivated=true", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-has-on-send", "true");
  });

  it("does not pass onSend to ChannelContent when isActivated=false", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={false} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-has-on-send", "false");
  });

  it("passes inputPlaceholder to ChannelContent", () => {
    render(<TrackingModal {...BASE_PROPS} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute(
      "data-input-placeholder",
      "Send guidance to agent...",
    );
  });

  // ── Tracking WS events ─────────────────────────────

  it("registers tracking WS event listeners when open", () => {
    render(<TrackingModal {...BASE_PROPS} />);

    expect(mockWsService.onTrackingDeactivated).toHaveBeenCalledTimes(1);
    expect(mockWsService.onTrackingActivated).toHaveBeenCalledTimes(1);
  });

  it("does not register tracking WS listeners when closed", () => {
    render(<TrackingModal {...BASE_PROPS} isOpen={false} />);

    expect(mockWsService.onTrackingDeactivated).not.toHaveBeenCalled();
    expect(mockWsService.onTrackingActivated).not.toHaveBeenCalled();
  });

  it("does not register tracking WS listeners when trackingChannelId is undefined", () => {
    render(<TrackingModal {...BASE_PROPS} trackingChannelId={undefined} />);

    expect(mockWsService.onTrackingDeactivated).not.toHaveBeenCalled();
    expect(mockWsService.onTrackingActivated).not.toHaveBeenCalled();
  });

  it("updates isActivated to false on tracking:deactivated event for matching channel", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    act(() => {
      const event: TrackingDeactivatedEvent = {
        channelId: "tracking-ch-1",
        snapshot: { totalMessageCount: 5, latestMessages: [] },
      };
      trackingDeactivatedListeners.forEach((cb) => cb(event));
    });

    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-read-only", "true");
  });

  it("ignores tracking:deactivated event for different channel", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    act(() => {
      const event: TrackingDeactivatedEvent = {
        channelId: "other-channel",
        snapshot: { totalMessageCount: 0, latestMessages: [] },
      };
      trackingDeactivatedListeners.forEach((cb) => cb(event));
    });

    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("updates isActivated to true on tracking:activated event for matching channel", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={false} />);

    expect(screen.queryByText("Running")).not.toBeInTheDocument();

    act(() => {
      const event: TrackingActivatedEvent = {
        channelId: "tracking-ch-1",
      };
      trackingActivatedListeners.forEach((cb) => cb(event));
    });

    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("ignores tracking:activated event for different channel", () => {
    render(<TrackingModal {...BASE_PROPS} isActivated={false} />);

    act(() => {
      const event: TrackingActivatedEvent = {
        channelId: "other-channel",
      };
      trackingActivatedListeners.forEach((cb) => cb(event));
    });

    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("cleans up tracking WS listeners on unmount", () => {
    const { unmount } = render(<TrackingModal {...BASE_PROPS} />);

    unmount();

    expect(mockWsService.offTrackingDeactivated).toHaveBeenCalledTimes(1);
    expect(mockWsService.offTrackingActivated).toHaveBeenCalledTimes(1);
  });

  // ── Hook call arguments ─────────────────────────────

  it("calls useChannelMessages with trackingChannelId when open", () => {
    render(<TrackingModal {...BASE_PROPS} />);
    expect(mockUseChannelMessages).toHaveBeenCalledWith("tracking-ch-1");
  });

  it("calls useChannelMessages with undefined when closed", () => {
    render(<TrackingModal {...BASE_PROPS} isOpen={false} />);
    expect(mockUseChannelMessages).toHaveBeenCalledWith(undefined);
  });

  it("calls useSyncChannel with trackingChannelId when open", () => {
    render(<TrackingModal {...BASE_PROPS} />);
    expect(mockUseSyncChannel).toHaveBeenCalledWith("tracking-ch-1");
  });

  it("calls useSyncChannel with undefined when closed", () => {
    render(<TrackingModal {...BASE_PROPS} isOpen={false} />);
    expect(mockUseSyncChannel).toHaveBeenCalledWith(undefined);
  });

  it("calls useChannelMembers with trackingChannelId when open", () => {
    render(<TrackingModal {...BASE_PROPS} />);
    expect(mockUseChannelMembers).toHaveBeenCalledWith("tracking-ch-1");
  });

  it("calls useChannelMembers with undefined when closed", () => {
    render(<TrackingModal {...BASE_PROPS} isOpen={false} />);
    expect(mockUseChannelMembers).toHaveBeenCalledWith(undefined);
  });

  // ── hasMoreUnsynced ─────────────────────────────────

  it("passes hasMoreUnsynced from useSyncChannel to ChannelContent", () => {
    mockUseSyncChannel.mockReturnValue({ hasMoreUnsynced: true });
    render(<TrackingModal {...BASE_PROPS} />);

    const content = screen.getByTestId("channel-content");
    expect(content).toHaveAttribute("data-has-more-unsynced", "true");
  });

  // ── Syncs isActivated prop ──────────────────────────

  it("syncs internal isActivated state when parent prop changes", () => {
    const { rerender } = render(
      <TrackingModal {...BASE_PROPS} isActivated={true} />,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();

    rerender(<TrackingModal {...BASE_PROPS} isActivated={false} />);
    expect(screen.queryByText("Running")).not.toBeInTheDocument();

    rerender(<TrackingModal {...BASE_PROPS} isActivated={true} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  // ── Messages data edge case ─────────────────────────

  it("handles undefined messagesData gracefully", () => {
    mockUseChannelMessages.mockReturnValue({
      data: undefined,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      hasPreviousPage: false,
      isFetchingPreviousPage: false,
      fetchPreviousPage: vi.fn(),
    });

    render(<TrackingModal {...BASE_PROPS} />);

    // Should render without crashing
    expect(screen.getByTestId("channel-content")).toBeInTheDocument();
  });

  // ── handleSend callback ─────────────────────────────

  it("handleSend calls mutateAsync with content and attachments", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseSendMessage.mockReturnValue({ mutateAsync, isPending: false });

    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    expect(capturedProps.onSend).toBeDefined();
    await act(async () => {
      await capturedProps.onSend!({ content: "hello" }, undefined);
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      content: "hello",
      attachments: undefined,
    });
  });

  it("handleSend skips empty content with no attachments", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseSendMessage.mockReturnValue({ mutateAsync, isPending: false });

    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    await act(async () => {
      await capturedProps.onSend!({ content: "   " }, undefined);
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("handleSend skips whitespace-only content with empty attachments", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseSendMessage.mockReturnValue({ mutateAsync, isPending: false });

    render(<TrackingModal {...BASE_PROPS} isActivated={true} />);

    await act(async () => {
      await capturedProps.onSend!({ content: "" }, []);
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("handleSend skips when trackingChannelId is undefined", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseSendMessage.mockReturnValue({ mutateAsync, isPending: false });

    render(
      <TrackingModal
        {...BASE_PROPS}
        trackingChannelId={undefined}
        isActivated={true}
      />,
    );

    await act(async () => {
      await capturedProps.onSend!({ content: "hello" }, undefined);
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // ── onLoadMore / onLoadNewer ────────────────────────

  it("onLoadMore calls fetchNextPage when hasNextPage is true", () => {
    const fetchNextPage = vi.fn();
    mockUseChannelMessages.mockReturnValue({
      data: { pages: [{ messages: [] }] },
      isFetchingNextPage: false,
      fetchNextPage,
      hasNextPage: true,
      hasPreviousPage: false,
      isFetchingPreviousPage: false,
      fetchPreviousPage: vi.fn(),
    });

    render(<TrackingModal {...BASE_PROPS} />);

    capturedProps.onLoadMore!();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("onLoadMore does not call fetchNextPage when hasNextPage is false", () => {
    const fetchNextPage = vi.fn();
    mockUseChannelMessages.mockReturnValue({
      data: { pages: [{ messages: [] }] },
      isFetchingNextPage: false,
      fetchNextPage,
      hasNextPage: false,
      hasPreviousPage: false,
      isFetchingPreviousPage: false,
      fetchPreviousPage: vi.fn(),
    });

    render(<TrackingModal {...BASE_PROPS} />);

    capturedProps.onLoadMore!();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("onLoadNewer calls fetchPreviousPage when hasPreviousPage is true", () => {
    const fetchPreviousPage = vi.fn();
    mockUseChannelMessages.mockReturnValue({
      data: { pages: [{ messages: [] }] },
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      hasPreviousPage: true,
      isFetchingPreviousPage: false,
      fetchPreviousPage,
    });

    render(<TrackingModal {...BASE_PROPS} />);

    capturedProps.onLoadNewer!();
    expect(fetchPreviousPage).toHaveBeenCalledTimes(1);
  });

  it("onLoadNewer does not call fetchPreviousPage when hasPreviousPage is false", () => {
    const fetchPreviousPage = vi.fn();
    mockUseChannelMessages.mockReturnValue({
      data: { pages: [{ messages: [] }] },
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      hasPreviousPage: false,
      isFetchingPreviousPage: false,
      fetchPreviousPage,
    });

    render(<TrackingModal {...BASE_PROPS} />);

    capturedProps.onLoadNewer!();
    expect(fetchPreviousPage).not.toHaveBeenCalled();
  });
});
