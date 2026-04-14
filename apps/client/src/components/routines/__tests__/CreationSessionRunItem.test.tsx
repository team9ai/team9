import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { CreationSessionRunItem } from "../CreationSessionRunItem";

describe("CreationSessionRunItem", () => {
  it("renders the creation label and responds to clicks", () => {
    const onClick = vi.fn();
    render(<CreationSessionRunItem isSelected={false} onClick={onClick} />);

    expect(screen.getByText("Routine Creation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the selected style when isSelected=true", () => {
    const { container } = render(
      <CreationSessionRunItem isSelected={true} onClick={() => {}} />,
    );
    // Selected state uses primary ring + primary background tint
    const btn = container.querySelector("button");
    expect(btn?.className).toMatch(/ring|primary/);
  });
});
