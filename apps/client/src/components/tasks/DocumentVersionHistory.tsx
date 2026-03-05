import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, FileText } from "lucide-react";
import { documentsApi } from "@/services/api/documents";
import { formatMessageTime } from "@/lib/date-utils";

interface DocumentVersionHistoryProps {
  documentId: string;
}

export function DocumentVersionHistory({
  documentId,
}: DocumentVersionHistoryProps) {
  const { t } = useTranslation("tasks");

  const {
    data: versions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () => documentsApi.getVersions(documentId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !versions) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.versionHistory.loadError")}
      </p>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.versionHistory.noVersions")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((version) => (
        <div
          key={version.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded bg-muted text-muted-foreground shrink-0">
            <FileText size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {t("detail.versionHistory.versionLabel", {
                  version: version.versionIndex + 1,
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatMessageTime(new Date(version.createdAt))}
              </span>
            </div>
            {version.summary && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {version.summary}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
