import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { getSeededAvatarGradient } from "@/lib/avatar-colors";
import { ChannelHeader } from "../ChannelHeader";
import { ChannelDetailsModal } from "../ChannelDetailsModal";
import { ThreadReplyIndicator } from "../ThreadReplyIndicator";
import { TrackingCard } from "../TrackingCard";
import type {
  Channel,
  ChannelMember,
  ChannelWithUnread,
  Message,
} from "@/types/im";

const mockUseChannel = vi.fn();
const mockUseChannelMembers = vi.fn();
const mockUseUpdateChannel = vi.fn();
const mockUseLeaveChannel = vi.fn();
const mockUseIsUserOnline = vi.fn();
const mockUseTrackingChannel = vi.fn();
const mockUseUser = vi.fn();
const mockTrackingEventItem = vi.fn();
const mockConsoleError = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      typeof options?.count === "number" ? `${key}:${options.count}` : key,
  }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannel: (...args: unknown[]) => mockUseChannel(...args),
  useChannelMembers: (...args: unknown[]) => mockUseChannelMembers(...args),
  useUpdateChannel: (...args: unknown[]) => mockUseUpdateChannel(...args),
  useLeaveChannel: (...args: unknown[]) => mockUseLeaveChannel(...args),
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: (...args: unknown[]) => mockUseIsUserOnline(...args),
}));

vi.mock("@/hooks/useTrackingChannel", () => ({
  useTrackingChannel: (...args: unknown[]) => mockUseTrackingChannel(...args),
}));

vi.mock("@/stores", async () => {
  const actual = await vi.importActual<typeof import("@/stores")>("@/stores");
  return {
    ...actual,
    useUser: (...args: unknown[]) => mockUseUser(...args),
  };
});

vi.mock("@/components/channel/AddMemberDialog", () => ({
  AddMemberDialog: () => null,
}));

vi.mock("@/components/channel/TrackingEventItem", () => ({
  TrackingEventItem: (props: unknown) => {
    mockTrackingEventItem(props);
    return <div>tracking event</div>;
  },
}));

vi.mock("@/components/channel/TrackingModal", () => ({
  TrackingModal: () => null,
}));

vi.mock("@/components/dialog/DeleteChannelDialog", () => ({
  DeleteChannelDialog: () => null,
}));

class MockImage {
  complete = true;

  naturalWidth = 1;

  src = "";

  referrerPolicy = "";

  crossOrigin: string | null = null;

  addEventListener() {}

  removeEventListener() {}
}

function makeDirectChannel(): ChannelWithUnread {
  return {
    id: "dm-1",
    tenantId: "tenant-1",
    name: "dm",
    type: "direct",
    createdBy: "user-1",
    order: 0,
    isArchived: false,
    isActivated: true,
    unreadCount: 0,
    createdAt: "2026-03-27T12:00:00Z",
    updatedAt: "2026-03-27T12:00:00Z",
    otherUser: {
      id: "user-seeded",
      username: "alice",
      displayName: "Alice Smith",
      avatarUrl: undefined,
      status: "online",
      userType: "bot",
      agentType: "openclaw",
    } as any,
  };
}

function makeHumanDirectChannel(): ChannelWithUnread {
  return {
    ...makeDirectChannel(),
    otherUser: {
      ...makeDirectChannel().otherUser!,
      userType: "human",
      agentType: null,
    },
  };
}

function makeChannel(): Channel {
  return {
    id: "ch-1",
    tenantId: "tenant-1",
    name: "general",
    description: "General",
    type: "public",
    createdBy: "user-1",
    order: 0,
    isArchived: false,
    isActivated: true,
    createdAt: "2026-03-27T12:00:00Z",
    updatedAt: "2026-03-27T12:00:00Z",
  };
}

function makeMember(): ChannelMember {
  return {
    id: "member-1",
    channelId: "ch-1",
    userId: "bot-1",
    role: "member",
    isMuted: false,
    notificationsEnabled: true,
    joinedAt: "2026-03-27T12:00:00Z",
    user: {
      id: "bot-1",
      email: "bot@example.com",
      username: "helper-bot",
      displayName: "Helper Bot",
      avatarUrl: undefined,
      status: "online",
      isActive: true,
      userType: "bot",
      createdAt: "2026-03-27T12:00:00Z",
      updatedAt: "2026-03-27T12:00:00Z",
    },
  };
}

function makeTrackingMessage(): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "bot-1",
    content: "Tracking summary",
    type: "tracking",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-03-27T12:00:00Z",
    updatedAt: "2026-03-27T12:00:00Z",
    sender: {
      id: "bot-1",
      email: "bot@example.com",
      username: "helper-bot",
      displayName: "Helper Bot",
      avatarUrl: undefined,
      status: "online",
      isActive: true,
      userType: "bot",
      createdAt: "2026-03-27T12:00:00Z",
      updatedAt: "2026-03-27T12:00:00Z",
    },
  };
}

describe("seeded avatar channel surfaces", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(console, "error").mockImplementation(mockConsoleError);
    mockUseChannelMembers.mockReturnValue({ data: [] });
    mockUseIsUserOnline.mockReturnValue(false);
    mockUseUpdateChannel.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    mockUseLeaveChannel.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    mockUseTrackingChannel.mockReturnValue({
      isActivated: false,
      latestMessages: [],
      totalMessageCount: 0,
      isLoading: false,
      activeStream: null,
    });
    mockUseUser.mockReturnValue({ id: "user-1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a seeded fallback in ChannelHeader for a DM user without an avatar", () => {
    render(<ChannelHeader channel={makeHumanDirectChannel()} />);

    const fallback = screen.getByText("AS");

    expect(fallback).toHaveClass(getSeededAvatarGradient("user-seeded"));
  });

  it("renders an agent type badge in ChannelHeader for a DM user", () => {
    render(<ChannelHeader channel={makeDirectChannel()} />);

    expect(screen.getByText("Openclaw")).toBeInTheDocument();
  });

  it("renders the bot image in ChannelDetailsModal members when a bot has no avatar", () => {
    mockUseChannel.mockReturnValue({ data: makeChannel() });
    mockUseChannelMembers.mockReturnValue({ data: [makeMember()] });

    render(
      <ChannelDetailsModal
        isOpen
        onClose={() => {}}
        channelId="ch-1"
        defaultTab="members"
      />,
    );

    const image = screen.getByRole("img", { name: "Helper Bot" });

    expect(image).toHaveAttribute("src", "/bot.webp");
    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Missing `Description`"),
    );
  });

  it("renders seeded stacked avatars in ThreadReplyIndicator", () => {
    render(
      <ThreadReplyIndicator
        replyCount={2}
        lastRepliers={[
          {
            id: "user-thread",
            username: "alice",
            displayName: "Alice Smith",
            avatarUrl: null,
            userType: "human",
          },
        ]}
      />,
    );

    const fallback = screen.getByText("AS");

    expect(fallback).toHaveClass(getSeededAvatarGradient("user-thread"));
  });

  it("renders the bot image in TrackingCard when the sender has no avatar", () => {
    render(<TrackingCard message={makeTrackingMessage()} />);

    const image = screen.getByRole("img", { name: "Helper Bot" });

    expect(image).toHaveAttribute("src", "/bot.webp");
  });

  it("falls back to default metadata for an active stream with malformed metadata", () => {
    mockUseTrackingChannel.mockReturnValue({
      isActivated: true,
      latestMessages: [],
      totalMessageCount: 1,
      isLoading: false,
      activeStream: {
        streamId: "stream-1",
        content: "working",
        metadata: { unexpected: true },
      },
    });

    render(<TrackingCard message={makeTrackingMessage()} />);

    expect(mockTrackingEventItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          agentEventType: "writing",
          status: "running",
        },
        content: "working",
        isStreaming: true,
        compact: true,
      }),
    );
  });
});
