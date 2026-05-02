import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, params?: Record<string, unknown>) => {
      if (params && Object.keys(params).length > 0) {
        return `${k}:${JSON.stringify(params)}`;
      }
      return k;
    },
  }),
}));

vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({
    name,
    username,
  }: {
    name?: string | null;
    username?: string | null;
  }) => <span data-testid="user-avatar">{name ?? username ?? ""}</span>,
}));

// Mock AstRenderer so tests don't need full Lexical setup.
// Use the absolute alias path so the mock intercepts the import in ForwardItemBody
// (which lives one level up from this test file and imports "../AstRenderer").
vi.mock("@/components/channel/AstRenderer", () => ({
  AstRenderer: ({ ast }: { ast: unknown }) => (
    <div data-testid="ast-renderer" data-ast={JSON.stringify(ast)} />
  ),
}));

// Mock ForwardBundleViewer to isolate ForwardedMessageCard behaviour.
// Exposes an "onJump" trigger button so tests can exercise the jumpToOriginal callback.
vi.mock("../ForwardBundleViewer", () => ({
  ForwardBundleViewer: ({
    messageId,
    channelName,
    onOpenChange,
    onJump,
  }: {
    messageId: string;
    channelName: string | null;
    onOpenChange: (v: boolean) => void;
    onJump?: (item: unknown) => void;
  }) => (
    <div
      data-testid="bundle-viewer"
      data-message-id={messageId}
      data-channel-name={channelName ?? "null"}
    >
      <button onClick={() => onOpenChange(false)}>Close</button>
      {onJump && (
        <button
          data-testid="trigger-jump-null"
          onClick={() =>
            onJump({
              position: 1,
              sourceMessageId: null,
              sourceChannelId: "ch-src-1",
              canJumpToOriginal: true,
              contentSnapshot: null,
              contentAstSnapshot: null,
              attachmentsSnapshot: [],
              sourceCreatedAt: "2026-01-01T00:00:00Z",
              sourceType: "text",
              sourceSender: null,
              sourceChannelName: null,
              sourceWorkspaceId: null,
              sourceSeqId: null,
              truncated: false,
            })
          }
        >
          TriggerJumpNull
        </button>
      )}
    </div>
  ),
}));

// ── Component + type imports (after mocks) ────────────────────────────────────

import { ForwardedMessageCard } from "../ForwardedMessageCard";
import type { Message, ForwardPayload, ForwardItem } from "@/types/im";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeForwardItem(overrides: Partial<ForwardItem> = {}): ForwardItem {
  return {
    position: 1,
    sourceMessageId: "msg-src-1",
    sourceChannelId: "ch-src-1",
    sourceChannelName: "general",
    sourceWorkspaceId: "ws-1",
    sourceSender: {
      id: "u1",
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
    },
    sourceCreatedAt: "2026-01-01T00:00:00Z",
    sourceSeqId: "1",
    sourceType: "text",
    contentSnapshot: "Hello world",
    contentAstSnapshot: null,
    attachmentsSnapshot: [],
    canJumpToOriginal: true,
    truncated: false,
    ...overrides,
  };
}

function makeMessage(
  fwd?: ForwardPayload,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "u1",
    content: "",
    type: "forward",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    forward: fwd,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ForwardedMessageCard", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  describe("no forward payload", () => {
    it("returns null when message.forward is undefined", () => {
      const { container } = render(
        <ForwardedMessageCard message={makeMessage(undefined)} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("single forward", () => {
    it("renders 'forwarded from channel' header", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [makeForwardItem()],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(
        screen.getByText(/forward\.card\.fromChannel/),
      ).toBeInTheDocument();
    });

    it("renders 'source unavailable' header when channelName is null", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: null,
        truncated: false,
        items: [makeForwardItem()],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(
        screen.getByText("forward.source.unavailable"),
      ).toBeInTheDocument();
    });

    it("renders sender name and content from item", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [makeForwardItem({ contentSnapshot: "Test message content" })],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      // "Alice" appears in user-avatar mock and in the name span
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Test message content")).toBeInTheDocument();
    });

    it("renders AstRenderer when contentAstSnapshot is non-null", () => {
      const ast = { root: { type: "root", children: [] } };
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({ contentAstSnapshot: ast, contentSnapshot: null }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(screen.getByTestId("ast-renderer")).toBeInTheDocument();
    });

    it("shows jump link when canJumpToOriginal is true", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [makeForwardItem({ canJumpToOriginal: true })],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(screen.getByText("forward.source.jumpTo")).toBeInTheDocument();
    });

    it("hides jump link when canJumpToOriginal is false", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [makeForwardItem({ canJumpToOriginal: false })],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(
        screen.queryByText("forward.source.jumpTo"),
      ).not.toBeInTheDocument();
    });

    it("hides jump link when sourceMessageId is null", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({ canJumpToOriginal: true, sourceMessageId: null }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(
        screen.queryByText("forward.source.jumpTo"),
      ).not.toBeInTheDocument();
    });

    it("calls navigate with correct params when jump button is clicked", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            canJumpToOriginal: true,
            sourceMessageId: "msg-src-1",
            sourceChannelId: "ch-src-1",
          }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      fireEvent.click(screen.getByText("forward.source.jumpTo"));
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/channels/$channelId",
        params: { channelId: "ch-src-1" },
        search: { message: "msg-src-1" },
      });
    });

    it("returns null defensively when single forward has empty items array", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [],
      };
      const { container } = render(
        <ForwardedMessageCard message={makeMessage(fwd)} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders attachment links when attachmentsSnapshot is non-empty", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            attachmentsSnapshot: [
              {
                originalAttachmentId: "att-1",
                fileName: "document.pdf",
                fileUrl: "https://example.com/document.pdf",
                fileKey: "key-1",
                fileSize: 12345,
                mimeType: "application/pdf",
                thumbnailUrl: null,
                width: null,
                height: null,
              },
            ],
          }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      const link = screen.getByRole("link", { name: "document.pdf" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "https://example.com/document.pdf");
    });

    it("renders plaintext fallback when contentAstSnapshot is null", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            contentAstSnapshot: null,
            contentSnapshot: "Plain text content",
          }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(screen.getByText("Plain text content")).toBeInTheDocument();
      expect(screen.queryByTestId("ast-renderer")).not.toBeInTheDocument();
    });

    it("renders empty string when both snapshot fields are null", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            contentAstSnapshot: null,
            contentSnapshot: null,
          }),
        ],
      };
      // Should not throw
      const { container } = render(
        <ForwardedMessageCard message={makeMessage(fwd)} />,
      );
      expect(container).toBeTruthy();
    });

    it("falls back to username when sourceSender has no displayName", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            sourceSender: {
              id: "u2",
              username: "bob",
              displayName: null,
              avatarUrl: null,
            },
          }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(screen.getAllByText("bob").length).toBeGreaterThanOrEqual(1);
    });

    it("renders '?' when sourceSender is null", () => {
      const fwd: ForwardPayload = {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [makeForwardItem({ sourceSender: null })],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      // Should not throw — "?" is rendered
      expect(screen.getAllByText("?").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("bundle forward", () => {
    function makeBundleFwd(
      count: number,
      items?: Partial<ForwardItem>[],
    ): ForwardPayload {
      const itemList = (
        items ?? [{ position: 1 }, { position: 2 }, { position: 3 }]
      ).map((overrides, i) =>
        makeForwardItem({
          position: i + 1,
          contentSnapshot: `Message ${i + 1}`,
          sourceSender: {
            id: `u${i + 1}`,
            username: `user${i + 1}`,
            displayName: `User ${i + 1}`,
            avatarUrl: null,
          },
          ...overrides,
        }),
      );
      return {
        kind: "bundle",
        count,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: itemList,
      };
    }

    it("renders bundle title with count", () => {
      render(<ForwardedMessageCard message={makeMessage(makeBundleFwd(3))} />);
      expect(screen.getByText(/forward\.bundle\.title/)).toBeInTheDocument();
    });

    it("renders up to 3 preview rows", () => {
      const fwd = makeBundleFwd(3);
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(screen.getAllByText("User 1").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("User 2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("User 3").length).toBeGreaterThanOrEqual(1);
    });

    it("shows 'View all' indicator when count > 3", () => {
      // 4 items in payload but only 3 are in items array (matching real API behaviour
      // where items is a preview subset); count=4 makes count > previews.length
      const fwd: ForwardPayload = {
        kind: "bundle",
        count: 4,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            position: 1,
            sourceSender: {
              id: "u1",
              username: "u1",
              displayName: "User 1",
              avatarUrl: null,
            },
          }),
          makeForwardItem({
            position: 2,
            sourceSender: {
              id: "u2",
              username: "u2",
              displayName: "User 2",
              avatarUrl: null,
            },
          }),
          makeForwardItem({
            position: 3,
            sourceSender: {
              id: "u3",
              username: "u3",
              displayName: "User 3",
              avatarUrl: null,
            },
          }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(screen.getByText("forward.bundle.viewAll")).toBeInTheDocument();
    });

    it("does NOT show 'View all' when count <= previews.length", () => {
      render(<ForwardedMessageCard message={makeMessage(makeBundleFwd(3))} />);
      expect(
        screen.queryByText("forward.bundle.viewAll"),
      ).not.toBeInTheDocument();
    });

    it("opens ForwardBundleViewer when the card is clicked", () => {
      render(<ForwardedMessageCard message={makeMessage(makeBundleFwd(3))} />);
      expect(screen.queryByTestId("bundle-viewer")).not.toBeInTheDocument();
      // The bundle button contains title text
      const button = screen.getByRole("button");
      fireEvent.click(button);
      expect(screen.getByTestId("bundle-viewer")).toBeInTheDocument();
    });

    it("passes messageId and channelName to ForwardBundleViewer", () => {
      const msg = makeMessage(makeBundleFwd(3));
      render(<ForwardedMessageCard message={msg} />);
      fireEvent.click(screen.getByRole("button"));
      const viewer = screen.getByTestId("bundle-viewer");
      expect(viewer).toHaveAttribute("data-message-id", "msg-1");
      expect(viewer).toHaveAttribute("data-channel-name", "general");
    });

    it("closes viewer when onOpenChange(false) is called", () => {
      render(<ForwardedMessageCard message={makeMessage(makeBundleFwd(3))} />);
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("bundle-viewer")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Close"));
      expect(screen.queryByTestId("bundle-viewer")).not.toBeInTheDocument();
    });

    it("renders 'source unavailable' header when sourceChannelName is null in bundle", () => {
      const fwd: ForwardPayload = {
        kind: "bundle",
        count: 2,
        sourceChannelId: "ch-src-1",
        sourceChannelName: null,
        truncated: false,
        items: [
          makeForwardItem({ position: 1 }),
          makeForwardItem({ position: 2 }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      expect(
        screen.getByText("forward.source.unavailable"),
      ).toBeInTheDocument();
    });

    it("passes null channelName to viewer when sourceChannelName is null", () => {
      const fwd: ForwardPayload = {
        kind: "bundle",
        count: 2,
        sourceChannelId: "ch-src-1",
        sourceChannelName: null,
        truncated: false,
        items: [
          makeForwardItem({ position: 1 }),
          makeForwardItem({ position: 2 }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("bundle-viewer")).toHaveAttribute(
        "data-channel-name",
        "null",
      );
    });

    it("jumpToOriginal does nothing when sourceMessageId is null (via onJump callback)", () => {
      render(<ForwardedMessageCard message={makeMessage(makeBundleFwd(3))} />);
      fireEvent.click(
        screen.getByRole("button", { name: /forward\.bundle\.title/ }),
      );
      // Trigger onJump with a null sourceMessageId — navigate should NOT be called
      fireEvent.click(screen.getByTestId("trigger-jump-null"));
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("renders bundle preview rows with null sourceSender gracefully", () => {
      const fwd: ForwardPayload = {
        kind: "bundle",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [
          makeForwardItem({
            position: 1,
            sourceSender: null,
            contentSnapshot: "hi",
          }),
        ],
      };
      render(<ForwardedMessageCard message={makeMessage(fwd)} />);
      // Should render without crash; "?" appears as fallback
      expect(screen.getAllByText("?").length).toBeGreaterThanOrEqual(1);
    });

    it("renders empty string in bundle preview when contentSnapshot is null", () => {
      const fwd: ForwardPayload = {
        kind: "bundle",
        count: 1,
        sourceChannelId: "ch-src-1",
        sourceChannelName: "general",
        truncated: false,
        items: [makeForwardItem({ position: 1, contentSnapshot: null })],
      };
      // Should not throw — contentSnapshot?.slice(0, 80) ?? "" handles null
      const { container } = render(
        <ForwardedMessageCard message={makeMessage(fwd)} />,
      );
      expect(container).toBeTruthy();
    });
  });
});
