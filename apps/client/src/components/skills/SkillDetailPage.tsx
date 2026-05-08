import { Route } from "@/routes/_authenticated/skills/$skillId";
import { SkillsListPage } from "./SkillsListPage";

export function SkillDetailPage() {
  const { skillId } = Route.useParams();
  return <SkillsListPage selectedSkillId={skillId} />;
}
