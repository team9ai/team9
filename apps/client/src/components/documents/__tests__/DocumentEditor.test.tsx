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
});
