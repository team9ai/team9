import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, params?: { count?: number }) =>
      params?.count !== undefined ? `${k}:${params.count}` : k,
  }),
}));

// Lightweight UserAvatar mock — just renders the name so tests can assert it
vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({
    name,
    username,
  }: {
    name?: string | null;
    username?: string;
  }) => <span data-testid="user-avatar">{name ?? username ?? ""}</span>,
}));

import { ForwardPreview } from "../ForwardPreview";
import type { Message, IMUser } from "@/types/im";

function makeMessage(
  id: string,
  content: string,
  sender?: Partial<IMUser>,
): Message {
  return {
    id,
    channelId: "ch1",
    senderId: sender?.id ?? null,
    content,
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sender: sender
      ? ({
          id: sender.id ?? "u1",
          email: sender.email ?? "user@example.com",
          username: sender.username ?? "user",
          displayName: sender.displayName,
          avatarUrl: sender.avatarUrl,
          status: "online",
          isActive: true,
          userType: sender.userType ?? "human",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        } as IMUser)
      : undefined,
  };
}

describe("ForwardPreview", () => {
  describe("single message", () => {
    it("renders sender displayName and message content", () => {
      const msg = makeMessage("m1", "Hello world", {
        id: "u1",
        username: "alice",
        displayName: "Alice",
      });

      render(<ForwardPreview messages={[msg]} />);

      // "Alice" appears in both the avatar mock and the name span
      const aliceElements = screen.getAllByText("Alice");
      expect(aliceElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("falls back to username when displayName is not set", () => {
      const msg = makeMessage("m1", "Hi there", {
        id: "u1",
        username: "bob",
        displayName: undefined,
      });

      render(<ForwardPreview messages={[msg]} />);

      const bobElements = screen.getAllByText("bob");
      expect(bobElements.length).toBeGreaterThanOrEqual(1);
    });

    it("renders message content when sender is undefined", () => {
      const msg = makeMessage("m1", "System message");

      render(<ForwardPreview messages={[msg]} />);

      expect(screen.getByText("System message")).toBeInTheDocument();
    });
  });

  describe("bundle preview (multiple messages)", () => {
    it("renders bundle title with count", () => {
      const msgs = [
        makeMessage("m1", "First", { id: "u1", displayName: "Alice" }),
        makeMessage("m2", "Second", { id: "u2", displayName: "Bob" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      expect(screen.getByText("forward.bundle.title:2")).toBeInTheDocument();
    });

    it("renders up to 3 messages in the preview list", () => {
      const msgs = [
        makeMessage("m1", "First", { id: "u1", displayName: "Alice" }),
        makeMessage("m2", "Second", { id: "u2", displayName: "Bob" }),
        makeMessage("m3", "Third", { id: "u3", displayName: "Carol" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      // Each name appears in both the avatar span and the font-medium span
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Carol").length).toBeGreaterThanOrEqual(1);
    });

    it("shows the '…viewAll' indicator when count > 3", () => {
      const msgs = [
        makeMessage("m1", "First", { id: "u1", displayName: "Alice" }),
        makeMessage("m2", "Second", { id: "u2", displayName: "Bob" }),
        makeMessage("m3", "Third", { id: "u3", displayName: "Carol" }),
        makeMessage("m4", "Fourth", { id: "u4", displayName: "Dave" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      // Only first 3 senders visible in the list
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Carol").length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText("Dave")).not.toBeInTheDocument();

      // "…View all" indicator
      expect(screen.getByText(/forward\.bundle\.viewAll/)).toBeInTheDocument();
    });

    it("does NOT show the '…viewAll' indicator when count === 3", () => {
      const msgs = [
        makeMessage("m1", "First", { id: "u1", displayName: "Alice" }),
        makeMessage("m2", "Second", { id: "u2", displayName: "Bob" }),
        makeMessage("m3", "Third", { id: "u3", displayName: "Carol" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      expect(
        screen.queryByText(/forward\.bundle\.viewAll/),
      ).not.toBeInTheDocument();
    });

    it("does NOT show the '…viewAll' indicator when count === 2", () => {
      const msgs = [
        makeMessage("m1", "First", { id: "u1", displayName: "Alice" }),
        makeMessage("m2", "Second", { id: "u2", displayName: "Bob" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      expect(
        screen.queryByText(/forward\.bundle\.viewAll/),
      ).not.toBeInTheDocument();
    });

    it("truncates content to 80 chars in the list", () => {
      const longContent = "a".repeat(100);
      const msg = makeMessage("m1", longContent, {
        id: "u1",
        displayName: "Alice",
      });
      const msgs = [
        msg,
        makeMessage("m2", "Short", { id: "u2", displayName: "Bob" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      expect(screen.getByText("a".repeat(80))).toBeInTheDocument();
    });

    it("renders empty string for null/undefined content in bundle", () => {
      const msg = makeMessage("m1", "", { id: "u1", displayName: "Alice" });
      // Override content to null-like value
      msg.content = null as unknown as string;
      const msgs = [
        msg,
        makeMessage("m2", "Other", { id: "u2", displayName: "Bob" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      // No crash — component uses optional chain + ?? ""
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to username in bundle when displayName is not set", () => {
      const msgs = [
        makeMessage("m1", "Hello", {
          id: "u1",
          username: "bob",
          displayName: undefined,
        }),
        makeMessage("m2", "World", { id: "u2", displayName: "Carol" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      // "bob" appears in both avatar mock and name span
      expect(screen.getAllByText("bob").length).toBeGreaterThanOrEqual(1);
    });

    it("renders bundle with sender that has no sender object", () => {
      // Cover m.sender?.displayName ?? null when sender is undefined
      const msgs = [
        makeMessage("m1", "Hello"),
        makeMessage("m2", "World", { id: "u2", displayName: "Carol" }),
      ];

      render(<ForwardPreview messages={msgs} />);

      // Second sender's name is shown
      expect(screen.getAllByText("Carol").length).toBeGreaterThanOrEqual(1);
    });
  });
});
