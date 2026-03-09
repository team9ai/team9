import { createFileRoute } from "@tanstack/react-router";
import { SkillDetailPage } from "@/components/skills/SkillDetailPage";

export const Route = createFileRoute("/_authenticated/skills/$skillId")({
  component: SkillDetailPage,
});
