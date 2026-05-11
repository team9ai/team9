import { Loader2 } from "lucide-react";
import type {
  AgentSessionBinding,
  SafeSessionComponentsResponse,
} from "@/types/im";
import { ResizeHandle } from "../ResizeHandle";
import { AgentSessionStatusHeader } from "./AgentSessionStatusHeader";
import { SessionComponentList } from "./SessionComponentList";
import { TaskContextSection } from "./TaskContextSection";
import { TrackingContextSection } from "./TrackingContextSection";

interface AgentSessionPanelProps {
  binding: AgentSessionBinding;
  components: SafeSessionComponentsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}

export function AgentSessionPanel({
  binding,
  components,
  isLoading,
  isError,
  width,
  onWidthChange,
}: AgentSessionPanelProps) {
  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-background"
      style={{ width }}
    >
      <ResizeHandle
        width={width}
        onWidthChange={onWidthChange}
        minWidth={300}
        maxWidth={520}
      />
      {!binding.supported ? (
        <div className="p-4">
          <h2 className="text-sm font-semibold">Runtime details unavailable</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {binding.unsupportedReason ?? "unsupported"}
          </p>
        </div>
      ) : (
        <>
          <AgentSessionStatusHeader binding={binding} />
          {isLoading && (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading components
            </div>
          )}
          {isError && (
            <p className="p-3 text-xs text-destructive">
              Failed to load component data
            </p>
          )}
          {!isLoading && !isError && (
            <SessionComponentList components={components} />
          )}
          <TaskContextSection binding={binding} />
          <TrackingContextSection binding={binding} />
        </>
      )}
    </aside>
  );
}
