import { Badge } from "@/components/ui/badge";
import type { AgentSessionBinding } from "@/types/im";

export function TaskContextSection({
  binding,
}: {
  binding: AgentSessionBinding;
}) {
  if (binding.kind !== "routine-execution") return null;

  return (
    <div className="border-t border-border px-3 py-3 text-xs">
      <div className="mb-2 font-medium">Task</div>
      <div className="space-y-1 text-muted-foreground">
        {binding.taskStatus && (
          <Badge variant="outline">{binding.taskStatus}</Badge>
        )}
        {binding.routineId && (
          <div className="truncate">Routine: {binding.routineId}</div>
        )}
        {binding.executionId && (
          <div className="truncate">Execution: {binding.executionId}</div>
        )}
      </div>
    </div>
  );
}
