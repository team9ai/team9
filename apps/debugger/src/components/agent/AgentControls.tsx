import { useState } from "react";
import { useDebugStore } from "@/stores/useDebugStore";
import {
  Play,
  Pause,
  Syringe,
  Circle,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export function AgentControls() {
  const { currentAgent, pauseAgent, resumeAgent, injectEvent } =
    useDebugStore();
  const [showInjectModal, setShowInjectModal] = useState(false);

  if (!currentAgent) return null;

  const status = currentAgent.status;

  // Status indicator styles
  const statusConfig = {
    running: {
      icon: Circle,
      color: "text-green-500",
      bgColor: "bg-green-500",
      label: "Running",
      animate: true,
    },
    paused: {
      icon: Pause,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500",
      label: "Paused",
      animate: false,
    },
    completed: {
      icon: CheckCircle2,
      color: "text-blue-500",
      bgColor: "bg-blue-500",
      label: "Completed",
      animate: false,
    },
    error: {
      icon: AlertCircle,
      color: "text-red-500",
      bgColor: "bg-red-500",
      label: "Error",
      animate: false,
    },
  };

  const currentStatus = statusConfig[status] || statusConfig.running;
  const StatusIcon = currentStatus.icon;

  return (
    <div className="flex items-center gap-3">
      {/* Status indicator */}
      <div className="flex items-center gap-2 rounded-full border px-3 py-1">
        <div className="relative">
          {currentStatus.animate && (
            <span
              className={`absolute inset-0 animate-ping rounded-full ${currentStatus.bgColor} opacity-75`}
            />
          )}
          <span
            className={`relative block h-2.5 w-2.5 rounded-full ${currentStatus.bgColor}`}
          />
        </div>
        <span className={`text-sm font-medium ${currentStatus.color}`}>
          {currentStatus.label}
        </span>
      </div>

      {/* Control buttons */}
      {status === "paused" ? (
        <button
          onClick={resumeAgent}
          className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          <Play className="h-4 w-4" />
          Resume
        </button>
      ) : status === "running" ? (
        <button
          onClick={pauseAgent}
          className="flex items-center gap-1.5 rounded-md bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-700"
        >
          <Pause className="h-4 w-4" />
          Pause
        </button>
      ) : null}

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
