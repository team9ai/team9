import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentPillRow } from "../AgentPillRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("AgentPillRow", () => {
  it("common with roleTitle → AI + roleTitle", () => {
    render(<AgentPillRow staffKind="common" roleTitle="HR Lead" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("HR Lead")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
    expect(screen.queryByText("agentPillModel")).toBeNull();
  });

  it("common without roleTitle → only AI pill", () => {
    render(<AgentPillRow staffKind="common" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
    expect(screen.queryByText("agentPillModel")).toBeNull();
  });

  it("personal with ownerName → AI + 个人助理 + ownerName", () => {
    render(<AgentPillRow staffKind="personal" ownerName="Winrey" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
    expect(screen.getByText("Winrey")).toBeInTheDocument();
  });

  it("personal without ownerName → AI + 个人助理 only", () => {
    render(<AgentPillRow staffKind="personal" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
  });

  it("other → AI + Model", () => {
    render(<AgentPillRow staffKind="other" />);
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillModel")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
  });

  it("variable-content pills truncate via title attribute", () => {
    render(
      <AgentPillRow
        staffKind="common"
        roleTitle="Very Long Role Title That Overflows"
      />,
    );
    const pill = screen.getByText("Very Long Role Title That Overflows");
    expect(pill).toHaveAttribute(
      "title",
      "Very Long Role Title That Overflows",
    );
    expect(pill.className).toMatch(/truncate/);
    expect(pill.className).toMatch(/min-w-0/);
  });

  it("ownerName pill also gets title and truncate classes", () => {
    render(
      <AgentPillRow
        staffKind="personal"
        ownerName="Some Very Long Owner Name"
      />,
    );
    const pill = screen.getByText("Some Very Long Owner Name");
    expect(pill).toHaveAttribute("title", "Some Very Long Owner Name");
    expect(pill.className).toMatch(/truncate/);
    expect(pill.className).toMatch(/min-w-0/);
  });
});
