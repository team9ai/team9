import { Activity, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentSessionBinding } from "@/types/im";

export function AgentSessionStatusHeader({
  binding,
}: {
  binding: AgentSessionBinding;
}) {
  const state = binding.status?.activityState ?? "inactive";

  return (
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Agent Session</h2>
        <Badge
          variant={state === "active" ? "default" : "outline"}
          className="ml-auto"
        >
          {state}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Circle className="size-2 fill-current" />
        <span className="truncate">{binding.kind ?? binding.channelType}</span>
      </div>
    </div>
  );
}
