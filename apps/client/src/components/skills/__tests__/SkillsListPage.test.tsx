import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsListPage } from "../SkillsListPage";
import type { Skill } from "@/types/skill";

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/folder9-editor/Folder9FolderEditor", () => ({
  Folder9FolderEditor: () => <div data-testid="folder-editor" />,
}));

vi.mock("@/components/skills/CreateSkillDialog", () => ({
  CreateSkillDialog: () => null,
}));

const skill: Skill = {
  id: "skill-1",
  tenantId: "tenant-1",
  name: "测试",
  description: null,
  type: "claude_code_skill",
  icon: null,
  folderId: "folder-1",
  agentAccess: "none",
  creatorId: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/hooks/useSkills", () => ({
  useSkills: () => ({ data: [skill], isLoading: false }),
  useSkill: () => ({ data: skill, isLoading: false, error: null }),
  useDeleteSkill: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({
    data: { id: "user-1" },
    isLoading: false,
  }),
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
}));

describe("SkillsListPage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("lets the middle separator resize the skills list width", () => {
    render(<SkillsListPage selectedSkillId="skill-1" />);

    expect(screen.getByTestId("skills-list-sidebar")).toHaveStyle({
      width: "360px",
    });

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("skills-list-resize-handle"), {
        clientX: 360,
      });
      fireEvent.pointerMove(window, {
        clientX: 1360,
      });
      fireEvent.pointerUp(window);
    });

    expect(screen.getByTestId("skills-list-sidebar")).toHaveStyle({
      width: "640px",
    });
  });
});
