import { useAHandStatus } from "../../hooks/useAHandStatus.js";
import { useAHandSetupStore } from "../../stores/useAHandSetupStore.js";
import { AHandSetupDialog } from "../dialog/AHandSetupDialog.js";

export function LocalDeviceStatus() {
  const status = useAHandStatus();
  const openDialog = useAHandSetupStore((s) => s.openDialog);
  const steps = useAHandSetupStore((s) => s.steps);
  const hasRun = useAHandSetupStore((s) => s.hasRun);

  if (status === "not-desktop") return null;

  // Derive summary from steps if setup has run.
  const allCompleted = hasRun && steps.every((s) => s.status === "completed");
  const hasError = steps.some((s) => s.status === "error");
  const isInProgress = steps.some((s) => s.status === "running");

  const dot = allCompleted
    ? "bg-green-500"
    : hasError
      ? "bg-red-400"
      : isInProgress
        ? "bg-yellow-500 animate-pulse"
        : status === "connected"
          ? "bg-green-500"
          : status === "connecting"
            ? "bg-yellow-500 animate-pulse"
            : "bg-red-400";

  const label = allCompleted
    ? "Connected"
    : hasError
      ? "Setup failed"
      : isInProgress
        ? "Setting up…"
        : status === "connected"
          ? "Connected"
          : status === "connecting"
            ? "Connecting…"
            : "Not started";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
        {label}
      </button>
      <AHandSetupDialog />
    </>
  );
}
