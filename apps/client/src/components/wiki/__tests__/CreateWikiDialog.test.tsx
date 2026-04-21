import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateWikiDialog } from "../CreateWikiDialog";

describe("CreateWikiDialog (Task 16 stub)", () => {
  it("renders nothing — real body lands in Task 20", () => {
    const { container } = render(
      <CreateWikiDialog open={false} onOpenChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("still renders nothing when open is true", () => {
    const { container } = render(
      <CreateWikiDialog open onOpenChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
