import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MoreSubSidebar } from "../MoreSubSidebar";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

describe("MoreSubSidebar", () => {
  it("shows implemented entries including Tasks", () => {
    render(<MoreSubSidebar />);

    expect(screen.getByText(/^Settings$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Tasks$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Help$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^About$/i)).not.toBeInTheDocument();
  });

  it("navigates to Tasks from the More sidebar", () => {
    render(<MoreSubSidebar />);

    fireEvent.click(screen.getByText(/^Tasks$/i));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks" });
  });
});
