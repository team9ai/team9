import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { UserListItem } from "../UserListItem";

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: vi.fn(() => false),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("UserListItem agent pills", () => {
  it("bot + staffKind=common with roleTitle renders AI + role pills", () => {
    render(
      <UserListItem
        name="Employee Relations Tracker"
        userId="bot-1"
        isBot
        staffKind="common"
        roleTitle="HR Lead"
      />,
    );
    expect(screen.getByText("Employee Relations Tracker")).toBeInTheDocument();
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("HR Lead")).toBeInTheDocument();
  });

  it("bot + staffKind=common without roleTitle renders only AI pill", () => {
    render(
      <UserListItem
        name="Generic Common Bot"
        userId="bot-2"
        isBot
        staffKind="common"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.queryByText("agentPillPersonalAssistant")).toBeNull();
    expect(screen.queryByText("agentPillModel")).toBeNull();
  });

  it("bot + staffKind=personal renders AI + 个人助理 + ownerName", () => {
    render(
      <UserListItem
        name="Personal Staff"
        userId="bot-3"
        isBot
        staffKind="personal"
        ownerName="Winrey"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
    expect(screen.getByText("Winrey")).toBeInTheDocument();
  });

  it("bot + staffKind=personal without ownerName drops owner pill", () => {
    render(
      <UserListItem
        name="Orphan Personal"
        userId="bot-4"
        isBot
        staffKind="personal"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillPersonalAssistant")).toBeInTheDocument();
  });

  it("bot + staffKind=other renders AI + Model", () => {
    render(
      <UserListItem
        name="OpenClaw Bot"
        userId="bot-5"
        isBot
        staffKind="other"
      />,
    );
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
    expect(screen.getByText("agentPillModel")).toBeInTheDocument();
  });

  it("bot + staffKind=null falls back to subtitle if provided", () => {
    render(
      <UserListItem
        name="Legacy Bot"
        userId="bot-6"
        isBot
        subtitle="@legacy_bot"
      />,
    );
    expect(screen.getByText("@legacy_bot")).toBeInTheDocument();
    expect(screen.queryByText("agentPillAi")).toBeNull();
  });

  it("human with subtitle renders subtitle, no pill row", () => {
    render(<UserListItem name="Alice" userId="user-1" subtitle="@alice" />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.queryByText("agentPillAi")).toBeNull();
  });

  it("subtitle is suppressed when bot has staffKind (pills win)", () => {
    render(
      <UserListItem
        name="Some Bot"
        userId="bot-7"
        isBot
        subtitle="@some_bot"
        staffKind="other"
      />,
    );
    expect(screen.queryByText("@some_bot")).toBeNull();
    expect(screen.getByText("agentPillAi")).toBeInTheDocument();
  });
});
