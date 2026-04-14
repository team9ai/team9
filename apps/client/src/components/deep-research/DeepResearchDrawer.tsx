import { useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { DOCUMENT_MARKDOWN_TRANSFORMERS } from "@/components/documents/markdownTransformers";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { deepResearchApi, type Task } from "@/services/api/deep-research";
import { upsertChannelMessageInCache } from "@/lib/message-query-cache";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";
import { NewTaskForm } from "./NewTaskForm";
import { TaskDetail } from "./TaskDetail";

export interface DeepResearchDrawerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editor: LexicalEditor | null;
  channelId?: string;
}

export function DeepResearchDrawer({
  open,
  onOpenChange,
  editor,
  channelId,
}: DeepResearchDrawerProps) {
  const { t } = useTranslation("deepResearch");
  const queryClient = useQueryClient();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [text, setText] = useState("");
  const stream = useDeepResearchStore((s) =>
    activeTask ? s.byTaskId[activeTask.id] : undefined,
  );
  const startInChannel = useMutation({
    mutationFn: async () => {
      if (!channelId) {
        throw new Error("Missing channel id");
      }

      return deepResearchApi.startInChannel(channelId, {
        input: text.trim(),
        origin: "chat",
      });
    },
    onSuccess: (result) => {
      upsertChannelMessageInCache(queryClient, channelId!, result.message);
      setText("");
      setActiveTask(null);
      onOpenChange(false);
    },
  });

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
      setText("");
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-0 left-auto right-0 h-full w-[640px] max-w-full translate-x-0 translate-y-0 rounded-none rounded-l-lg data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
        <DialogTitle className="text-base">{t("title")}</DialogTitle>
        <div className="flex-1 overflow-y-auto">
          {channelId ? (
            <form
              className="flex flex-col gap-3 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                startInChannel.mutate();
              }}
            >
              <textarea
                className="min-h-24 w-full rounded border p-2 text-sm"
                placeholder={t("promptPlaceholder")}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-red-600">
                  {startInChannel.isError
                    ? (startInChannel.error as Error).message
                    : ""}
                </span>
                <button
                  type="submit"
                  disabled={!text.trim() || startInChannel.isPending}
                  className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  {t("start")}
                </button>
              </div>
            </form>
          ) : !activeTask ? (
            <NewTaskForm onCreated={setActiveTask} />
          ) : (
            <TaskDetail taskId={activeTask.id} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
