import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import {
  useAHandSetupStore,
  type SetupStep,
  type StepStatus,
} from "@/stores/useAHandSetupStore";

// Renders the appropriate icon based on step status
function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "pending":
      return <Circle className="h-4 w-4 text-muted-foreground/60" />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
}

// Renders a single setup step with icon, label, optional retry button, and error message
function StepRow({ step }: { step: SetupStep }) {
  const retryFrom = useAHandSetupStore((s) => s.retryFrom);

  return (
    <div>
      <div className="flex items-center gap-2">
        <StepIcon status={step.status} />
        <span
          className={
            step.status === "pending"
              ? "text-sm text-muted-foreground/60"
              : step.status === "error"
                ? "text-sm text-red-500"
                : "text-sm"
          }
        >
          {step.label}
        </span>
        {step.status === "error" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-xs"
            onClick={() => retryFrom(step.id)}
          >
            Retry
          </Button>
        )}
      </div>
      {step.status === "error" && step.error && (
        <p className="pl-6 text-xs text-red-400">{step.error}</p>
      )}
    </div>
  );
}

export function AHandSetupDialog() {
  const dialogOpen = useAHandSetupStore((s) => s.dialogOpen);
  const closeDialog = useAHandSetupStore((s) => s.closeDialog);
  const steps = useAHandSetupStore((s) => s.steps);
  const isRunning = useAHandSetupStore((s) => s.isRunning);

  const ahandSteps = steps.filter((s) => s.group === "ahand");
  const browserSteps = steps.filter((s) => s.group === "browser");

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={isRunning ? undefined : () => closeDialog()}
    >
      <DialogContent
        className="max-w-sm"
        onInteractOutside={isRunning ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>Local Device Setup</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* aHand connection group */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              aHand Connection
            </h4>
            {ahandSteps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>

          {/* Browser component group */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Browser Components
            </h4>
            {browserSteps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
