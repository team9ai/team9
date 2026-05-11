import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import i18n from "@/i18n";
import { BotThinkingIndicator } from "../BotThinkingIndicator";
import type { ChannelMember } from "@/types/im";

// Mock motion/react — framer-motion components are replaced with plain elements.
vi.mock("motion/react", () => ({
  motion: {
    div: ({
      children,
      className,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
    span: ({
      children,
      className,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span className={className} {...props}>
        {children}
      </span>
    ),
  },
  AnimatePresence: ({
    children,
  }: {
    children: React.ReactNode;
    mode?: string;
  }) => <>{children}</>,
}));

function makeMember(
  userId: string,
  overrides: Partial<ChannelMember> = {},
): ChannelMember {
  return {
    id: `member-${userId}`,
    channelId: "ch-1",
    userId,
    role: "member",
    isMuted: false,
    notificationsEnabled: true,
    joinedAt: "2026-01-01T00:00:00Z",
    user: {
      id: userId,
      email: `${userId}@example.com`,
      username: userId,
      displayName: `Bot ${userId}`,
      avatarUrl: undefined,
      status: "online",
      isActive: true,
      userType: "bot",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

beforeEach(async () => {
  if (i18n.language !== "en") {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("BotThinkingIndicator", () => {
  describe("happy path — normal rendering", () => {
    it("displays bot name and warmup text by default when given valid thinkingBotIds and members", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByText("Bot bot-1")).toBeInTheDocument();
      expect(screen.getByText("Warming up")).toBeInTheDocument();
    });

    it("displays working text when the bot is in working phase", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator
          thinkingBotIds={["bot-1"]}
          thinkingStatuses={[{ botId: "bot-1", phase: "working" }]}
          members={members}
        />,
      );

      expect(screen.getByText("Working hard")).toBeInTheDocument();
    });

    it("keeps bot name, dots, and status on a single row", () => {
      const members = [makeMember("bot-1")];
      const { container } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      const row = container.querySelector("[data-testid='bot-thinking-row']");
      expect(row).toBeInTheDocument();
      expect(row).toHaveClass("flex-row");
      expect(row).not.toHaveClass("flex-col");
    });

    it("centers the animated dots within the text line", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      const dots = screen.getByTestId("bot-thinking-dots");
      expect(dots).toHaveClass("h-5");
      expect(dots).toHaveClass("items-center");
      expect(dots).toHaveClass("translate-y-px");
    });

    it("renders warming phase with muted visual treatment", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByTestId("bot-thinking-glow")).toHaveClass(
        "bg-muted-foreground/15",
      );
      expect(screen.getAllByTestId("bot-thinking-dot")[0]).toHaveClass(
        "bg-muted-foreground/45",
      );
      expect(screen.getByTestId("bot-thinking-status")).toHaveClass(
        "text-muted-foreground/75",
      );
    });

    it("renders working phase with active visual treatment", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator
          thinkingBotIds={["bot-1"]}
          thinkingStatuses={[{ botId: "bot-1", phase: "working" }]}
          members={members}
        />,
      );

      expect(screen.getByTestId("bot-thinking-glow")).toHaveClass(
        "bg-primary/20",
      );
      expect(screen.getAllByTestId("bot-thinking-dot")[0]).toHaveClass(
        "bg-primary",
      );
      expect(screen.getByTestId("bot-thinking-status")).toHaveClass(
        "text-muted-foreground",
      );
    });
  });

  describe("bad case — empty thinkingBotIds", () => {
    it("renders nothing when thinkingBotIds is empty", () => {
      const members = [makeMember("bot-1")];
      const { container } = render(
        <BotThinkingIndicator thinkingBotIds={[]} members={members} />,
      );

      // AnimatePresence wraps nothing when isVisible is false
      expect(container.textContent).toBe("");
      expect(screen.queryByText("Bot bot-1")).not.toBeInTheDocument();
    });
  });

  describe("boundary — text cycling", () => {
    it("cycles thinking text every 3000ms and wraps around", () => {
      vi.useFakeTimers();

      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByText("Warming up")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Heading over")).toBeInTheDocument();
      expect(screen.queryByText("Warming up")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Commuting")).toBeInTheDocument();

      // Advance to the final warmup status.
      act(() => {
        vi.advanceTimersByTime(3000 * 2);
      });
      expect(screen.getByText("Getting ready")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Finding signal")).toBeInTheDocument();
    });

    it("cycles working text through the extended status set", () => {
      vi.useFakeTimers();

      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator
          thinkingBotIds={["bot-1"]}
          thinkingStatuses={[{ botId: "bot-1", phase: "working" }]}
          members={members}
        />,
      );

      expect(screen.getByText("Working hard")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000 * 5);
      });
      expect(screen.getByText("Reviewing context")).toBeInTheDocument();
    });

    it("resets textIndex to 0 when thinkingBotIds changes", () => {
      vi.useFakeTimers();

      const members = [makeMember("bot-1"), makeMember("bot-2")];
      const { rerender } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      // Advance a few cycles
      act(() => {
        vi.advanceTimersByTime(3000 * 3);
      });
      expect(screen.getByText("Gathering thoughts")).toBeInTheDocument();

      rerender(
        <BotThinkingIndicator thinkingBotIds={["bot-2"]} members={members} />,
      );
      expect(screen.getByText("Warming up")).toBeInTheDocument();
    });
  });

  describe("bad case — bot not found in members", () => {
    it('displays "Bot" as fallback name when the bot userId is not in members', () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator
          thinkingBotIds={["unknown-bot-id"]}
          members={members}
        />,
      );

      expect(screen.getByText("Bot")).toBeInTheDocument();
    });

    it('displays "Bot" when member exists but userType is not bot', () => {
      const humanMember = makeMember("user-1", {
        user: {
          id: "user-1",
          email: "user@example.com",
          username: "humanuser",
          displayName: "Human User",
          avatarUrl: undefined,
          status: "online",
          isActive: true,
          userType: "human",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      });
      render(
        <BotThinkingIndicator
          thinkingBotIds={["user-1"]}
          members={[humanMember]}
        />,
      );

      // The member lookup requires userType === "bot", so it won't find this member
      expect(screen.getByText("Bot")).toBeInTheDocument();
    });
  });

  describe("i18n — uses t() for thinking texts", () => {
    it("renders the correct English text from i18n translations", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByText("Warming up")).toBeInTheDocument();
    });

    it("uses displayName from the bot user", () => {
      const members = [
        makeMember("bot-1", {
          user: {
            id: "bot-1",
            email: "bot@example.com",
            username: "helperbot",
            displayName: "Helper Bot",
            avatarUrl: undefined,
            status: "online",
            isActive: true,
            userType: "bot",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        }),
      ];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByText("Helper Bot")).toBeInTheDocument();
    });

    it("falls back to username when displayName is not set", () => {
      const members = [
        makeMember("bot-1", {
          user: {
            id: "bot-1",
            email: "bot@example.com",
            username: "helperbot",
            displayName: undefined,
            avatarUrl: undefined,
            status: "online",
            isActive: true,
            userType: "bot",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        }),
      ];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByText("helperbot")).toBeInTheDocument();
    });
  });

  describe("avatar rendering", () => {
    it("uses a compact avatar size so the indicator stays visually one-line", () => {
      const members = [makeMember("bot-1")];
      const { container } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      const avatar = container.querySelector("[data-slot='avatar']");
      expect(avatar).toBeInTheDocument();
      expect(avatar).toHaveClass("w-7");
      expect(avatar).toHaveClass("h-7");
    });

    it("reserves the standard message avatar column without enlarging the avatar", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      const row = screen.getByTestId("bot-thinking-row");
      const avatarSlot = screen.getByTestId("bot-thinking-avatar-slot");

      expect(row).toHaveClass("gap-3");
      expect(avatarSlot).toHaveClass("w-9");
      expect(avatarSlot).toHaveClass("h-9");
      expect(avatarSlot).toHaveClass("items-center");
      expect(avatarSlot).toHaveClass("justify-center");
    });

    it("renders the avatar fallback initial from the bot name", () => {
      const members = [makeMember("bot-1")];
      const { container } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      // Radix Avatar in jsdom only renders fallback (image never loads)
      const fallback = container.querySelector("[data-slot='avatar-fallback']");
      expect(fallback).toBeInTheDocument();
      // "Bot bot-1" → initials = "B"
      expect(fallback).toHaveTextContent("B");
    });

    it("renders the correct initial for a named bot", () => {
      const members = [
        makeMember("bot-1", {
          user: {
            id: "bot-1",
            email: "bot@example.com",
            username: "helperbot",
            displayName: "Helper Bot",
            avatarUrl: "https://example.com/avatar.png",
            status: "online",
            isActive: true,
            userType: "bot",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        }),
      ];
      const { container } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      const fallback = container.querySelector("[data-slot='avatar-fallback']");
      expect(fallback).toBeInTheDocument();
      // "Helper Bot" → initials = "H"
      expect(fallback).toHaveTextContent("H");
    });
  });

  describe("interval cleanup", () => {
    it("clears the interval when thinkingBotIds becomes empty", () => {
      vi.useFakeTimers();

      const members = [makeMember("bot-1")];
      const { rerender } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      // Text cycling is active
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Heading over")).toBeInTheDocument();

      // Set thinkingBotIds to empty — component should stop cycling
      rerender(<BotThinkingIndicator thinkingBotIds={[]} members={members} />);

      // Advance more — no errors and nothing visible
      act(() => {
        vi.advanceTimersByTime(3000 * 5);
      });
      expect(screen.queryByText("Heading over")).not.toBeInTheDocument();
    });

    it("clears the interval on unmount", () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      const members = [makeMember("bot-1")];
      const { unmount } = render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
