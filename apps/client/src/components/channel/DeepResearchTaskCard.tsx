import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  PanelRightOpen,
  SearchCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";

type DeepResearchTaskStatus = "running" | "plan_ready" | "completed" | "failed";

export interface DeepResearchTaskMeta {
  childChannelId: string;
  parentChannelId?: string;
  parentMessageId?: string;
  title: string;
  status: DeepResearchTaskStatus;
  phase?: string;
  kind?: "plan" | "report";
  taskId?: string;
  interactionId?: string;
  reportS3Key?: string;
  updatedAt?: string;
  error?: string;
}

interface DeepResearchTaskCardProps {
  meta: DeepResearchTaskMeta;
  className?: string;
  onOpen?: (meta: DeepResearchTaskMeta) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSession(record: Record<string, unknown>) {
  const nested = isRecord(record.session) ? record.session : null;
  const childChannelId =
    stringValue(record.childChannelId) ?? stringValue(nested?.childChannelId);
  const parentChannelId =
    stringValue(record.parentChannelId) ?? stringValue(nested?.parentChannelId);
  const parentMessageId =
    stringValue(record.parentMessageId) ?? stringValue(nested?.parentMessageId);

  if (!childChannelId) return null;
  return {
    childChannelId,
    ...(parentChannelId ? { parentChannelId } : {}),
    ...(parentMessageId ? { parentMessageId } : {}),
  };
}

function normalizeTaskStatus(record: Record<string, unknown>) {
  const status = stringValue(record.status);
  const phase = stringValue(record.phase);
  const kind = stringValue(record.kind);
  if (status === "failed" || phase === "failed") return "failed";
  if (status === "plan_ready" || (kind === "plan" && status === "completed")) {
    return "plan_ready";
  }
  if (status === "completed") return "completed";
  return "running";
}

function normalizeKind(value: unknown): "plan" | "report" | undefined {
  return value === "plan" || value === "report" ? value : undefined;
}

function fromTaskRecord(record: Record<string, unknown>) {
  const session = readSession(record);
  if (!session) return null;

  return {
    ...session,
    title: stringValue(record.title) ?? "Deep Research",
    status: normalizeTaskStatus(record),
    ...(stringValue(record.phase) ? { phase: stringValue(record.phase) } : {}),
    ...(normalizeKind(record.kind) ? { kind: normalizeKind(record.kind) } : {}),
    ...(stringValue(record.taskId)
      ? { taskId: stringValue(record.taskId) }
      : {}),
    ...(stringValue(record.interactionId)
      ? { interactionId: stringValue(record.interactionId) }
      : {}),
    ...(stringValue(record.reportS3Key)
      ? { reportS3Key: stringValue(record.reportS3Key) }
      : {}),
    ...(stringValue(record.updatedAt)
      ? { updatedAt: stringValue(record.updatedAt) }
      : {}),
    ...(stringValue(record.error) ? { error: stringValue(record.error) } : {}),
  } satisfies DeepResearchTaskMeta;
}

type ChannelTFunction = TFunction<"channel">;

export function getDeepResearchTaskMeta(
  metadata: unknown,
  currentChannelId?: string,
): DeepResearchTaskMeta | null {
  if (!isRecord(metadata)) return null;

  const explicitTask = isRecord(metadata.deepResearchTask)
    ? fromTaskRecord(metadata.deepResearchTask)
    : null;
  if (explicitTask) return explicitTask;

  const deepResearch = isRecord(metadata.deepResearch)
    ? metadata.deepResearch
    : null;
  if (!deepResearch || !currentChannelId) return null;

  const legacyTask = fromTaskRecord(deepResearch);
  if (
    legacyTask?.parentChannelId === currentChannelId &&
    legacyTask.childChannelId !== currentChannelId
  ) {
    return legacyTask;
  }

  return null;
}

function getStatusView(meta: DeepResearchTaskMeta, t: ChannelTFunction) {
  if (meta.status === "failed") {
    return {
      icon: AlertCircle,
      label: t("deepResearch.task.status.failed"),
      detail: meta.error ?? t("deepResearch.task.detail.failed"),
      className:
        "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/15",
    };
  }
  if (meta.status === "plan_ready") {
    return {
      icon: CheckCircle2,
      label: t("deepResearch.task.status.planReady"),
      detail: t("deepResearch.task.detail.planReady"),
      className:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (meta.status === "completed") {
    return {
      icon: CheckCircle2,
      label: t("deepResearch.task.status.completed"),
      detail: t("deepResearch.task.detail.completed"),
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  return {
    icon: Clock3,
    label: t("deepResearch.task.status.running"),
    detail:
      meta.kind === "plan" || meta.phase === "planning"
        ? t("deepResearch.task.detail.generatingPlan")
        : t("deepResearch.task.detail.running"),
    className:
      "border-info/30 bg-info/10 text-info dark:border-info/35 dark:bg-info/15",
  };
}

function formatUpdatedAt(
  value: string | undefined,
  locale: string | undefined,
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DeepResearchTaskCard({
  meta,
  className,
  onOpen,
}: DeepResearchTaskCardProps) {
  const { t, i18n } = useTranslation("channel");
  const status = getStatusView(meta, t);
  const StatusIcon = status.icon;
  const updatedAt = formatUpdatedAt(
    meta.updatedAt,
    i18n.resolvedLanguage ?? i18n.language,
  );

  return (
    <button
      type="button"
      className={cn(
        "group w-full max-w-2xl rounded-md border border-border bg-background px-4 py-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !onOpen && "cursor-default hover:border-border hover:bg-background",
        className,
      )}
      disabled={!onOpen}
      onClick={() => onOpen?.(meta)}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-info">
          <SearchCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{meta.title}</span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.68rem] font-medium",
                status.className,
              )}
            >
              <StatusIcon className="size-3" />
              {status.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{status.detail}</span>
            {updatedAt && (
              <span>
                {t("deepResearch.task.updatedAt", { time: updatedAt })}
              </span>
            )}
          </div>
        </div>
        <PanelRightOpen className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
    </button>
  );
}
