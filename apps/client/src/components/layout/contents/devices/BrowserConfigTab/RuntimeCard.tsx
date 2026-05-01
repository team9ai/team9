import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Package } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type BrowserStepStatus,
  type ReloadFailureKind,
  type RuntimeUiState,
  type StepError,
  type TauriLogStream,
  type TauriStepStatus,
  useBrowserRuntime,
} from "@/hooks/useBrowserRuntime";
import { LogDrawer, type LogDrawerStep } from "./LogDrawer";
import { StepRow } from "./StepRow";

// The 3 canonical step names. Matches src-tauri/src/ahand/browser_runtime.rs::step_label.
const STEP_ORDER = ["node", "playwright", "browser"] as const;

interface DerivedStep {
  name: string;
  label: string;
  status: TauriStepStatus;
  detail?: string;
  error?: StepError;
  logs: { line: string; stream: TauriLogStream }[];
}

// Static lookup. Avoid templated `t()` calls — the i18next typed `t` overload
// resolution combined with a template literal key has triggered a tsc 5.8
// internal compiler crash in this repo ("Debug Failure. No error for last
// overload signature"). The literal-union return type below is required
// for the typed `t()` overload to resolve.
function fallbackStepLabelKey(
  name: string,
):
  | "browser.steps.node"
  | "browser.steps.playwright"
  | "browser.steps.browser"
  | "browser.steps.unknown" {
  switch (name) {
    case "node":
      return "browser.steps.node";
    case "playwright":
      return "browser.steps.playwright";
    case "browser":
      return "browser.steps.browser";
    default:
      return "browser.steps.unknown";
  }
}

function reloadStatusKey(
  kind: ReloadFailureKind,
):
  | "browser.reloadStatus.shutdownTimeout"
  | "browser.reloadStatus.spawnFailedRolledBack"
  | "browser.reloadStatus.spawnFailedNoRollback" {
  switch (kind) {
    case "shutdownTimeout":
      return "browser.reloadStatus.shutdownTimeout";
    case "spawnFailedRolledBack":
      return "browser.reloadStatus.spawnFailedRolledBack";
    case "spawnFailedNoRollback":
    default:
      return "browser.reloadStatus.spawnFailedNoRollback";
  }
}

function deriveSteps(state: RuntimeUiState): DerivedStep[] {
  // Build a lookup of any persisted/static step info first.
  const fromStatus: Record<string, BrowserStepStatus> = {};
  const snapshotStatus =
    state.kind === "idle"
      ? state.status
      : state.kind === "error"
        ? state.status
        : null;
  if (snapshotStatus) {
    for (const s of snapshotStatus.steps) {
      fromStatus[s.name] = s;
    }
  }
  // Per-step live feed (during install/reload, or preserved on error).
  const feed =
    state.kind === "installing" ||
    state.kind === "reloading" ||
    state.kind === "error"
      ? state.steps
      : {};

  // Union of step names from the static order, the status snapshot, and
  // anything streamed in via the channel — preserves ordering for the
  // canonical 3, then appends unknown step names at the end.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const n of STEP_ORDER) {
    seen.add(n);
    ordered.push(n);
  }
  for (const k of [...Object.keys(fromStatus), ...Object.keys(feed)]) {
    if (!seen.has(k)) {
      seen.add(k);
      ordered.push(k);
    }
  }

  return ordered.map((name) => {
    const snapshot = fromStatus[name];
    const live = feed[name];
    // Leave label as the wire `name` if there's no live/snapshot label;
    // the consumer (RuntimeCard) will localize via `fallbackStepLabelKey`.
    const label = snapshot?.label ?? live?.label ?? "";
    const status: TauriStepStatus =
      live?.status && live.status !== "notRun"
        ? live.status
        : (snapshot?.status ?? "notRun");
    const error = live?.error ?? snapshot?.error;
    const detail = snapshot?.detail;
    const logs = live?.logs ?? [];
    return { name, label, status, detail, error, logs };
  });
}

function overallFor(state: RuntimeUiState): TauriStepStatus {
  if (state.kind === "idle") return state.status.overall;
  if (state.kind === "error") return state.status?.overall ?? "failed";
  // installing / reloading / loading
  return "notRun";
}

export function RuntimeCard() {
  const { t } = useTranslation("ahand");
  const { state, install, setEnabled } = useBrowserRuntime();
  const [logDrawerOpenSignal, setLogDrawerOpenSignal] = useState(0);

  // Surface terminal errors via toast. Only fire once per transition into
  // the "error" kind — guarded by a ref so re-renders don't spam.
  const lastErrorMessage = useRef<string | null>(null);
  useEffect(() => {
    if (state.kind === "error") {
      if (lastErrorMessage.current !== state.message) {
        lastErrorMessage.current = state.message;
        const raw = state.message;
        // Stable identifiers returned synchronously from the Tauri commands.
        let translated = raw;
        if (raw === "operation_in_progress")
          translated = t("browser.errors.operationInProgress");
        else if (raw === "browser_not_installed")
          translated = t("browser.errors.browserNotInstalled");
        else if (raw.startsWith("ahand runtime not started"))
          translated = t("browser.errors.runtimeNotStarted");
        else if (raw === "browser_runtime_unavailable_in_web")
          translated = t("browser.errors.unavailableInWeb");
        else if (raw === "config_load_failed")
          translated = t("browser.errors.configLoadFailed");
        else if (raw === "config_write_failed")
          translated = t("browser.errors.configWriteFailed");
        else if (raw === "config_final_load_failed")
          translated = t("browser.errors.configFinalLoadFailed");
        toast.error(translated);
      }
    } else {
      lastErrorMessage.current = null;
    }
  }, [state, t]);

  // Surface daemon reload failures the moment they're observed. The Tauri
  // commands `browser_install` / `browser_set_enabled` resolve `Ok(status)`
  // even when the daemon reload errored, so without this the user would
  // see green "Installed" while the daemon is actually offline / stale.
  // Keyed by the monotonic `seq` so re-renders don't refire and a fresh
  // failure (same kind/message but new event) still toasts.
  const reloadFailure =
    state.kind !== "loading" ? state.reloadFailure : undefined;
  const lastReloadFailureSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!reloadFailure) {
      lastReloadFailureSeq.current = null;
      return;
    }
    if (lastReloadFailureSeq.current === reloadFailure.seq) return;
    lastReloadFailureSeq.current = reloadFailure.seq;
    toast.error(t(reloadStatusKey(reloadFailure.kind)));
  }, [reloadFailure, t]);

  const overall = overallFor(state);
  const isBusy = state.kind === "installing" || state.kind === "reloading";

  const overallLabel =
    state.kind === "installing"
      ? t("browser.installing")
      : state.kind === "reloading"
        ? t("browser.reloading")
        : overall === "ok"
          ? t("browser.statusInstalled")
          : overall === "failed"
            ? t("browser.installFailed")
            : t("browser.statusNotInstalled");

  const installButtonLabel =
    overall === "failed" || state.kind === "error"
      ? t("browser.retry")
      : t("browser.install");
  const installButtonDisabled = isBusy || state.kind === "loading";

  const steps = useMemo(() => deriveSteps(state), [state]);

  // Agent visibility toggle: only meaningful when overall === "ok".
  // `enabled` reflects the on-disk config; `agentVisible` reflects whether
  // the daemon advertises the capability (depends on enabled + daemon
  // online). For the toggle source-of-truth we use `enabled`.
  const enabled = state.kind === "idle" ? state.status.enabled : false;
  const agentVisible =
    state.kind === "idle" ? state.status.agentVisible : false;
  const agentVisibleDisabled =
    state.kind !== "idle" || state.status.overall !== "ok";
  // Mismatch: user wants it on, daemon hasn't picked it up yet (e.g. reload
  // failed). Surfaces an inline warning next to the Switch.
  const agentVisibleOutOfSync =
    state.kind === "idle" &&
    state.status.overall === "ok" &&
    enabled &&
    !agentVisible;

  const drawerSteps: LogDrawerStep[] = steps
    .filter((s) => s.logs.length > 0)
    .map((s) => ({ name: s.name, logs: s.logs }));

  // Triggered via key bump so the drawer remounts/expands when the user
  // clicks "View logs" in a help popover.
  const drawerExpandedByDefault = isBusy || logDrawerOpenSignal > 0;

  const handleInstall = () => {
    void install(overall === "failed");
  };
  const handleRetryForce = () => {
    void install(true);
  };
  const handleViewLogs = () => {
    setLogDrawerOpenSignal((n) => n + 1);
  };
  const handleEnabledChange = (checked: boolean) => {
    void setEnabled(checked);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("browser.runtimeTitle")}</CardTitle>
        <CardDescription>{t("browser.runtimeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top row: overall summary + install/retry button */}
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Playwright</p>
            <p className="text-xs text-muted-foreground">
              {t("browser.runtimeSubtitle")}
            </p>
          </div>
          <Badge
            variant="outline"
            size="sm"
            className={cn(
              "h-5 shrink-0 rounded-md px-1.5 text-[10px] font-medium",
              overall === "ok" &&
                "border-emerald-200 bg-emerald-50 text-emerald-700",
              overall === "failed" && "border-red-200 bg-red-50 text-red-700",
              isBusy && "border-blue-200 bg-blue-50 text-blue-700",
              !isBusy &&
                overall !== "ok" &&
                overall !== "failed" &&
                "border-border/60 bg-background/80 text-muted-foreground",
            )}
          >
            {overallLabel}
          </Badge>
          {overall !== "ok" && (
            <Button
              variant="outline"
              size="sm"
              disabled={installButtonDisabled}
              onClick={handleInstall}
            >
              {installButtonLabel}
            </Button>
          )}
        </div>

        {/* Per-step rows */}
        <div className="space-y-2 border-t pt-3">
          {steps.map((s) => (
            <StepRow
              key={s.name}
              name={s.name}
              label={s.label || t(fallbackStepLabelKey(s.name))}
              status={s.status}
              detail={s.detail}
              error={s.error}
              busy={isBusy}
              onRetryForce={handleRetryForce}
              onViewLogs={handleViewLogs}
            />
          ))}
        </div>

        {/* Agent visibility toggle */}
        <div className="flex items-center gap-3 border-t pt-3">
          <div className="flex-1">
            <p className="text-sm font-medium">
              {t("browser.agentVisibility.toggleLabel")}
            </p>
            <p className="text-xs text-muted-foreground">
              {agentVisibleDisabled && state.kind === "idle"
                ? t("browser.agentVisibility.disabledHint")
                : t("browser.agentVisibility.tooltip")}
            </p>
          </div>
          {agentVisibleOutOfSync && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label={t("browser.agentVisibility.outOfSync")}
                    className="inline-flex items-center justify-center text-amber-600"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs">
                    <div className="font-medium">
                      {t("browser.agentVisibility.outOfSync")}
                    </div>
                    <div className="opacity-80 mt-0.5">
                      {t("browser.agentVisibility.outOfSyncTooltip")}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Switch
            checked={enabled}
            disabled={agentVisibleDisabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>

        {/* Log drawer — only renders when we have lines to show */}
        <LogDrawer
          steps={drawerSteps}
          expandedByDefault={drawerExpandedByDefault}
        />
      </CardContent>
    </Card>
  );
}
