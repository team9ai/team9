import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SafeSessionComponentItem } from "@/types/im";

function formatSnapshotData(data: unknown): string {
  return JSON.stringify(data, null, 2) ?? "undefined";
}

export function SessionComponentRow({
  component,
}: {
  component: SafeSessionComponentItem;
}) {
  const [open, setOpen] = useState(true);
  const hasSnapshot = component.latestData !== null;
  const data = component.latestData?.data;

  return (
    <div className="border-b border-border/60 py-2 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {component.id}
        </span>
        {component.runtimeInjectedOnly && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            injected
          </Badge>
        )}
        {open ? (
          <ChevronUp className="size-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3 text-muted-foreground" />
        )}
      </button>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-muted/30 p-2 text-[11px] leading-4 text-muted-foreground">
          {hasSnapshot ? formatSnapshotData(data) : "No snapshot yet"}
        </pre>
      )}
    </div>
  );
}
