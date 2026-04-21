import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WikiPageView } from "../WikiPageView";

describe("WikiPageView (Task 15 stub)", () => {
  it("renders a loading placeholder — real body arrives in Task 17", () => {
    render(<WikiPageView wikiId="wiki-1" path="index.md" />);
    expect(screen.getByText("loading...")).toBeInTheDocument();
  });

  it("accepts wikiId and path props without crashing for nested paths", () => {
    render(<WikiPageView wikiId="wiki-1" path="api/docs/auth.md" />);
    expect(screen.getByText("loading...")).toBeInTheDocument();
  });
});
