import { useState } from "react";
import { useDebugStore } from "@/stores/useDebugStore";
import { Play, Syringe, StepForward, RotateCcw, Zap } from "lucide-react";

export function AgentControls() {
  const {
    currentAgent,
    injectEvent,
    executionModeStatus,
    setExecutionMode,
    step,
    isStepping,
    lastStepResult,
  } = useDebugStore();
  const [showInjectModal, setShowInjectModal] = useState(false);

  if (!currentAgent) return null;

  const executionMode = executionModeStatus?.mode ?? "auto";
  const isCompleted = currentAgent.status === "completed";
  const isError = currentAgent.status === "error";
  const isStepMode = executionMode === "stepping";

  const hasPendingWork =
    (executionModeStatus?.queuedEventCount ?? 0) > 0 ||
    executionModeStatus?.hasPendingCompaction;

  return (
    <div className="flex items-center gap-3">
      {/* Execution mode toggle: Auto | Step */}
      {!isCompleted && !isError && (
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <button
            onClick={() => setExecutionMode("auto")}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              !isStepMode ? "bg-green-600 text-white" : "hover:bg-muted"
            }`}
            title="Auto: events are processed automatically"
          >
            <Play className="h-3 w-3" />
            Auto
          </button>
          <button
            onClick={() => setExecutionMode("stepping")}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              isStepMode ? "bg-blue-600 text-white" : "hover:bg-muted"
            }`}
            title="Step: manually step through events one at a time"
          >
            <StepForward className="h-3 w-3" />
            Step
          </button>
        </div>
      )}

      {/* Step execution button (only in stepping mode) */}
      {isStepMode && (
        <button
          onClick={step}
          disabled={isStepping || !hasPendingWork}
          className="flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
          title={
            hasPendingWork
              ? `${executionModeStatus?.queuedEventCount ?? 0} events queued${executionModeStatus?.hasPendingCompaction ? ", compaction pending" : ""}`
              : "No pending events"
          }
        >
          <Zap className="h-4 w-4" />
          {isStepping ? "Stepping..." : "Next"}
          {hasPendingWork && (
            <span className="ml-1 rounded-full bg-blue-600 px-1.5 text-xs text-white">
              {executionModeStatus?.queuedEventCount ?? 0}
              {executionModeStatus?.hasPendingCompaction ? "+" : ""}
            </span>
          )}
        </button>
      )}

      {/* Show last step result */}
      {isStepMode && lastStepResult && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {lastStepResult.compactionPerformed ? (
            <span className="flex items-center gap-1">
              <RotateCcw className="h-3 w-3" />
              Compacted
            </span>
          ) : lastStepResult.hasDispatchResult ? (
            <span>Event processed</span>
          ) : (
            <span>No action</span>
          )}
        </div>
      )}

      <button
        onClick={() => setShowInjectModal(true)}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <Syringe className="h-4 w-4" />
        Inject Event
      </button>

      {showInjectModal && (
        <InjectEventModal
          onClose={() => setShowInjectModal(false)}
          onInject={async (eventType, payload) => {
            await injectEvent(eventType, payload);
            setShowInjectModal(false);
          }}
        />
      )}
    </div>
  );
}

function InjectEventModal({
  onClose,
  onInject,
}: {
  onClose: () => void;
  onInject: (eventType: string, payload?: unknown) => Promise<void>;
}) {
  const [eventType, setEventType] = useState("USER_MESSAGE");
  const [payload, setPayload] = useState('{"content": "Hello, agent!"}');
  const [error, setError] = useState<string | null>(null);
  const [isInjecting, setIsInjecting] = useState(false);

  const handleInject = async () => {
    try {
      setError(null);
      setIsInjecting(true);

      let parsedPayload: unknown;
      if (payload.trim()) {
        parsedPayload = JSON.parse(payload);
      }

      await onInject(eventType, parsedPayload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Inject Event</h2>

        {error && (
          <div className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium">Event Type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          >
            <option value="USER_MESSAGE">USER_MESSAGE</option>
            <option value="SYSTEM_MESSAGE">SYSTEM_MESSAGE</option>
            <option value="TOOL_RESULT">TOOL_RESULT</option>
            <option value="SUBAGENT_RESULT">SUBAGENT_RESULT</option>
          </select>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium">Payload (JSON)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mt-1 h-32 w-full rounded-md border bg-background p-2 font-mono text-sm"
            placeholder='{"content": "..."}'
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleInject}
            disabled={!eventType || isInjecting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isInjecting ? "Injecting..." : "Inject"}
          </button>
        </div>
      </div>
    </div>
  );
}
