import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { FileText, Sparkles, MessageSquareText, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Skill } from "@/types/skill";

const TYPE_ICONS: Record<Skill["type"], typeof Sparkles> = {
  claude_code_skill: Sparkles,
  prompt_template: MessageSquareText,
  general: Wrench,
};

interface SkillCardProps {
  skill: Skill;
  hasPendingSuggestion?: boolean;
}

export function SkillCard({ skill, hasPendingSuggestion }: SkillCardProps) {
  const { t } = useTranslation("skills");
  const navigate = useNavigate();
  const TypeIcon = TYPE_ICONS[skill.type];

  return (
    <button
      type="button"
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/50 cursor-pointer w-full relative",
      )}
      onClick={() =>
        navigate({ to: "/skills/$skillId", params: { skillId: skill.id } })
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate({ to: "/skills/$skillId", params: { skillId: skill.id } });
        }
      }}
    >
      {hasPendingSuggestion && (
        <span className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-orange-500" />
      )}

      <div className="flex items-center gap-2.5">
        <span className="text-xl">{skill.icon || "🧩"}</span>
        <span className="font-medium truncate">{skill.name}</span>
      </div>

      {skill.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {skill.description}
        </p>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <Badge variant="secondary" className="text-xs gap-1">
          <TypeIcon size={12} />
          {t(`type.${skill.type}` as const)}
        </Badge>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <FileText size={12} />v{skill.currentVersion}
        </span>
      </div>
    </button>
  );
}
