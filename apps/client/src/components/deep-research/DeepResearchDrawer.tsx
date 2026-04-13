import { useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { DOCUMENT_MARKDOWN_TRANSFORMERS } from "@/components/documents/markdownTransformers";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { deepResearchApi, type Task } from "@/services/api/deep-research";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";
import { NewTaskForm } from "./NewTaskForm";
import { TaskDetail } from "./TaskDetail";

export interface DeepResearchDrawerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editor: LexicalEditor | null;
}

export function DeepResearchDrawer({
  open,
  onOpenChange,
  editor,
}: DeepResearchDrawerProps) {
  const { t } = useTranslation("deepResearch");
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const stream = useDeepResearchStore((s) =>
    activeTask ? s.byTaskId[activeTask.id] : undefined,
  );

  // When the task completes, fetch the report URL and insert as Lexical nodes.
  // Fall back to clipboard copy if the editor has unmounted.
  useEffect(() => {
    if (
      !stream ||
      stream.status !== "completed" ||
      !stream.reportUrl ||
      !activeTask
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const md = await fetch(stream.reportUrl!).then((r) => r.text());
        if (cancelled) return;
        if (!editor) throw new Error("editor gone");
        editor.update(() => {
          $convertFromMarkdownString(md, DOCUMENT_MARKDOWN_TRANSFORMERS);
        });
        console.info("[deep-research]", t("drawer.insertSuccess"));
      } catch {
        // Editor unavailable — degrade to clipboard copy.
        try {
          const fresh = await deepResearchApi.getTask(activeTask.id);
          if (fresh.reportUrl) {
            const md = await fetch(fresh.reportUrl).then((r) => r.text());
            await navigator.clipboard.writeText(md);
            console.info("[deep-research]", t("drawer.insertFallback"));
          }
        } catch (err) {
          console.error("[deep-research] failed to surface report", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stream, activeTask, editor, t]);

  // Close handler. A running task keeps running on the server; the user can
  // resume at /deep-research/:taskId. TODO: add a toast once a lib is adopted.
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setActiveTask(null);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-0 left-auto right-0 h-full w-[640px] max-w-full translate-x-0 translate-y-0 rounded-none rounded-l-lg data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
        <DialogTitle className="text-base">{t("title")}</DialogTitle>
        <div className="flex-1 overflow-y-auto">
          {!activeTask ? (
            <NewTaskForm onCreated={setActiveTask} />
          ) : (
            <TaskDetail taskId={activeTask.id} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
