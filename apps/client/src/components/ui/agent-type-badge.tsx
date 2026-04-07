import { Badge } from "@/components/ui/badge";
import { getAgentTypeLabel } from "@/lib/agent-type";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/types/im";

interface AgentTypeBadgeProps {
  agentType?: AgentType | null;
  className?: string;
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
        "h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {label}
    </Badge>
  );
}
