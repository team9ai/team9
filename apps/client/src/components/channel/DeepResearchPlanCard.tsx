import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  ListFilter,
  Pencil,
  Play,
  RefreshCw,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import imApi from "@/services/api/im";
import type { Message } from "@/types/im";

type DeepResearchAction = "modify_plan" | "start_research";

interface DeepResearchPlanMeta {
  interactionId: string;
  taskId?: string;
  session?: {
    childChannelId: string;
    parentChannelId?: string;
  };
}

interface DeepResearchPlanCardProps {
  message: Message;
  className?: string;
  interactive?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getDeepResearchPlanMeta(
  metadata: Message["metadata"],
): DeepResearchPlanMeta | null {
  const deepResearch = isRecord(metadata?.deepResearch)
    ? metadata.deepResearch
    : null;
  if (!deepResearch || deepResearch.kind !== "plan") {
    return null;
  }

  const interactionId = deepResearch.interactionId;
  if (typeof interactionId !== "string" || !interactionId.trim()) {
    return null;
  }

  const taskId = deepResearch.taskId;
  const sessionRecord = isRecord(deepResearch.session)
    ? deepResearch.session
    : isRecord(metadata?.deepResearchSessionRef)
      ? metadata.deepResearchSessionRef
      : null;
  const childChannelId =
    typeof sessionRecord?.childChannelId === "string" &&
    sessionRecord.childChannelId.trim()
      ? sessionRecord.childChannelId.trim()
      : undefined;
  const parentChannelId =
    typeof sessionRecord?.parentChannelId === "string" &&
    sessionRecord.parentChannelId.trim()
      ? sessionRecord.parentChannelId.trim()
      : undefined;
  return {
    interactionId: interactionId.trim(),
    ...(typeof taskId === "string" && taskId.trim()
      ? { taskId: taskId.trim() }
      : {}),
    ...(childChannelId
      ? {
          session: {
            childChannelId,
            ...(parentChannelId ? { parentChannelId } : {}),
          },
        }
      : {}),
  };
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

type PlanLabel = "title" | "input" | "plan";

function getPlanLabel(
  line: string,
): { label: PlanLabel; value: string } | null {
  const match = stripMarkdownInline(line).match(
    /^(title|标题|input|输入|research\s+plan|研究计划|研究方案)\s*[:：]\s*(.*)$/i,
  );
  if (!match?.[1]) {
    return null;
  }

  const rawLabel = match[1].toLowerCase().replace(/\s+/g, " ");
  const value = match[2]?.trim() ?? "";
  if (rawLabel === "title" || rawLabel === "标题") {
    return { label: "title", value };
  }
  if (rawLabel === "input" || rawLabel === "输入") {
    return { label: "input", value };
  }
  return { label: "plan", value };
}

function extractTitle(content: string, fallback: string): string {
  const heading = content.match(/^\s{0,3}#{1,3}\s+(.+)$/m)?.[1];
  if (heading) {
    return stripMarkdownInline(heading);
  }

  for (const line of content.split(/\r?\n/)) {
    const labeled = getPlanLabel(line);
    if (labeled?.label === "title" && labeled.value) {
      return stripMarkdownInline(labeled.value);
    }
  }

  return fallback;
}

function extractInput(content: string, fallback: string): string {
  for (const line of content.split(/\r?\n/)) {
    const labeled = getPlanLabel(line);
    if (labeled?.label === "input" && labeled.value) {
      return stripMarkdownInline(labeled.value);
    }
  }

  return fallback;
}

function cleanPlanLine(line: string): string {
  return stripMarkdownInline(
    line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*(?:\(\d+\)|\d+[.)])\s+/, ""),
  );
}

function extractPlanLines(content: string, title: string): string[] {
  const normalizedTitle = title.trim();
  const rawLines = content.split(/\r?\n/);
  const planStartIndex = rawLines.findIndex(
    (line) => getPlanLabel(line)?.label === "plan",
  );
  const sourceLines =
    planStartIndex >= 0 ? rawLines.slice(planStartIndex) : rawLines;

  return sourceLines
    .flatMap((line, index) => {
      const labeled = getPlanLabel(line);
      if (!labeled) {
        return [cleanPlanLine(line)];
      }
      if (labeled.label === "plan" && index === 0 && labeled.value) {
        return [cleanPlanLine(labeled.value)];
      }
      return [];
    })
    .filter((line) => line && line !== normalizedTitle)
    .filter((line) => !/^[-*_]{3,}$/.test(line))
    .slice(0, 10);
}

function PlanStep({
  icon: Icon,
  title,
  children,
  isLast = false,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="grid grid-cols-[36px_1fr] gap-x-3">
      <div className="relative flex justify-center">
        <div className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="size-4" />
        </div>
        {!isLast && (
          <div className="absolute top-8 bottom-[-18px] w-px bg-border" />
        )}
      </div>
      <div className="min-w-0 pb-5">
        <div className="mb-2 font-medium">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function DeepResearchPlanCard({
  message,
  className,
  interactive = true,
}: DeepResearchPlanCardProps) {
  const { t } = useTranslation("channel");
  const [expanded, setExpanded] = useState(false);
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [planInstruction, setPlanInstruction] = useState("");
  const [pendingAction, setPendingAction] = useState<DeepResearchAction | null>(
    null,
  );
  const [isRetryingWithoutDeepResearch, setIsRetryingWithoutDeepResearch] =
    useState(false);
  const planMeta = getDeepResearchPlanMeta(message.metadata);
  const title = useMemo(
    () => extractTitle(message.content, t("deepResearch.plan.fallbackTitle")),
    [message.content, t],
  );
  const retryInput = useMemo(
    () => extractInput(message.content, title),
    [message.content, title],
  );
  const planLines = useMemo(
    () => extractPlanLines(message.content, title),
    [message.content, title],
  );
  const visiblePlanLines = expanded ? planLines : planLines.slice(0, 4);
  const canAct = Boolean(
    planMeta?.interactionId && planMeta.session?.childChannelId,
  );
  const retryChannelId =
    planMeta?.session?.parentChannelId ?? message.channelId;

  const handleAction = async (
    action: DeepResearchAction,
    instruction?: string,
  ) => {
    if (
      !planMeta?.interactionId ||
      !planMeta.session?.childChannelId ||
      pendingAction
    ) {
      return;
    }
    setPendingAction(action);
    try {
      const input =
        action === "modify_plan"
          ? instruction?.trim() || t("deepResearch.plan.actionInput.modify")
          : t("deepResearch.plan.actionInput.start");
      await imApi.deepResearchSessions.action(planMeta.session.childChannelId, {
        action,
        planMessageId: message.id,
        planInteractionId: planMeta.interactionId,
        input,
      });
      if (action === "modify_plan") {
        setPlanInstruction("");
        setIsEditingPlan(false);
      }
    } finally {
      setPendingAction(null);
    }
  };

  const handleRetryWithoutDeepResearch = async () => {
    if (!retryChannelId || isRetryingWithoutDeepResearch) return;
    setIsRetryingWithoutDeepResearch(true);
    try {
      const bypass: Record<string, unknown> = {
        source: "team9",
        planMessageId: message.id,
      };
      if (planMeta?.interactionId) {
        bypass.planInteractionId = planMeta.interactionId;
      }
      if (planMeta?.session?.childChannelId) {
        bypass.childChannelId = planMeta.session.childChannelId;
      }

      await imApi.messages.sendMessage(retryChannelId, {
        content: t("deepResearch.plan.actionInput.retryWithout", {
          input: retryInput,
        }),
        metadata: {
          deepResearchBypass: bypass,
        },
      });
    } finally {
      setIsRetryingWithoutDeepResearch(false);
    }
  };

  return (
    <div
      className={cn(
        "w-full max-w-3xl rounded-md border border-border bg-muted/20 px-4 py-3 text-sm",
        className,
      )}
    >
      <p className="mb-3 text-muted-foreground">
        {t("deepResearch.plan.intro")}
      </p>

      <div className="mb-3 font-semibold text-base text-foreground">
        {title}
      </div>

      <div>
        <PlanStep icon={Search} title={t("deepResearch.plan.steps.websites")}>
          {visiblePlanLines.length > 0 && (
            <div className="space-y-1.5 text-muted-foreground">
              {visiblePlanLines.map((line, index) => (
                <div key={`${index}-${line}`} className="break-words">
                  {line}
                </div>
              ))}
            </div>
          )}
          {planLines.length > 4 && (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 text-info hover:underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <>
                  {t("deepResearch.plan.collapse")}{" "}
                  <ChevronUp className="size-4" />
                </>
              ) : (
                <>
                  {t("deepResearch.plan.more")}{" "}
                  <ChevronDown className="size-4" />
                </>
              )}
            </button>
          )}
        </PlanStep>

        <PlanStep
          icon={ListFilter}
          title={t("deepResearch.plan.steps.analyze")}
        />

        <PlanStep icon={FileText} title={t("deepResearch.plan.steps.report")} />

        <PlanStep
          icon={Clock3}
          title={t("deepResearch.plan.steps.estimate")}
          isLast
        />
      </div>

      {interactive && isEditingPlan && (
        <div className="mt-4 border-t border-border pt-3">
          <Textarea
            value={planInstruction}
            onChange={(event) => setPlanInstruction(event.target.value)}
            rows={3}
            placeholder={t("deepResearch.plan.editPlaceholder")}
            className="min-h-20 resize-none bg-background"
          />
        </div>
      )}

      {interactive && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pendingAction !== null || isRetryingWithoutDeepResearch}
            onClick={() => void handleRetryWithoutDeepResearch()}
          >
            <RefreshCw className="size-4" />
            {t("deepResearch.plan.retryWithout")}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAct || pendingAction !== null}
              onClick={() => {
                if (!isEditingPlan) {
                  setIsEditingPlan(true);
                  return;
                }
                void handleAction("modify_plan", planInstruction);
              }}
            >
              <Pencil className="size-4" />
              {isEditingPlan
                ? t("deepResearch.plan.submitEdit")
                : t("deepResearch.plan.modify")}
            </Button>
            {isEditingPlan && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => {
                  setIsEditingPlan(false);
                  setPlanInstruction("");
                }}
              >
                {t("deepResearch.plan.cancel")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={!canAct || pendingAction !== null}
              onClick={() => void handleAction("start_research")}
            >
              <Play className="size-4" />
              {t("deepResearch.plan.start")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
