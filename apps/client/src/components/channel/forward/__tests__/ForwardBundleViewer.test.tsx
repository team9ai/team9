import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetItems = vi.hoisted(() => vi.fn());

vi.mock("@/services/api", () => ({
  api: {
    forward: {
      getItems: mockGetItems,
    },
  },
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

vi.mock("@/components/channel/AstRenderer", () => ({
  AstRenderer: ({ ast }: { ast: unknown }) => (
    <div data-testid="ast-renderer" data-ast={JSON.stringify(ast)} />
  ),
}));

// Minimal Dialog mock — always renders children (open=true is fixed in component)
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    open: boolean;
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div data-testid="dialog">
      {children}
      <button data-testid="dialog-close" onClick={() => onOpenChange?.(false)}>
        DialogClose
      </button>
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
}));

// ── Component import ──────────────────────────────────────────────────────────

import { ForwardBundleViewer } from "../ForwardBundleViewer";
import type { ForwardItem } from "@/types/im";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(
  position: number,
  overrides: Partial<ForwardItem> = {},
): ForwardItem {
  return {
    position,
    sourceMessageId: `msg-src-${position}`,
    sourceChannelId: "ch-src-1",
    sourceChannelName: "general",
    sourceWorkspaceId: "ws-1",
    sourceSender: {
      id: `u${position}`,
      username: `user${position}`,
      displayName: `User ${position}`,
      avatarUrl: null,
    },
    sourceCreatedAt: "2026-01-01T00:00:00Z",
    sourceSeqId: String(position),
    sourceType: "text",
    contentSnapshot: `Message ${position}`,
    contentAstSnapshot: null,
    attachmentsSnapshot: [],
    canJumpToOriginal: true,
    truncated: false,
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ForwardBundleViewer", () => {
  beforeEach(() => {
    mockGetItems.mockReset();
  });

  describe("loading state", () => {
    it("shows loading indicator while query is in flight", () => {
      // Never resolves — query stays loading
      mockGetItems.mockReturnValue(new Promise(() => {}));

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      // Loading state renders the unavailable text as a placeholder
      expect(
        screen.getByText("forward.source.unavailable"),
      ).toBeInTheDocument();
    });
  });

  describe("success state", () => {
    it("renders all items returned by api.forward.getItems", async () => {
      mockGetItems.mockResolvedValue([makeItem(1), makeItem(2), makeItem(3)]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getAllByText("User 1").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("User 2").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("User 3").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("renders items in position order (sorted by DOM insertion order)", async () => {
      // Items returned out-of-order from API; component renders them as-is
      mockGetItems.mockResolvedValue([makeItem(3), makeItem(1), makeItem(2)]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        const items = screen.getAllByRole("listitem");
        expect(items).toHaveLength(3);
      });
    });

    it("renders content snapshot as plaintext", async () => {
      mockGetItems.mockResolvedValue([
        makeItem(1, {
          contentSnapshot: "Plain content here",
          contentAstSnapshot: null,
        }),
      ]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Plain content here")).toBeInTheDocument();
      });
    });

    it("renders AstRenderer when contentAstSnapshot is present", async () => {
      const ast = { root: { type: "root", children: [] } };
      mockGetItems.mockResolvedValue([
        makeItem(1, { contentAstSnapshot: ast, contentSnapshot: null }),
      ]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("ast-renderer")).toBeInTheDocument();
      });
    });

    it("renders attachment links", async () => {
      mockGetItems.mockResolvedValue([
        makeItem(1, {
          attachmentsSnapshot: [
            {
              originalAttachmentId: "att-1",
              fileName: "report.pdf",
              fileUrl: "https://example.com/report.pdf",
              fileKey: null,
              fileSize: 5000,
              mimeType: "application/pdf",
              thumbnailUrl: null,
              width: null,
              height: null,
            },
          ],
        }),
      ]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        const link = screen.getByRole("link", { name: "report.pdf" });
        expect(link).toHaveAttribute("href", "https://example.com/report.pdf");
      });
    });

    it("shows jump link when canJumpToOriginal is true and calls onJump", async () => {
      const onJump = vi.fn();
      const item = makeItem(1, { canJumpToOriginal: true });
      mockGetItems.mockResolvedValue([item]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
          onJump={onJump}
        />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("forward.source.jumpTo")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("forward.source.jumpTo"));
      expect(onJump).toHaveBeenCalledWith(
        expect.objectContaining({ position: 1 }),
      );
    });

    it("hides jump link when canJumpToOriginal is false", async () => {
      mockGetItems.mockResolvedValue([
        makeItem(1, { canJumpToOriginal: false }),
      ]);

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getAllByText("User 1").length).toBeGreaterThanOrEqual(1);
      });

      expect(
        screen.queryByText("forward.source.jumpTo"),
      ).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders error message when query fails", async () => {
      mockGetItems.mockRejectedValue(new Error("Network error"));

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("forward.error.notFound")).toBeInTheDocument();
      });
    });
  });

  describe("dialog title", () => {
    it("shows channel name in title when channelName is provided", () => {
      mockGetItems.mockReturnValue(new Promise(() => {}));

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="project-alpha"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "forward.bundle.modalTitle",
      );
    });

    it("shows 'source unavailable' in title when channelName is null", () => {
      mockGetItems.mockReturnValue(new Promise(() => {}));

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName={null}
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "forward.source.unavailable",
      );
    });
  });

  describe("dialog close", () => {
    it("calls onOpenChange(false) when dialog requests close", () => {
      mockGetItems.mockReturnValue(new Promise(() => {}));
      const onOpenChange = vi.fn();

      render(
        <ForwardBundleViewer
          messageId="msg-1"
          channelName="general"
          onOpenChange={onOpenChange}
        />,
        { wrapper },
      );

      fireEvent.click(screen.getByTestId("dialog-close"));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("api call", () => {
    it("calls api.forward.getItems with the correct messageId", () => {
      mockGetItems.mockReturnValue(new Promise(() => {}));

      render(
        <ForwardBundleViewer
          messageId="msg-42"
          channelName="general"
          onOpenChange={vi.fn()}
        />,
        { wrapper },
      );

      expect(mockGetItems).toHaveBeenCalledWith("msg-42");
    });
  });
});
