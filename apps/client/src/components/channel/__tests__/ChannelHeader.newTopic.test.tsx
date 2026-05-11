import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChannelHeader } from "../ChannelHeader";
import type { ChannelWithUnread } from "@/types/im";

const navigateMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({ data: [] }),
  useUpdateChannel: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: () => false,
}));

vi.mock("../ChannelDetailsModal", () => ({ ChannelDetailsModal: () => null }));
vi.mock("../AddMemberDialog", () => ({ AddMemberDialog: () => null }));

const bot = {
  id: "agent-user-1",
  username: "idea-curator",
  displayName: "Idea Curator",
  userType: "bot" as const,
  status: "online" as const,
  avatarUrl: undefined,
};

function makeChannel(overrides: Partial<ChannelWithUnread>): ChannelWithUnread {
  return {
    id: "chan-1",
    name: "Some topic",
    type: "topic-session",
    otherUser: bot,
    ...overrides,
  } as ChannelWithUnread;
}

describe("ChannelHeader — new topic button", () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it("shows the new-topic button for a topic-session with a bot", () => {
    render(<ChannelHeader channel={makeChannel({})} />);
    const btn = screen.getByLabelText("新建话题");
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/channels",
      search: { agentId: "agent-user-1" },
    });
  });

  it("shows the new-topic button for a direct DM with a bot", () => {
    render(<ChannelHeader channel={makeChannel({ type: "direct" })} />);
    expect(screen.getByLabelText("新建话题")).toBeInTheDocument();
  });

  it("does not show the button for a direct DM with a human user", () => {
    render(
      <ChannelHeader
        channel={makeChannel({
          type: "direct",
          otherUser: { ...bot, userType: "human" as const },
        })}
      />,
    );
    expect(screen.queryByLabelText("新建话题")).not.toBeInTheDocument();
  });

  it("does not show the button for a routine-session", () => {
    render(
      <ChannelHeader channel={makeChannel({ type: "routine-session" })} />,
    );
    expect(screen.queryByLabelText("新建话题")).not.toBeInTheDocument();
  });

  it("does not show the button for a public channel", () => {
    render(
      <ChannelHeader
        channel={makeChannel({ type: "public", otherUser: undefined })}
      />,
    );
    expect(screen.queryByLabelText("新建话题")).not.toBeInTheDocument();
  });
});
