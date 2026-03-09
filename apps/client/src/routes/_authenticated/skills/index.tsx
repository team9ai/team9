import { createFileRoute } from "@tanstack/react-router";
import { SkillsListPage } from "@/components/skills/SkillsListPage";

export const Route = createFileRoute("/_authenticated/skills/")({
  component: SkillsListPage,
});
