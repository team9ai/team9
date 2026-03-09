// ── Enums ────────────────────────────────────────────────────────────

export type SkillType = "claude_code_skill" | "prompt_template" | "general";

export type SkillVersionStatus =
  | "draft"
  | "published"
  | "suggested"
  | "rejected";

// ── Entities ─────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: SkillType;
  icon: string | null;
  currentVersion: number;
  pendingSuggestionsCount: number;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillFileManifestEntry {
  path: string;
  fileId: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  message: string | null;
  status: SkillVersionStatus;
  fileManifest: SkillFileManifestEntry[];
  suggestedBy: string | null;
  creatorId: string;
  createdAt: string;
}

export interface SkillFile {
  id: string;
  skillId: string;
  path: string;
  content: string;
  size: number;
  createdAt: string;
}

export interface SkillDetail extends Skill {
  currentVersionInfo: SkillVersion | null;
  files: SkillFile[];
  pendingSuggestions: SkillVersion[];
}

export interface SkillVersionDetail extends SkillVersion {
  files: SkillFile[];
}

// ── DTOs ─────────────────────────────────────────────────────────────

export interface CreateSkillDto {
  name: string;
  description?: string;
  type: SkillType;
  icon?: string;
  files?: { path: string; content: string }[];
}

export interface UpdateSkillDto {
  name?: string;
  description?: string;
  icon?: string;
}

export interface CreateVersionDto {
  message?: string;
  files: { path: string; content: string }[];
  status: "published" | "suggested";
  suggestedBy?: string;
}

export interface ReviewVersionDto {
  action: "approve" | "reject";
}
