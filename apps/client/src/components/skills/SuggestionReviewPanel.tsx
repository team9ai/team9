import { useTranslation } from "react-i18next";
import { Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSkillVersion, useReviewSkillVersion } from "@/hooks/useSkills";
import type { SkillFile } from "@/types/skill";

interface SuggestionReviewPanelProps {
  skillId: string;
  version: number;
  currentFiles: SkillFile[];
  onClose: () => void;
}

export function SuggestionReviewPanel({
  skillId,
  version,
  currentFiles,
  onClose,
}: SuggestionReviewPanelProps) {
  const { t } = useTranslation("skills");
  const { data: suggestedVersion, isLoading } = useSkillVersion(
    skillId,
    version,
  );
  const reviewMutation = useReviewSkillVersion(skillId);

  function handleReview(action: "approve" | "reject") {
    reviewMutation.mutate({ version, action }, { onSuccess: onClose });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!suggestedVersion) return null;

  const suggestedFiles = suggestedVersion.files;

  // Build a combined list of all file paths
  const allPaths = new Set([
    ...currentFiles.map((f) => f.path),
    ...suggestedFiles.map((f) => f.path),
  ]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-orange-50 dark:bg-orange-950/20">
        <div>
          <h3 className="font-medium text-sm">
            {t("version.pendingSuggestion")} — v{version}
          </h3>
          <p className="text-xs text-muted-foreground">
            {suggestedVersion.suggestedBy
              ? t("version.suggestedBy", { name: suggestedVersion.suggestedBy })
              : t("version.pendingSuggestionDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleReview("reject")}
            disabled={reviewMutation.isPending}
          >
            <X size={14} className="mr-1" />
            {t("version.reject")}
          </Button>
          <Button
            size="sm"
            onClick={() => handleReview("approve")}
            disabled={reviewMutation.isPending}
          >
            {reviewMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Check size={14} className="mr-1" />
            )}
            {t("version.approve")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {[...allPaths].sort().map((path) => {
          const current = currentFiles.find((f) => f.path === path);
          const suggested = suggestedFiles.find((f) => f.path === path);

          const isNew = !current && !!suggested;
          const isDeleted = !!current && !suggested;
          const isModified =
            current && suggested && current.content !== suggested.content;
          const isUnchanged =
            current && suggested && current.content === suggested.content;

          if (isUnchanged) return null;

          return (
            <div
              key={path}
              className="rounded-md border border-border overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border text-sm font-mono">
                <span>{path}</span>
                {isNew && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Added
                  </span>
                )}
                {isDeleted && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    Deleted
                  </span>
                )}
                {isModified && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Modified
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="p-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("version.current")}
                  </div>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                    {current?.content ?? "—"}
                  </pre>
                </div>
                <div className="p-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("version.pendingSuggestion")}
                  </div>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                    {suggested?.content ?? "—"}
                  </pre>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
