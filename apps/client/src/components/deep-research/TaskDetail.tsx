import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { deepResearchApi } from "@/services/api/deep-research";
import { useDeepResearchStream } from "@/hooks/useDeepResearchStream";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";
import { getAuthToken } from "@/services/auth-session";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { StatusBadge } from "./StatusBadge";
import { EventTimeline } from "./EventTimeline";
import { MarkdownDeltaView } from "./MarkdownDeltaView";
import { FinalReportView } from "./FinalReportView";

export interface TaskDetailProps {
  taskId: string;
  // When rendered inside a container that already shows the prompt + status
  // (e.g., the channel-side panel that mimics the thread header), skip the
  // duplicate header here.
  hideHeader?: boolean;
}

// Returns a memoized getAuth fn that reads the latest token/tenant on each
// reconnect (so refreshed tokens after 401 are picked up automatically).
function useAuthTriple(): () => Promise<{ token: string; tenantId: string }> {
  const tenantId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  return async () => ({
    token: getAuthToken() ?? "",
    tenantId: tenantId ?? "",
  });
}

function ErrorLine({
  code,
  message,
  details,
}: {
  code: string;
  message: string;
  details?: unknown;
}) {
  const { t, i18n } = useTranslation("deepResearch");
  const retry = (details as { retryAfterSeconds?: number } | undefined)
    ?.retryAfterSeconds;
  const key = `error.${code}` as Parameters<typeof t>[0];
  if (i18n.exists(`deepResearch:${key}`)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <>{(t as any)(key, { retryAfterSeconds: retry ?? 60 })}</>;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <>{(t as any)("error.UNKNOWN", { code, message })}</>;
}

export function TaskDetail({ taskId, hideHeader = false }: TaskDetailProps) {
  const { t } = useTranslation("deepResearch");
  const getAuth = useAuthTriple();
  const queryClient = useQueryClient();
  const task = useQuery({
    queryKey: ["deep-research", "task", taskId],
    queryFn: () => deepResearchApi.getTask(taskId),
    retry: false,
  });
  const stream = useDeepResearchStore((s) => s.byTaskId[taskId]);

  // Subscribe while the task is live. The hook handles auto-reconnect and
  // stops on interaction.complete / error. Safe to always mount — historical
  // tasks just won't produce new events.
  useDeepResearchStream({ taskId, getAuth, autoReconnect: true });

  useEffect(() => {
    if (stream?.status !== "completed" && stream?.status !== "failed") {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: ["deep-research", "task", taskId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["deep-research", "tasks"],
    });
  }, [queryClient, stream?.status, taskId]);

  if (task.isError) {
    return (
      <div className="p-6 text-center">
        <div className="text-lg font-semibold">{t("detail.notFoundTitle")}</div>
        <div className="text-sm text-zinc-500">{t("detail.notFoundBody")}</div>
      </div>
    );
  }

  const status =
    stream?.status && stream.status !== "idle"
      ? stream.status
      : (task.data?.status ?? "pending");
  const reportUrl = stream?.reportUrl ?? task.data?.reportUrl ?? null;
  const isHistorical = status === "completed" || status === "failed";
  const isLive = !isHistorical;

  return (
    <div className="flex flex-col gap-4 p-4">
      {!hideHeader && (
        <header className="flex items-center gap-2">
          <StatusBadge status={status} />
          {task.data?.prompt && (
            <span className="text-sm text-zinc-500">{task.data.prompt}</span>
          )}
        </header>
      )}

      {isHistorical && (
        <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("history.banner")}
        </div>
      )}

      <EventTimeline taskId={taskId} />
      {isLive &&
        !stream?.markdownAccum &&
        (stream?.thoughts?.length ?? 0) === 0 && (
          <div className="flex items-center gap-2 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
            </span>
            <span>{t("detail.planningNotice")}</span>
          </div>
        )}
      {isLive && stream?.markdownAccum && (
        <MarkdownDeltaView markdown={stream.markdownAccum} />
      )}
      {reportUrl && <FinalReportView reportUrl={reportUrl} />}

      {stream?.error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          <ErrorLine
            code={stream.error.code}
            message={stream.error.message}
            details={stream.error.details}
          />
        </div>
      )}
    </div>
  );
}
