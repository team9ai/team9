import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSkills } from "@/hooks/useSkills";
import { SkillCard } from "./SkillCard";
import { CreateSkillDialog } from "./CreateSkillDialog";
import type { SkillType } from "@/types/skill";

type TabFilter = "all" | SkillType;

const TABS: { key: TabFilter; labelKey: string }[] = [
  { key: "all", labelKey: "tabs.all" },
  { key: "claude_code_skill", labelKey: "tabs.claudeCodeSkill" },
  { key: "prompt_template", labelKey: "tabs.promptTemplate" },
  { key: "general", labelKey: "tabs.general" },
];

export function SkillsListPage() {
  const { t } = useTranslation("skills");
  const [tab, setTab] = useState<TabFilter>("all");
  const [showCreate, setShowCreate] = useState(false);

  const { data: skills, isLoading } = useSkills();

  const filteredSkills =
    tab === "all" ? skills : skills?.filter((s) => s.type === tab);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={16} className="mr-1" />
          {t("create.create")}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 pb-3" role="tablist">
        {TABS.map(({ key, labelKey }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              tab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
            onClick={() => setTab(key)}
          >
            {t(labelKey as never)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !filteredSkills?.length ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Sparkles size={32} />
            <p className="text-sm">{t("empty")}</p>
            <p className="text-xs">{t("emptyDescription")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                hasPendingSuggestion={skill.pendingSuggestionsCount > 0}
              />
            ))}
          </div>
        )}
      </div>

      <CreateSkillDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}
