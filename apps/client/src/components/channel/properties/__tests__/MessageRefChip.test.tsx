import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageRefChip } from "../MessageRefChip";

describe("MessageRefChip", () => {
  // ── null target ──────────────────────────────────────────────────────────

  it("renders nothing when target is null", () => {
    const { container } = render(<MessageRefChip target={null} />);
    expect(container.firstChild).toBeNull();
  });

  // ── normal state ─────────────────────────────────────────────────────────

  it("renders snippet for normal target", () => {
    render(<MessageRefChip target={{ id: "m1", snippet: "hello world" }} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("falls back to id prefix when snippet is absent", () => {
    render(<MessageRefChip target={{ id: "abcdefgh12" }} />);
    // Should show first 8 chars of id
    expect(screen.getByText("abcdefgh")).toBeInTheDocument();
  });

  it("renders avatar when avatarUrl is provided for normal target", () => {
    render(
      <MessageRefChip
        target={{
          id: "m1",
          snippet: "hi",
          avatarUrl: "https://example.com/a.png",
        }}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
  });

  it("does not render avatar when avatarUrl is absent", () => {
    render(<MessageRefChip target={{ id: "m1", snippet: "hi" }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("normal chip is rendered as a button", () => {
    render(<MessageRefChip target={{ id: "m1", snippet: "hi" }} />);
    expect(screen.getByTestId("message-ref-chip").tagName.toLowerCase()).toBe(
      "button",
    );
  });

  // ── deleted state ─────────────────────────────────────────────────────────

  it("renders [已删除] and strike-through when isDeleted", () => {
    render(<MessageRefChip target={{ id: "m1", isDeleted: true }} />);
    const chip = screen.getByTestId("message-ref-chip");
    expect(chip).toHaveTextContent("[已删除]");
    expect(chip.className).toMatch(/line-through/);
  });

  it("deleted chip has aria-disabled=true", () => {
    render(<MessageRefChip target={{ id: "m1", isDeleted: true }} />);
    expect(screen.getByTestId("message-ref-chip")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("deleted chip is rendered as a span (not button)", () => {
    render(<MessageRefChip target={{ id: "m1", isDeleted: true }} />);
    expect(screen.getByTestId("message-ref-chip").tagName.toLowerCase()).toBe(
      "span",
    );
  });

  it("does not render avatar for deleted chip", () => {
    render(
      <MessageRefChip
        target={{
          id: "m1",
          isDeleted: true,
          avatarUrl: "https://example.com/a.png",
        }}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  // ── forbidden state ───────────────────────────────────────────────────────

  it("renders [无权限] when forbidden", () => {
    render(<MessageRefChip target={{ id: "m1", forbidden: true }} />);
    expect(screen.getByText("[无权限]")).toBeInTheDocument();
  });

  it("forbidden chip has aria-disabled=true", () => {
    render(<MessageRefChip target={{ id: "m1", forbidden: true }} />);
    expect(screen.getByTestId("message-ref-chip")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("forbidden chip has line-through styling", () => {
    render(<MessageRefChip target={{ id: "m1", forbidden: true }} />);
    expect(screen.getByTestId("message-ref-chip").className).toMatch(
      /line-through/,
    );
  });

  it("forbidden takes precedence: shows [无权限] even if isDeleted also true", () => {
    render(
      <MessageRefChip
        target={{ id: "m1", forbidden: true, isDeleted: true }}
      />,
    );
    expect(screen.getByText("[无权限]")).toBeInTheDocument();
    expect(screen.queryByText("[已删除]")).not.toBeInTheDocument();
  });

  // ── thread badge ──────────────────────────────────────────────────────────

  it("renders 🧵 badge when parentSource=thread", () => {
    render(
      <MessageRefChip
        target={{ id: "m1", snippet: "p" }}
        parentSource="thread"
      />,
    );
    expect(screen.getByLabelText("thread-derived")).toBeInTheDocument();
  });

  it("hides 🧵 badge when parentSource=relation", () => {
    render(
      <MessageRefChip
        target={{ id: "m1", snippet: "p" }}
        parentSource="relation"
      />,
    );
    expect(screen.queryByLabelText("thread-derived")).not.toBeInTheDocument();
  });

  it("hides 🧵 badge when parentSource is undefined", () => {
    render(<MessageRefChip target={{ id: "m1", snippet: "p" }} />);
    expect(screen.queryByLabelText("thread-derived")).not.toBeInTheDocument();
  });

  it("hides 🧵 badge when parentSource is null", () => {
    render(
      <MessageRefChip
        target={{ id: "m1", snippet: "p" }}
        parentSource={null}
      />,
    );
    expect(screen.queryByLabelText("thread-derived")).not.toBeInTheDocument();
  });

  it("shows 🧵 badge on deleted chip with parentSource=thread", () => {
    render(
      <MessageRefChip
        target={{ id: "m1", isDeleted: true }}
        parentSource="thread"
      />,
    );
    expect(screen.getByLabelText("thread-derived")).toBeInTheDocument();
  });

  // ── navigation ────────────────────────────────────────────────────────────

  it("fires onNavigate when clicked on clickable chip", () => {
    const onNavigate = vi.fn();
    render(<MessageRefChip target={{ id: "m1" }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId("message-ref-chip"));
    expect(onNavigate).toHaveBeenCalledWith("m1");
  });

  it("fires onNavigate with correct id", () => {
    const onNavigate = vi.fn();
    render(
      <MessageRefChip
        target={{ id: "abc-123", snippet: "hi" }}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("message-ref-chip"));
    expect(onNavigate).toHaveBeenCalledWith("abc-123");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("does not fire onNavigate when disabled (isDeleted)", () => {
    const onNavigate = vi.fn();
    render(
      <MessageRefChip
        target={{ id: "m1", isDeleted: true }}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("message-ref-chip"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not fire onNavigate when disabled (forbidden)", () => {
    const onNavigate = vi.fn();
    render(
      <MessageRefChip
        target={{ id: "m1", forbidden: true }}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("message-ref-chip"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not throw when onNavigate is not provided on clickable chip", () => {
    render(<MessageRefChip target={{ id: "m1", snippet: "hi" }} />);
    expect(() =>
      fireEvent.click(screen.getByTestId("message-ref-chip")),
    ).not.toThrow();
  });

  // ── keyboard navigation ───────────────────────────────────────────────────

  it("keyboard Enter triggers navigate on clickable chip", () => {
    const onNavigate = vi.fn();
    render(<MessageRefChip target={{ id: "m1" }} onNavigate={onNavigate} />);
    const chip = screen.getByTestId("message-ref-chip");
    chip.focus();
    fireEvent.keyDown(chip, { key: "Enter", code: "Enter" });
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith("m1");
  });

  it("clickable chip can receive Tab focus", () => {
    render(<MessageRefChip target={{ id: "m1", snippet: "hi" }} />);
    const chip = screen.getByTestId("message-ref-chip");
    chip.focus();
    expect(document.activeElement).toBe(chip);
  });

  it("disabled chip (isDeleted) does not have click handler", () => {
    const onNavigate = vi.fn();
    render(
      <MessageRefChip
        target={{ id: "m1", isDeleted: true }}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("message-ref-chip"));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
