import { Badge } from "@/components/ui/badge";
import { getAgentTypeLabel } from "@/lib/agent-type";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/types/im";

interface AgentTypeBadgeProps {
  agentType?: AgentType | null;
  className?: string;
}

function getAgentTypeColor(agentType: AgentType | null | undefined): string {
  if (agentType === "openclaw") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (agentType === "base_model") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-border/60 bg-background/80 text-muted-foreground";
}

export function AgentTypeBadge({ agentType, className }: AgentTypeBadgeProps) {
  const label = getAgentTypeLabel(agentType);

  if (!label) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn(
        "h-5 shrink-0 rounded-md px-1.5 text-[10px] font-medium",
        getAgentTypeColor(agentType),
        className,
      )}
    >
      {label}
    </Badge>
  );
}
