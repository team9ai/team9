import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { FinalReportView } from "../FinalReportView";

describe("FinalReportView", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("# Hello\n\nbody", { status: 200 })),
    );
  });

  it("fetches the report url and renders markdown", async () => {
    const { container } = render(<FinalReportView reportUrl="http://x/r.md" />);
    await waitFor(() =>
      expect(container.querySelector("h1")?.textContent).toBe("Hello"),
    );
  });

  it("renders nothing when reportUrl is null", () => {
    const { container } = render(<FinalReportView reportUrl={null} />);
    expect(container.textContent).toBe("");
  });
});
