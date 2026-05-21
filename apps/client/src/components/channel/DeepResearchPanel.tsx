import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import imApi, {
  type DeepResearchSessionContextResponse,
} from "@/services/api/im";
import wsService from "@/services/websocket";
import type { AttachmentDto, Message } from "@/types/im";
import { cn } from "@/lib/utils";
import { MessageContent } from "./MessageContent";
import { MessageInput } from "./MessageInput";
import { ResizeHandle } from "./ResizeHandle";
import {
  DeepResearchPlanCard,
  getDeepResearchPlanMeta,
} from "./DeepResearchPlanCard";
import {
  DeepResearchProgressCard,
  getDeepResearchProgressMeta,
} from "./DeepResearchProgressCard";
import type { DeepResearchTaskMeta } from "./DeepResearchTaskCard";

interface DeepResearchPanelProps {
  task: DeepResearchTaskMeta;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

type PanelAction = "modify_plan" | "follow_up";

interface DeepResearchReference {
  messageId: string;
  interactionId: string;
  kind: "plan" | "report";
  status?: string;
}

interface DeepResearchRuntimeState {
  kind?: "plan" | "report";
  status?: string;
  phase?: string;
}

type ChannelTFunction = TFunction<"channel">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sortChronologically(messages: readonly Message[]) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return left.id.localeCompare(right.id);
    }
    return leftTime - rightTime;
  });
}

function getDeepResearchReference(
  message: Message,
): DeepResearchReference | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const deepResearch = isRecord(metadata?.deepResearch)
    ? metadata.deepResearch
    : null;
  if (!deepResearch) return null;

  const kind = deepResearch.kind;
  if (kind !== "plan" && kind !== "report") return null;

  const interactionId =
    stringValue(deepResearch.interactionId) ??
    stringValue(deepResearch.interaction_id) ??
    stringValue(deepResearch.id);
  if (!interactionId) return null;

  return {
    messageId: message.id,
    interactionId,
    kind,
    ...(stringValue(deepResearch.status)
      ? { status: stringValue(deepResearch.status) }
      : {}),
  };
}

function getDeepResearchRuntimeState(
  message: Message,
): DeepResearchRuntimeState | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const deepResearch = isRecord(metadata?.deepResearch)
    ? metadata.deepResearch
    : null;
  if (!deepResearch) return null;

  const kind = deepResearch.kind;
  return {
    ...(kind === "plan" || kind === "report" ? { kind } : {}),
    ...(stringValue(deepResearch.status)
      ? { status: stringValue(deepResearch.status) }
      : {}),
    ...(stringValue(deepResearch.phase)
      ? { phase: stringValue(deepResearch.phase) }
      : {}),
  };
}

function getDeepResearchTaskId(message: Message): string | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const deepResearch = isRecord(metadata?.deepResearch)
    ? metadata.deepResearch
    : null;
  return (
    stringValue(deepResearch?.taskId) ??
    stringValue(deepResearch?.interactionId) ??
    stringValue(deepResearch?.interaction_id) ??
    null
  );
}

function isTerminalDeepResearchMessage(message: Message): boolean {
  const state = getDeepResearchRuntimeState(message);
  return (
    state?.status === "completed" ||
    state?.status === "failed" ||
    state?.phase === "completed" ||
    state?.phase === "plan_ready" ||
    state?.phase === "failed"
  );
}

function isPendingDeepResearchMessage(message: Message): boolean {
  const state = getDeepResearchRuntimeState(message);
  return Boolean(state) && !isTerminalDeepResearchMessage(message);
}

function hideSupersededProgressMessages(messages: readonly Message[]) {
  const terminalTasks = new Set<string>();
  for (const message of messages) {
    const taskId = getDeepResearchTaskId(message);
    if (taskId && isTerminalDeepResearchMessage(message)) {
      terminalTasks.add(taskId);
    }
  }

  return messages.filter((message) => {
    const taskId = getDeepResearchTaskId(message);
    return !(
      taskId &&
      terminalTasks.has(taskId) &&
      isPendingDeepResearchMessage(message)
    );
  });
}

function getLatestDeepResearchReference(
  messages: readonly Message[],
): DeepResearchReference | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const reference = getDeepResearchReference(messages[index]);
    if (reference && reference.status !== "failed") return reference;
  }
  return null;
}

function getLatestDeepResearchRuntimeState(
  messages: readonly Message[],
): DeepResearchRuntimeState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const state = getDeepResearchRuntimeState(messages[index]);
    if (state) return state;
  }
  return null;
}

function getPanelInputState(
  task: DeepResearchTaskMeta,
  reference: DeepResearchReference | null,
  runtimeState: DeepResearchRuntimeState | null,
  t: ChannelTFunction,
): {
  action: PanelAction | null;
  disabled: boolean;
  placeholder: string;
} {
  const effectiveKind = runtimeState?.kind ?? task.kind;
  const effectiveStatus = runtimeState?.status ?? task.status;
  const effectivePhase = runtimeState?.phase ?? task.phase;

  if (!reference) {
    return {
      action: null,
      disabled: true,
      placeholder: t("deepResearch.input.waitingForContext"),
    };
  }

  if (
    effectiveKind === "report" &&
    effectiveStatus !== "completed" &&
    effectivePhase !== "completed" &&
    effectiveStatus !== "failed"
  ) {
    return {
      action: null,
      disabled: true,
      placeholder: t("deepResearch.input.waitingForReport"),
    };
  }

  if (
    effectiveKind === "plan" &&
    effectiveStatus !== "completed" &&
    effectivePhase !== "plan_ready" &&
    effectiveStatus !== "failed"
  ) {
    return {
      action: null,
      disabled: true,
      placeholder: t("deepResearch.input.generatingPlan"),
    };
  }

  if (task.status === "plan_ready" || reference.kind === "plan") {
    return {
      action: "modify_plan",
      disabled: false,
      placeholder: t("deepResearch.input.modifyPlan"),
    };
  }

  return {
    action: "follow_up",
    disabled: false,
    placeholder: t("deepResearch.input.followUp"),
  };
}

function upsertMessage(messages: readonly Message[], next: Message): Message[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [next, ...messages];
  return messages.map((message) => (message.id === next.id ? next : message));
}

function getPanelStatus(
  task: DeepResearchTaskMeta,
  messages: readonly Message[],
  t: ChannelTFunction,
) {
  const chronological = sortChronologically(messages);
  const latest = chronological[chronological.length - 1];
  const progress = getDeepResearchProgressMeta(latest?.metadata);
  const plan = getDeepResearchPlanMeta(latest?.metadata);
  if (progress?.status === "failed" || task.status === "failed") {
    return t("deepResearch.panel.status.failed");
  }
  if (progress?.status === "completed" || task.status === "completed") {
    return t("deepResearch.panel.status.completed");
  }
  if (plan || task.status === "plan_ready") {
    return t("deepResearch.panel.status.planReady");
  }
  return task.kind === "plan" || task.phase === "planning"
    ? t("deepResearch.panel.status.generatingPlan")
    : t("deepResearch.panel.status.running");
}

function hasProgressDetails(
  meta: NonNullable<ReturnType<typeof getDeepResearchProgressMeta>>,
) {
  const progress = meta.progress;
  return Boolean(
    progress &&
    (progress.thoughts.length > 0 ||
      progress.sources.length > 0 ||
      progress.visuals.length > 0 ||
      progress.queries.length > 0),
  );
}

function getPanelProgressText(
  meta: NonNullable<ReturnType<typeof getDeepResearchProgressMeta>>,
  t: ChannelTFunction,
) {
  const phase = meta.progress?.phase ?? meta.phase;
  if (meta.status === "failed" || phase === "failed") {
    return t("deepResearch.panel.status.failed");
  }
  if (meta.status === "completed" || phase === "completed") {
    return t("deepResearch.panel.status.reportCompleted");
  }
  if (meta.progress?.activeStep) return meta.progress.activeStep;
  if (phase === "submitted") return t("deepResearch.panel.status.submitted");
  if (phase === "answering") return t("deepResearch.panel.status.answering");
  if (phase === "synthesizing") {
    return t("deepResearch.panel.status.synthesizing");
  }
  if (phase === "planning") return t("deepResearch.panel.status.planning");
  return t("deepResearch.panel.status.inProgress");
}

function isGenericProgressContent(
  content: string | undefined,
  t: ChannelTFunction,
) {
  const text = content?.trim();
  if (!text) return false;
  return new Set([
    "已开始执行深度研究...",
    "正在生成研究计划...",
    "正在生成报告...",
    "正在进行深度研究...",
    t("deepResearch.input.generatingPlan"),
    t("deepResearch.panel.status.submitted"),
    t("deepResearch.panel.status.answering"),
    t("deepResearch.panel.status.synthesizing"),
    t("deepResearch.panel.status.inProgress"),
    `${t("deepResearch.panel.status.generatingPlan")}...`,
  ]).has(text);
}

function DeepResearchPanelStatus({
  meta,
  t,
}: {
  meta: NonNullable<ReturnType<typeof getDeepResearchProgressMeta>>;
  t: ChannelTFunction;
}) {
  const failed = meta.status === "failed" || meta.phase === "failed";
  const completed = meta.status === "completed" || meta.phase === "completed";
  const statusText = getPanelProgressText(meta, t);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm",
        failed
          ? "border-destructive/30 text-destructive"
          : "border-border text-muted-foreground",
      )}
    >
      {!completed && !failed && (
        <Loader2 className="size-4 shrink-0 animate-spin text-info" />
      )}
      <span className="min-w-0 break-words">{statusText}</span>
    </div>
  );
}

function DeepResearchPanelMessage({
  message,
  interactivePlanMessageId,
  t,
}: {
  message: Message;
  interactivePlanMessageId?: string | null;
  t: ChannelTFunction;
}) {
  const planMeta = getDeepResearchPlanMeta(message.metadata);
  if (planMeta) {
    const interactive =
      interactivePlanMessageId === undefined
        ? true
        : interactivePlanMessageId === message.id;
    return (
      <div className="py-2">
        <DeepResearchPlanCard
          message={message}
          className="max-w-none"
          interactive={interactive}
        />
      </div>
    );
  }

  const progressMeta = getDeepResearchProgressMeta(message.metadata);
  const hasContent = Boolean(message.content?.trim());
  const isCompletedProgress =
    progressMeta?.status === "completed" || progressMeta?.phase === "completed";
  const showProgressDetails = progressMeta && hasProgressDetails(progressMeta);
  const showCompactProgress = progressMeta && !showProgressDetails;
  const showContent =
    hasContent &&
    !(
      progressMeta &&
      !isCompletedProgress &&
      isGenericProgressContent(message.content, t)
    );

  return (
    <div className="py-2">
      {showProgressDetails && (
        <DeepResearchProgressCard
          meta={progressMeta}
          isStreaming={progressMeta.status !== "completed"}
          className="max-w-none"
        />
      )}
      {showCompactProgress && (
        <DeepResearchPanelStatus meta={progressMeta} t={t} />
      )}
      {showContent && (
        <div
          className={cn(
            "rounded-md border border-border bg-background px-4 py-3 text-sm",
            (showProgressDetails || showCompactProgress) && "mt-3",
          )}
        >
          <MessageContent
            content={message.content}
            message={message}
            className="prose prose-sm max-w-none dark:prose-invert"
          />
        </div>
      )}
    </div>
  );
}

export function DeepResearchPanel({
  task,
  width,
  onWidthChange,
  onClose,
}: DeepResearchPanelProps) {
  const { t } = useTranslation("channel");
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["deep-research-session-context", task.childChannelId] as const,
    [task.childChannelId],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => imApi.deepResearchSessions.getContext(task.childChannelId),
    enabled: Boolean(task.childChannelId),
  });
  const { refetch } = query;
  const messages = useMemo(
    () => sortChronologically(query.data?.messages ?? []),
    [query.data?.messages],
  );
  const shouldPollContext = useMemo(
    () =>
      task.status === "running" ||
      messages.some((message) => isPendingDeepResearchMessage(message)),
    [messages, task.status],
  );
  const visibleMessages = useMemo(
    () => hideSupersededProgressMessages(messages),
    [messages],
  );
  const status = getPanelStatus(task, messages, t);
  const latestReference = useMemo(
    () => getLatestDeepResearchReference(messages),
    [messages],
  );
  const latestRuntimeState = useMemo(
    () => getLatestDeepResearchRuntimeState(messages),
    [messages],
  );
  const inputState = getPanelInputState(
    task,
    latestReference,
    latestRuntimeState,
    t,
  );
  const interactivePlanMessageId =
    inputState.action === "modify_plan" ? latestReference?.messageId : null;

  useEffect(() => {
    if (!shouldPollContext || !task.childChannelId) return;
    const timer = window.setInterval(() => {
      void refetch();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refetch, shouldPollContext, task.childChannelId]);

  const handleSendFollowUp = async (
    payload: { content: string; contentAst?: Record<string, unknown> },
    attachments?: AttachmentDto[],
  ) => {
    const content = payload.content.trim();
    if (!content || !latestReference || !inputState.action) return;

    const userMessage = await imApi.messages.sendMessage(task.childChannelId, {
      content,
      contentAst: payload.contentAst,
      attachments,
      metadata: {
        deepResearchSessionRef: {
          childChannelId: task.childChannelId,
          ...(task.parentChannelId
            ? { parentChannelId: task.parentChannelId }
            : {}),
          ...(task.parentMessageId
            ? { parentMessageId: task.parentMessageId }
            : {}),
          agentWakePolicy: "none",
        },
        deepResearchPanelInput: {
          source: "team9",
          action: inputState.action,
        },
      },
    });

    queryClient.setQueryData<DeepResearchSessionContextResponse>(
      queryKey,
      (old) => ({
        channelId: task.childChannelId,
        messages: upsertMessage(old?.messages ?? [], userMessage),
      }),
    );

    await imApi.deepResearchSessions.action(task.childChannelId, {
      action: inputState.action,
      planMessageId: latestReference.messageId,
      planInteractionId: latestReference.interactionId,
      input: content,
    });
  };

  useEffect(() => {
    const handleNewMessage = (message: Message) => {
      if (message.channelId !== task.childChannelId) return;
      queryClient.setQueryData<DeepResearchSessionContextResponse>(
        queryKey,
        (old) => ({
          channelId: task.childChannelId,
          messages: upsertMessage(old?.messages ?? [], message),
        }),
      );
    };
    const handleMessageUpdated = (message: Message) => {
      if (message.channelId !== task.childChannelId) return;
      queryClient.setQueryData<DeepResearchSessionContextResponse>(
        queryKey,
        (old) => ({
          channelId: task.childChannelId,
          messages: upsertMessage(old?.messages ?? [], message),
        }),
      );
    };

    wsService.onNewMessage(handleNewMessage);
    wsService.onMessageUpdated(handleMessageUpdated);
    return () => {
      wsService.off("new_message", handleNewMessage);
      wsService.off("message_updated", handleMessageUpdated);
    };
  }, [queryClient, queryKey, task.childChannelId]);

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-background"
      style={{ width }}
    >
      <ResizeHandle
        width={width}
        onWidthChange={onWidthChange}
        minWidth={420}
        maxWidth={760}
      />
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("deepResearch.title")}
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold">{task.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{status}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/15 px-4 py-3">
        {query.isLoading ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("deepResearch.panel.loading")}
          </div>
        ) : query.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div>{t("deepResearch.panel.loadFailed")}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className="size-4" />
              {t("deepResearch.panel.retry")}
            </Button>
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            {t("deepResearch.panel.noUpdates")}
          </div>
        ) : (
          visibleMessages.map((message) => (
            <DeepResearchPanelMessage
              key={message.id}
              message={message}
              interactivePlanMessageId={interactivePlanMessageId}
              t={t}
            />
          ))
        )}
      </div>
      <MessageInput
        channelId={task.childChannelId}
        compact
        disabled={inputState.disabled || query.isLoading}
        placeholder={inputState.placeholder}
        onSend={handleSendFollowUp}
      />
    </aside>
  );
}
