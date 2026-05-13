import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentEditor } from "../DocumentEditor";

vi.mock("@/components/channel/editor/themes/editorTheme", () => ({
  editorTheme: {
    heading: {
      h1: "text-3xl",
      h2: "text-2xl",
      h3: "text-xl",
    },
  },
}));

describe("DocumentEditor", () => {
  it("does not render the formatting controls as a fixed toolbar", async () => {
    await act(async () => {
      render(<DocumentEditor initialContent="Hello" />);
      await Promise.resolve();
    });

    expect(screen.queryByTitle("Bold (Ctrl+B)")).toBeNull();
    expect(screen.queryByTestId("document-floating-toolbar")).toBeNull();
  });

  it("constrains the editor body so long documents scroll inside flex panes", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<DocumentEditor initialContent="Hello" />));
      await Promise.resolve();
    });

    expect(container.firstElementChild).toHaveClass(
      "flex",
      "flex-col",
      "h-full",
      "min-h-0",
    );
    expect(container.querySelector(".overflow-y-auto")).toHaveClass("min-h-0");
  });
});
