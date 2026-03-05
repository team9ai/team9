import { useTranslation } from "react-i18next";
import { FileDown, File } from "lucide-react";
import type { AgentTaskDeliverable } from "@/types/task";

interface TaskDeliverableListProps {
  deliverables: AgentTaskDeliverable[];
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes === 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function TaskDeliverableList({
  deliverables,
}: TaskDeliverableListProps) {
  const { t } = useTranslation("tasks");

  if (deliverables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.noDeliverables")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {deliverables.map((d) => (
        <a
          key={d.id}
          href={d.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors group"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded bg-muted text-muted-foreground group-hover:text-foreground">
            <File size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{d.fileName}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {d.mimeType && <span>{d.mimeType}</span>}
              {d.fileSize != null && d.fileSize > 0 && (
                <>
                  {d.mimeType && <span>·</span>}
                  <span>{formatFileSize(d.fileSize)}</span>
                </>
              )}
            </div>
          </div>
          <FileDown
            size={16}
            className="text-muted-foreground group-hover:text-foreground shrink-0"
          />
        </a>
      ))}
    </div>
  );
}
