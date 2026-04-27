import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WikiStatusBar } from "../WikiStatusBar";

function renderBar(
  overrides: Partial<React.ComponentProps<typeof WikiStatusBar>> = {},
) {
  const onSave = vi.fn();
  const props = {
    lastSavedAt: null,
    isDirty: false,
    isSaving: false,
    canSave: true,
    onSave,
    ...overrides,
  };
  render(<WikiStatusBar {...props} />);
  return { onSave };
}

describe("WikiStatusBar", () => {
  it("shows the synced indicator when not dirty", () => {
    renderBar();
    expect(screen.getByTestId("wiki-status-synced")).toHaveTextContent(
      "Synced",
    );
    expect(screen.queryByTestId("wiki-status-unsaved")).toBeNull();
  });

  it("shows the unsaved indicator when dirty", () => {
    renderBar({ isDirty: true });
    expect(screen.getByTestId("wiki-status-unsaved")).toHaveTextContent(
      "Unsaved changes",
    );
    expect(screen.queryByTestId("wiki-status-synced")).toBeNull();
  });

  it("hides last-saved when null", () => {
    renderBar();
    expect(screen.queryByTestId("wiki-status-last-saved")).toBeNull();
  });

  it("renders last-saved formatted as a local time string", () => {
    renderBar({ lastSavedAt: "2026-04-21T10:11:12.000Z" });
    const node = screen.getByTestId("wiki-status-last-saved");
    expect(node.textContent?.startsWith("· last saved ")).toBe(true);
    expect(node.textContent!.length).toBeGreaterThan("· last saved ".length);
  });

  it("disables the button when the page is not dirty", () => {
    renderBar({ isDirty: false });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables the button when isSaving is true", () => {
    renderBar({ isDirty: true, isSaving: true });
    const btn = screen.getByRole("button", { name: "Saving…" });
    expect(btn).toBeDisabled();
  });

  it("disables the button when canSave is false (e.g. no write permission)", () => {
    renderBar({ isDirty: true, canSave: false });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("enables the button only when dirty, canSave, and not saving", () => {
    renderBar({ isDirty: true, canSave: true, isSaving: false });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("invokes onSave when the button is clicked", () => {
    const { onSave } = renderBar({ isDirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onSave when the button is disabled", () => {
    const { onSave } = renderBar({ isDirty: false });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
