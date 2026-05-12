import type { MouseEvent } from "react";
import { Activity, Circle, Pause, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentSessionBinding } from "@/types/im";

export function AgentSessionStatusHeader({
  binding,
  debugOpen,
  isManuallyPaused,
  isPausing,
  isResuming,
  onPause,
  onResume,
  onToggleDebug,
}: {
  binding: AgentSessionBinding;
  debugOpen: boolean;
  isManuallyPaused: boolean;
  isPausing: boolean;
  isResuming: boolean;
  onPause: () => void;
  onResume: () => void;
  onToggleDebug: () => void;
}) {
  const state = binding.status?.activityState ?? "inactive";
  const isRunning = state === "active";
  const isMutating = isPausing || isResuming;

  const handleTitleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!event.altKey) return;
    onToggleDebug();
  };

  return (
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <button
          type="button"
          className="cursor-default border-0 bg-transparent p-0 text-left text-sm font-semibold"
          aria-pressed={debugOpen}
          onClick={handleTitleClick}
        >
          Agent Session
        </button>
        <Badge
          variant={state === "active" ? "default" : "outline"}
          className="ml-auto"
        >
          {isManuallyPaused ? "已暂停" : isRunning ? "运行中" : "未运行"}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Circle className="size-2 fill-current" />
            <span className="truncate">
              {binding.kind ?? binding.channelType}
            </span>
          </div>
          <div className="mt-1">队列 {binding.status?.queueLength ?? 0}</div>
        </div>
        {isManuallyPaused ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={isMutating || !binding.sessionId}
            onClick={onResume}
          >
            <Play className="size-3" />
            恢复
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={isMutating || !binding.sessionId}
            onClick={onPause}
          >
            <Pause className="size-3" />
            暂停
          </Button>
        )}
      </div>
    </div>
  );
}
