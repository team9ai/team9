import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import i18n from "@/i18n";
import { BotThinkingIndicator } from "../BotThinkingIndicator";
import type { ChannelMember } from "@/types/im";

// Mock motion/react — framer-motion components are replaced with plain elements.
vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className}>{children}</div>
    ),
    span: ({ children, className }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span className={className}>{children}</span>
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
    it("displays bot name and thinking text when given valid thinkingBotIds and members", () => {
      const members = [makeMember("bot-1")];
      render(
        <BotThinkingIndicator thinkingBotIds={["bot-1"]} members={members} />,
      );

      expect(screen.getByText("Bot bot-1")).toBeInTheDocument();
      // Initial text index is 0 → "Thinking" (en translation of botThinking.texts.thinking)
      expect(screen.getByText("Thinking")).toBeInTheDocument();
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

      // Index 0 → "Thinking"
      expect(screen.getByText("Thinking")).toBeInTheDocument();

      // Advance to index 1 → "Analyzing"
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Analyzing")).toBeInTheDocument();
      expect(screen.queryByText("Thinking")).not.toBeInTheDocument();

      // Advance to index 2 → "Reasoning"
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Reasoning")).toBeInTheDocument();

      // Advance all the way to index 9 (7 more intervals) → "Composing"
      act(() => {
        vi.advanceTimersByTime(3000 * 7);
      });
      expect(screen.getByText("Composing")).toBeInTheDocument();

      // Advance one more → wraps back to index 0 → "Thinking"
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("Thinking")).toBeInTheDocument();
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
      // textIndex should be 3 → "Computing"
      expect(screen.getByText("Computing")).toBeInTheDocument();

      // Change thinkingBotIds — should reset to index 0
      rerender(
        <BotThinkingIndicator thinkingBotIds={["bot-2"]} members={members} />,
      );
      expect(screen.getByText("Thinking")).toBeInTheDocument();
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

      // The first text key is "botThinking.texts.thinking" which resolves to "Thinking" in en
      expect(screen.getByText("Thinking")).toBeInTheDocument();
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
      expect(screen.getByText("Analyzing")).toBeInTheDocument();

      // Set thinkingBotIds to empty — component should stop cycling
      rerender(<BotThinkingIndicator thinkingBotIds={[]} members={members} />);

      // Advance more — no errors and nothing visible
      act(() => {
        vi.advanceTimersByTime(3000 * 5);
      });
      expect(screen.queryByText("Analyzing")).not.toBeInTheDocument();
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
