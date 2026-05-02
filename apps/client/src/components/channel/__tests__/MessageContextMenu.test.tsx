import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Message } from "@/types/im";
import { MessageContextMenu } from "../MessageContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: (_ns?: string) => ({ t: (key: string) => key }),
}));

// Radix ContextMenu portals to document.body. We need to open it before we can
// query menu items. Use `fireEvent.contextMenu` on the trigger element.

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    content: "hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-04-25T12:00:00Z",
    updatedAt: "2026-04-25T12:00:00Z",
    ...overrides,
  };
}

function renderMenu(
  props: Partial<Parameters<typeof MessageContextMenu>[0]> = {},
) {
  const defaultProps = {
    message: makeMessage(),
    isOwnMessage: false,
    children: <div data-testid="trigger">Message</div>,
  };
  return render(<MessageContextMenu {...defaultProps} {...props} />);
}

function openMenu() {
  const trigger = screen.getByTestId("trigger");
  fireEvent.contextMenu(trigger);
}

// ---------------------------------------------------------------------------
// Forward + Select visibility
// ---------------------------------------------------------------------------

describe("MessageContextMenu — forward + select wiring", () => {
  it("renders Forward and Select items when forwardable=true and handlers provided", () => {
    renderMenu({ forwardable: true, onForward: vi.fn(), onSelect: vi.fn() });
    openMenu();

    // Radix portals to document.body — use queryAllBy scoped to body
    expect(
      screen.getByRole("menuitem", { name: /forward\.contextMenu\.forward/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /forward\.contextMenu\.select/i }),
    ).toBeInTheDocument();
  });

  it("hides Forward and Select items when forwardable=false", () => {
    renderMenu({ forwardable: false, onForward: vi.fn(), onSelect: vi.fn() });
    openMenu();

    expect(
      screen.queryByRole("menuitem", {
        name: /forward\.contextMenu\.forward/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /forward\.contextMenu\.select/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Forward item when handler not provided even with forwardable=true", () => {
    renderMenu({ forwardable: true, onForward: undefined, onSelect: vi.fn() });
    openMenu();

    expect(
      screen.queryByRole("menuitem", {
        name: /forward\.contextMenu\.forward/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /forward\.contextMenu\.select/i }),
    ).toBeInTheDocument();
  });

  it("hides Select item when handler not provided even with forwardable=true", () => {
    renderMenu({ forwardable: true, onForward: vi.fn(), onSelect: undefined });
    openMenu();

    expect(
      screen.getByRole("menuitem", { name: /forward\.contextMenu\.forward/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /forward\.contextMenu\.select/i }),
    ).not.toBeInTheDocument();
  });

  it("hides both items when forwardable is undefined (default)", () => {
    renderMenu({ onForward: vi.fn(), onSelect: vi.fn() });
    openMenu();

    expect(
      screen.queryByRole("menuitem", {
        name: /forward\.contextMenu\.forward/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /forward\.contextMenu\.select/i }),
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Click handlers
  // ---------------------------------------------------------------------------

  it("calls onForward when Forward item is clicked", () => {
    const onForward = vi.fn();
    renderMenu({ forwardable: true, onForward, onSelect: vi.fn() });
    openMenu();

    fireEvent.click(
      screen.getByRole("menuitem", { name: /forward\.contextMenu\.forward/i }),
    );

    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect when Select item is clicked", () => {
    const onSelect = vi.fn();
    renderMenu({ forwardable: true, onForward: vi.fn(), onSelect });
    openMenu();

    fireEvent.click(
      screen.getByRole("menuitem", { name: /forward\.contextMenu\.select/i }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Existing items are not broken
  // ---------------------------------------------------------------------------

  it("still renders Copy Link item", () => {
    renderMenu();
    openMenu();

    expect(
      screen.getByRole("menuitem", { name: /copyLink/i }),
    ).toBeInTheDocument();
  });

  it("still renders Reply in thread item when handler provided", () => {
    renderMenu({ onReplyInThread: vi.fn() });
    openMenu();

    expect(
      screen.getByRole("menuitem", { name: /replyInThread/i }),
    ).toBeInTheDocument();
  });
});
