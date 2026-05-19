import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  ListFilter,
  Pencil,
  Play,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSendMessage } from "@/hooks/useMessages";
import type { Message } from "@/types/im";

type DeepResearchAction = "modify_plan" | "start_research";

interface DeepResearchPlanMeta {
  interactionId: string;
  taskId?: string;
}

interface DeepResearchPlanCardProps {
  message: Message;
  className?: string;
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
  return {
    interactionId: interactionId.trim(),
    ...(typeof taskId === "string" && taskId.trim()
      ? { taskId: taskId.trim() }
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

function extractTitle(content: string): string {
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

  return "研究方案";
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

export function DeepResearchPlanCard({
  message,
  className,
}: DeepResearchPlanCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<DeepResearchAction | null>(
    null,
  );
  const sendMessage = useSendMessage(message.channelId);
  const planMeta = getDeepResearchPlanMeta(message.metadata);
  const title = useMemo(() => extractTitle(message.content), [message.content]);
  const planLines = useMemo(
    () => extractPlanLines(message.content, title),
    [message.content, title],
  );
  const visiblePlanLines = expanded ? planLines : planLines.slice(0, 4);
  const canAct = Boolean(planMeta?.interactionId);

  const handleAction = async (action: DeepResearchAction) => {
    if (!planMeta?.interactionId || pendingAction) return;
    setPendingAction(action);
    try {
      await sendMessage.mutateAsync({
        content: action === "modify_plan" ? "修改研究方案" : "开始研究",
        ...(message.parentId ? { parentId: message.parentId } : {}),
        metadata: {
          deepResearchAction: {
            source: "team9",
            action,
            planInteractionId: planMeta.interactionId,
            planMessageId: message.id,
            ...(planMeta.taskId ? { taskId: planMeta.taskId } : {}),
          },
        },
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div
      className={cn(
        "w-full max-w-3xl rounded-md border border-border bg-muted/30 px-4 py-3 text-sm",
        className,
      )}
    >
      <p className="mb-3 text-muted-foreground">
        这是我拟定的方案。如果你需要进行任何改动，请在我开始研究前告诉我。
      </p>

      <div className="mb-3 font-semibold text-base text-foreground">
        {title}
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[24px_1fr] gap-x-3">
          <Search className="mt-0.5 size-5 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">研究网站</div>
            {visiblePlanLines.length > 0 && (
              <div className="mt-2 space-y-1.5 text-muted-foreground">
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
                    收起 <ChevronUp className="size-4" />
                  </>
                ) : (
                  <>
                    更多 <ChevronDown className="size-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[24px_1fr] gap-x-3">
          <ListFilter className="mt-0.5 size-5 text-muted-foreground" />
          <div className="font-medium">分析结果</div>
        </div>

        <div className="grid grid-cols-[24px_1fr] gap-x-3">
          <FileText className="mt-0.5 size-5 text-muted-foreground" />
          <div className="font-medium">生成报告</div>
        </div>

        <div className="grid grid-cols-[24px_1fr] gap-x-3">
          <Clock3 className="mt-0.5 size-5 text-muted-foreground" />
          <div className="text-muted-foreground">只需要几分钟就可以准备好</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAct || pendingAction !== null}
          onClick={() => void handleAction("modify_plan")}
        >
          <Pencil className="size-4" />
          修改方案
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canAct || pendingAction !== null}
          onClick={() => void handleAction("start_research")}
        >
          <Play className="size-4" />
          开始研究
        </Button>
      </div>
    </div>
  );
}
