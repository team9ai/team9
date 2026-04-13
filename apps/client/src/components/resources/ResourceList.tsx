import { useMemo, useState } from "react";
import { Loader2, Box, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ResourceCard } from "./ResourceCard";
import { ResourceDetailPanel } from "./ResourceDetailPanel";
import { mockResources } from "./mockResources";

interface ResourceListProps {
  selectedResourceId: string | null;
  onSelectResource: (id: string | null) => void;
  onCreateClick?: () => void;
}

const TAB_KEYS = [
  "all",
  "agent_computer",
  "llm",
  "api",
  "mcp",
  "database",
  "browser",
  "knowledge_base",
  "sandbox",
  "webhook",
  "mail_calendar",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function ResourceList({
  selectedResourceId,
  onSelectResource,
  onCreateClick,
}: ResourceListProps) {
  const [tab, setTab] = useState<TabKey>("all");
  const { t } = useTranslation("resources");

  const { data: allResources = [], isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => Promise.resolve(mockResources),
  });

  const resources = useMemo(
    () =>
      tab === "all" ? allResources : allResources.filter((r) => r.type === tab),
    [allResources, tab],
  );

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Filter tabs */}
        <div
          className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto scrollbar-thin"
          role="tablist"
        >
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "shrink-0 whitespace-nowrap px-2.5 py-1 rounded text-xs font-medium transition-colors",
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        {/* Resource grid */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && resources.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Box size={24} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("noResources")}</p>
            {onCreateClick && (
              <Button size="sm" variant="outline" onClick={onCreateClick}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                {t("create.title")}
              </Button>
            )}
          </div>
        )}

        {!isLoading && resources.length > 0 && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {resources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                onClick={() => onSelectResource(resource.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedResourceId && (
        <ResourceDetailPanel
          resourceId={selectedResourceId}
          onClose={() => onSelectResource(null)}
        />
      )}
    </div>
  );
}
