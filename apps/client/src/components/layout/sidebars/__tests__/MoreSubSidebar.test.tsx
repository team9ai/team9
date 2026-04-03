import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoreSubSidebar } from "../MoreSubSidebar";

describe("MoreSubSidebar", () => {
  it("shows only implemented entries", () => {
    render(<MoreSubSidebar />);

    expect(screen.getByText(/^Settings$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Help$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^About$/i)).not.toBeInTheDocument();
  });
});
