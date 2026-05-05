import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ForwardItem } from "@/types/im";

// react-i18next: pass-through so the test asserts on i18n keys, not English.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

// Stub heavy renderers + avatar so this test stays isolated to ForwardItemBody.
// Use the absolute alias path because that's what the imported component
// resolves to via ../AstRenderer from inside forward/.
vi.mock("@/components/channel/AstRenderer", () => ({
  AstRenderer: ({ ast }: { ast: Record<string, unknown> }) => (
    <div data-testid="ast">{JSON.stringify(ast)}</div>
  ),
}));
vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({
    name,
    username,
  }: {
    name: string | null;
    username: string;
  }) => <span data-testid="avatar">{name ?? username}</span>,
}));

import { ForwardItemBody } from "../ForwardItemBody";

const baseItem: ForwardItem = {
  position: 0,
  sourceMessageId: "msg-1",
  sourceChannelId: "ch-1",
  sourceChannelName: "general",
  sourceWorkspaceId: "ws-1",
  sourceSender: {
    id: "u-1",
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
  },
  sourceCreatedAt: "2026-05-02T10:00:00Z",
  sourceSeqId: "100",
  sourceType: "text",
  contentSnapshot: "hello world",
  contentAstSnapshot: null,
  attachmentsSnapshot: [],
  canJumpToOriginal: true,
  truncated: false,
};

describe("ForwardItemBody", () => {
  it("renders sender display name when present", () => {
    render(<ForwardItemBody item={baseItem} />);
    // Both the avatar mock and the name span print the resolved name.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("falls back to username when displayName is missing", () => {
    render(
      <ForwardItemBody
        item={{
          ...baseItem,
          sourceSender: {
            ...baseItem.sourceSender!,
            displayName: null,
          },
        }}
      />,
    );
    expect(screen.getAllByText("alice").length).toBeGreaterThan(0);
  });

  it("renders '?' when sender is null (deleted user)", () => {
    render(<ForwardItemBody item={{ ...baseItem, sourceSender: null }} />);
    // Avatar receives "" for username; name span renders "?"
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders plaintext content when contentAstSnapshot is null", () => {
    render(<ForwardItemBody item={baseItem} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByTestId("ast")).toBeNull();
  });

  it("delegates to AstRenderer when contentAstSnapshot is non-null", () => {
    render(
      <ForwardItemBody
        item={{
          ...baseItem,
          contentSnapshot: null,
          contentAstSnapshot: { type: "root", children: [] },
        }}
      />,
    );
    expect(screen.getByTestId("ast")).toBeInTheDocument();
  });

  it("renders empty content when contentSnapshot is null and no ast", () => {
    const { container } = render(
      <ForwardItemBody
        item={{ ...baseItem, contentSnapshot: null, contentAstSnapshot: null }}
      />,
    );
    // Just confirms no crash; the rendered span is empty
    expect(container.querySelector(".whitespace-pre-wrap")).toBeInTheDocument();
  });

  it("does not render attachments list when empty", () => {
    const { container } = render(<ForwardItemBody item={baseItem} />);
    expect(container.querySelectorAll("ul")).toHaveLength(0);
  });

  it("renders attachment links with correct href and target", () => {
    render(
      <ForwardItemBody
        item={{
          ...baseItem,
          attachmentsSnapshot: [
            {
              originalAttachmentId: "att-1",
              fileName: "report.pdf",
              fileUrl: "https://files.example.com/report.pdf",
              fileKey: null,
              fileSize: 1024,
              mimeType: "application/pdf",
              thumbnailUrl: null,
              width: null,
              height: null,
            },
          ],
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "report.pdf" });
    expect(link).toHaveAttribute(
      "href",
      "https://files.example.com/report.pdf",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("does not render jump button when showJumpLink is false (default)", () => {
    render(<ForwardItemBody item={baseItem} />);
    expect(screen.queryByText("forward.source.jumpTo")).toBeNull();
  });

  it("does not render jump button when canJumpToOriginal is false", () => {
    render(
      <ForwardItemBody
        showJumpLink
        item={{ ...baseItem, canJumpToOriginal: false }}
      />,
    );
    expect(screen.queryByText("forward.source.jumpTo")).toBeNull();
  });

  it("does not render jump button when sourceMessageId is null", () => {
    render(
      <ForwardItemBody
        showJumpLink
        item={{ ...baseItem, sourceMessageId: null }}
      />,
    );
    expect(screen.queryByText("forward.source.jumpTo")).toBeNull();
  });

  it("renders jump button when showJumpLink + canJumpToOriginal + sourceMessageId all truthy", () => {
    const onJump = vi.fn();
    render(<ForwardItemBody showJumpLink onJump={onJump} item={baseItem} />);
    fireEvent.click(screen.getByText("forward.source.jumpTo"));
    expect(onJump).toHaveBeenCalledWith(baseItem);
  });

  it("jump button click is a no-op when onJump is not provided", () => {
    render(<ForwardItemBody showJumpLink item={baseItem} />);
    // Should not throw
    fireEvent.click(screen.getByText("forward.source.jumpTo"));
  });
});
