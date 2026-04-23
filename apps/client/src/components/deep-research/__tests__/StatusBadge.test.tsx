import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";
import "@/i18n";

describe("StatusBadge", () => {
  it("renders the four statuses", () => {
    const { container } = render(
      <>
        <StatusBadge status="pending" />
        <StatusBadge status="running" />
        <StatusBadge status="completed" />
        <StatusBadge status="failed" />
      </>,
    );
    // Match either English or Chinese labels (depends on test i18n detection).
    expect(container.textContent).toMatch(/Queued|排队中/);
    expect(container.textContent).toMatch(/Running|进行中/);
    expect(container.textContent).toMatch(/Completed|已完成/);
    expect(container.textContent).toMatch(/Failed|已失败/);
  });
});
