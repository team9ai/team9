import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PropertyTag } from "../PropertyTag";
import { OPTION_COLOR_SWATCH } from "../option-colors";

describe("PropertyTag", () => {
  it("renders the label without a dot when no color is provided", () => {
    const { container } = render(<PropertyTag label="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
    // Only the outer wrapper span; no color dot.
    expect(container.querySelectorAll("span[style]").length).toBe(0);
  });

  it("resolves a named color to its preset hex swatch", () => {
    const { container } = render(<PropertyTag label="Bug" color="red" />);
    const dot = container.querySelector("span[style]") as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot!.style.backgroundColor).toBeTruthy();
    // Named key should map to the preset — not be used verbatim.
    expect(dot!.style.backgroundColor).not.toBe("red");
  });

  it("passes through a legacy hex color unchanged", () => {
    const { container } = render(
      <PropertyTag label="Legacy" color="#123456" />,
    );
    const dot = container.querySelector("span[style]") as HTMLElement | null;
    expect(dot).not.toBeNull();
    // jsdom normalizes hex to rgb; compare against what the helper returns.
    expect(dot!.style.backgroundColor).toBe("rgb(18, 52, 86)");
  });

  it("hides the dot for the explicit 'default' key", () => {
    const { container } = render(<PropertyTag label="Plain" color="default" />);
    expect(container.querySelectorAll("span[style]").length).toBe(0);
  });

  it("exposes every preset swatch as a valid hex", () => {
    for (const [key, hex] of Object.entries(OPTION_COLOR_SWATCH)) {
      if (key === "default") {
        expect(hex).toBe("transparent");
        continue;
      }
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
