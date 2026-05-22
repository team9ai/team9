import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MoreSubSidebar } from "../MoreSubSidebar";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

describe("MoreSubSidebar", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("does not expose the retired Tasks entry", () => {
    render(<MoreSubSidebar />);

    expect(screen.getByText(/^Settings$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Tasks$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Help$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^About$/i)).not.toBeInTheDocument();
  });

  it("does not navigate from the static Settings row", () => {
    render(<MoreSubSidebar />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
