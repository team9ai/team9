import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChannelHeader } from "../ChannelHeader";
import type { ChannelWithUnread } from "@/types/im";

const mockUseChannel = vi.fn();
const mockUseChannelMembers = vi.fn();
const mockUseUpdateChannel = vi.fn();
const mockUseLeaveChannel = vi.fn();
const mockUseIsUserOnline = vi.fn();
const mockUseTrackingChannel = vi.fn();
const mockUseUser = vi.fn();

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
  TrackingEventItem: () => null,
}));
vi.mock("@/components/channel/TrackingModal", () => ({
  TrackingModal: () => null,
}));
vi.mock("@/components/dialog/DeleteChannelDialog", () => ({
  DeleteChannelDialog: () => null,
}));

function makeBotDirectChannel(
  overrides: Partial<NonNullable<ChannelWithUnread["otherUser"]>>,
): ChannelWithUnread {
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
    createdAt: "2026-04-07T00:00:00Z",
    updatedAt: "2026-04-07T00:00:00Z",
    otherUser: {
      id: "user-bot",
      username: "claude_bot",
      displayName: "Claude",
      avatarUrl: undefined,
      status: "online",
      userType: "bot",
      agentType: "base_model",
      staffKind: "other",
      ...overrides,
    } as any,
  };
}

describe("ChannelHeader · Model badge placement", () => {
  beforeEach(() => {
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

  it("renders the Model badge below the displayName row for base_model agents", () => {
    render(<ChannelHeader channel={makeBotDirectChannel({})} />);

    const badge = screen.getByText("Model");
    const heading = screen.getByRole("heading", { name: "Claude" });

    // Name lives in Line 1, badge lives in Line 2 — they must not share a row.
    expect(heading.parentElement).not.toBe(badge.parentElement);

    // AgentPillRow for staffKind="other" would render an "agentPillModel"
    // translation key pill — it's suppressed for base_model to avoid
    // duplicating the sky-colored Model badge on the same line.
    expect(screen.queryByText("agentPillModel")).not.toBeInTheDocument();
  });

  it("keeps non-base_model agent badges on the displayName row", () => {
    const channel = makeBotDirectChannel({
      username: "claude_bot",
      agentType: "openclaw",
      staffKind: "other",
    });

    render(<ChannelHeader channel={channel} />);

    const badge = screen.getByText("OpenClaw");
    const heading = screen.getByRole("heading", { name: "Claude" });

    expect(heading.parentElement).toBe(badge.parentElement);
  });

  it("does not render a Model badge when the agent has no agentType", () => {
    const channel = makeBotDirectChannel({
      agentType: null,
      staffKind: null,
    });

    render(<ChannelHeader channel={channel} />);

    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenClaw")).not.toBeInTheDocument();
  });
});
