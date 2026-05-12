import type { AgentSessionBinding } from "@/types/im";

export function TrackingContextSection({
  binding,
}: {
  binding: AgentSessionBinding;
}) {
  if (binding.kind !== "tracking") return null;

  return (
    <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground">Tracking</div>
      <div className="truncate">Channel: {binding.channelId}</div>
    </div>
  );
}
