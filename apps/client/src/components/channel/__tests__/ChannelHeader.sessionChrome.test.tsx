import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChannelHeader } from "../ChannelHeader";
import type { ChannelType, ChannelWithUnread } from "@/types/im";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
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
  username: "claude",
  displayName: "Claude",
  userType: "bot" as const,
  status: "online" as const,
  avatarUrl: undefined,
};

function makeChannel(
  type: ChannelType,
  overrides: Partial<ChannelWithUnread> = {},
): ChannelWithUnread {
  return {
    id: "chan-1",
    name: "马斯克动态",
    type,
    otherUser: type === "public" || type === "private" ? undefined : bot,
    ...overrides,
  } as ChannelWithUnread;
}

describe("ChannelHeader — group-management chrome", () => {
  it("renders member count, Invite, and details for a public channel", () => {
    render(<ChannelHeader channel={makeChannel("public")} />);
    expect(screen.getByText("Invite")).toBeInTheDocument();
    expect(screen.getByLabelText("Channel members")).toBeInTheDocument();
    expect(screen.getByLabelText("Channel details")).toBeInTheDocument();
  });

  it.each(["topic-session", "routine-session", "direct"] as const)(
    "hides member count, Invite, and details for a %s channel",
    (type) => {
      render(<ChannelHeader channel={makeChannel(type)} />);
      expect(screen.queryByText("Invite")).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Channel members"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Channel details"),
      ).not.toBeInTheDocument();
    },
  );
});
