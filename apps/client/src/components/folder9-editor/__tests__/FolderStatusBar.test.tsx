import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderStatusBar } from "../FolderStatusBar";

describe("FolderStatusBar", () => {
  it("shows the unsaved badge when isDirty=true", () => {
    render(
      <FolderStatusBar
        lastSavedAt={null}
        isDirty
        isSaving={false}
        canSave
        onSave={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("folder9-folder-status-unsaved"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("folder9-folder-status-synced")).toBeNull();
  });

  it("shows the synced badge when isDirty=false", () => {
    render(
      <FolderStatusBar
        lastSavedAt={null}
        isDirty={false}
        isSaving={false}
        canSave
        onSave={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("folder9-folder-status-synced"),
    ).toBeInTheDocument();
  });

  it("shows the last-saved timestamp when present", () => {
    render(
      <FolderStatusBar
        lastSavedAt="2026-04-15T12:00:00.000Z"
        isDirty={false}
        isSaving={false}
        canSave
        onSave={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("folder9-folder-status-last-saved"),
    ).toBeInTheDocument();
  });

  it("disables the save button when canSave is false", () => {
    render(
      <FolderStatusBar
        lastSavedAt={null}
        isDirty
        isSaving={false}
        canSave={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("disables the save button when isSaving=true", () => {
    render(
      <FolderStatusBar
        lastSavedAt={null}
        isDirty
        isSaving
        canSave
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("disables the save button when isDirty=false", () => {
    render(
      <FolderStatusBar
        lastSavedAt={null}
        isDirty={false}
        isSaving={false}
        canSave
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onSave when the button is clicked", () => {
    const onSave = vi.fn();
    render(
      <FolderStatusBar
        lastSavedAt={null}
        isDirty
        isSaving={false}
        canSave
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
