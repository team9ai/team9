import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAgentSessionControls } from "@/hooks/useAgentSessionControls";
import type {
  AgentSessionBinding,
  SafeSessionComponentsResponse,
} from "@/types/im";
import { ResizeHandle } from "../ResizeHandle";
import { AgentSessionStatusHeader } from "./AgentSessionStatusHeader";
import { SessionComponentList } from "./SessionComponentList";
import { SessionTodoSection } from "./SessionTodoSection";
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
  const [debugOpen, setDebugOpen] = useState(false);
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);
  const controls = useAgentSessionControls(
    binding.supported ? binding.channelId : null,
  );
  const controlError = controls.pauseError ?? controls.resumeError;
  const isManuallyPaused =
    binding.sessionId !== null && pausedSessionId === binding.sessionId;

  const handlePause = () => {
    if (!binding.sessionId) return;
    void controls
      .pauseAsync()
      .then(() => setPausedSessionId(binding.sessionId))
      .catch(() => undefined);
  };

  const handleResume = () => {
    void controls
      .resumeAsync()
      .then(() => setPausedSessionId(null))
      .catch(() => undefined);
  };

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
          <AgentSessionStatusHeader
            binding={binding}
            debugOpen={debugOpen}
            isManuallyPaused={isManuallyPaused}
            isPausing={controls.isPausing}
            isResuming={controls.isResuming}
            onPause={handlePause}
            onResume={handleResume}
            onToggleDebug={() => setDebugOpen((value) => !value)}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            {controlError && (
              <p className="border-b border-border px-3 py-2 text-xs text-destructive">
                Session control failed
              </p>
            )}
            <SessionTodoSection components={components} />
            {debugOpen && (
              <>
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
                  <SessionComponentList
                    components={components}
                    sessionId={components?.sessionId ?? binding.sessionId}
                  />
                )}
              </>
            )}
            <TaskContextSection binding={binding} />
            <TrackingContextSection binding={binding} />
          </div>
        </>
      )}
    </aside>
  );
}
