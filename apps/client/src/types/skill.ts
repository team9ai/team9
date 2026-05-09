// ── Enums ────────────────────────────────────────────────────────────

export type SkillType = "claude_code_skill" | "prompt_template" | "general";

export type SkillAgentAccess = "none" | "read" | "write";

// ── Entities ─────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: SkillType;
  icon: string | null;
  folderId: string | null;
  agentAccess: SkillAgentAccess;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export type SkillDetail = Skill;

// ── DTOs ─────────────────────────────────────────────────────────────

export interface CreateSkillDto {
  name: string;
  description?: string;
  type?: SkillType;
  icon?: string;
  agentAccess?: SkillAgentAccess;
  files?: { path: string; content: string }[];
}

export interface UpdateSkillDto {
  name?: string;
  description?: string;
  icon?: string;
  agentAccess?: SkillAgentAccess;
}
