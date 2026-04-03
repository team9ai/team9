import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BaseModelProductLogo } from "../BaseModelProductLogo";

describe("BaseModelProductLogo", () => {
  it("renders the Claude logo for claude agent ids", () => {
    render(<BaseModelProductLogo agentId="base-model-claude-workspace-1" />);

    expect(
      screen.getByRole("img", { name: "Claude logo" }),
    ).toBeInTheDocument();
  });

  it("renders the ChatGPT logo for chatgpt agent ids", () => {
    render(<BaseModelProductLogo agentId="base-model-chatgpt-workspace-1" />);

    expect(
      screen.getByRole("img", { name: "ChatGPT logo" }),
    ).toBeInTheDocument();
  });

  it("renders the Gemini logo for gemini agent ids", () => {
    render(<BaseModelProductLogo agentId="base-model-gemini-workspace-1" />);

    expect(
      screen.getByRole("img", { name: "Gemini logo" }),
    ).toBeInTheDocument();
  });

  it("falls back to the generic bot icon for unknown agent ids", () => {
    const { container } = render(
      <BaseModelProductLogo agentId="base-model-custom-workspace-1" />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
