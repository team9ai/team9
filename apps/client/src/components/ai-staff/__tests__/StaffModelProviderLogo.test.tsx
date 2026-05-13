import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StaffModelProviderLogo } from "../StaffModelProviderLogo";

describe("StaffModelProviderLogo", () => {
  it("uses a centered wrapper so provider icons align with model labels", () => {
    render(<StaffModelProviderLogo model={{ label: "Claude Sonnet 4.6" }} />);

    const logo = screen.getByRole("img", { name: "Claude logo" });
    expect(logo.tagName).toBe("SPAN");
    expect(logo).toHaveClass("inline-flex", "items-center", "justify-center");
    expect(logo).toHaveClass("self-center", "align-middle");

    const artwork = logo.querySelector("img");
    expect(artwork).toHaveClass("block", "size-full", "object-contain");
    expect(artwork).toHaveAttribute("aria-hidden", "true");
  });
});
