import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDocument } from "@/hooks/useDocuments";
import { DocumentVersionHistory } from "./DocumentVersionHistory";
import type { AgentTaskDetail } from "@/types/task";

interface TaskDocumentTabProps {
  task: AgentTaskDetail;
}

export function TaskDocumentTab({ task }: TaskDocumentTabProps) {
  const { t } = useTranslation("tasks");
  const { data: taskDoc } = useDocument(task.documentId ?? undefined);

  return (
    <div className="space-y-4">
      {/* Document content preview */}
      {task.documentId && taskDoc?.currentVersion?.content ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 prose prose-sm dark:prose-invert max-w-none overflow-hidden">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {taskDoc.currentVersion.content}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("detail.noDocument")}
        </p>
      )}

      {/* Version history */}
      {task.documentId && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            {t("detail.versionHistory.title")}
          </h4>
          <DocumentVersionHistory documentId={task.documentId} />
        </div>
      )}
    </div>
  );
}
