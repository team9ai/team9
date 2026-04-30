import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Circle,
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { StepError, TauriStepStatus } from "@/hooks/useBrowserRuntime";

export interface StepRowProps {
  name: string;
  label: string;
  status: TauriStepStatus;
  detail?: string;
  error?: StepError;
  /** Called when the user clicks "Retry with --force" inside the help popover. */
  onRetryForce?: () => void;
  /** Called when the user clicks "View logs" — typically opens the log drawer. */
  onViewLogs?: () => void;
  /** True while the parent is in `installing` or `reloading` — animates spinner. */
  busy?: boolean;
}

function StatusIcon({
  status,
  busy,
}: {
  status: TauriStepStatus;
  busy?: boolean;
}) {
  if (busy && status !== "ok" && status !== "failed") {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  if (status === "ok") return <Check className="h-4 w-4 text-emerald-600" />;
  if (status === "failed") return <X className="h-4 w-4 text-red-600" />;
  if (status === "skipped")
    return <Circle className="h-4 w-4 text-muted-foreground/60" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

// Static lookup for all 6 ErrorCodes. We avoid templated `t()` calls (e.g.
// `` t(`browser.help.${code}`) ``) because they stress TS overload
// resolution and have triggered a tsc 5.8 internal compiler crash
// ("Debug Failure. No error for last overload signature") in this repo.
function helpMessageKey(
  code: string,
):
  | "browser.help.permission_denied"
  | "browser.help.network"
  | "browser.help.no_system_browser"
  | "browser.help.node_missing"
  | "browser.help.version_mismatch"
  | "browser.help.unknown" {
  switch (code) {
    case "permission_denied":
      return "browser.help.permission_denied";
    case "network":
      return "browser.help.network";
    case "no_system_browser":
      return "browser.help.no_system_browser";
    case "node_missing":
      return "browser.help.node_missing";
    case "version_mismatch":
      return "browser.help.version_mismatch";
    case "unknown":
    default:
      return "browser.help.unknown";
  }
}

function statusBadgeKey(
  status: TauriStepStatus,
):
  | "browser.stepStatus.ok"
  | "browser.stepStatus.skipped"
  | "browser.stepStatus.failed"
  | "browser.stepStatus.notRun" {
  switch (status) {
    case "ok":
      return "browser.stepStatus.ok";
    case "skipped":
      return "browser.stepStatus.skipped";
    case "failed":
      return "browser.stepStatus.failed";
    case "notRun":
    default:
      return "browser.stepStatus.notRun";
  }
}

function HelpPopover({
  error,
  onRetryForce,
  onViewLogs,
}: {
  error: StepError;
  onRetryForce?: () => void;
  onViewLogs?: () => void;
}) {
  const { t } = useTranslation("ahand");
  const [copied, setCopied] = useState(false);

  const messageKey = helpMessageKey(error.code);
  const message = t(messageKey);

  const onCopy = () => {
    const cmd = "sudo chown -R $(whoami) ~/.ahand";
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("browser.help.aria")}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm space-y-2" align="end">
        <p>{message}</p>
        {error.code === "permission_denied" && (
          <div className="space-y-1">
            <pre className="text-xs bg-muted p-2 rounded select-all">
              sudo chown -R $(whoami) ~/.ahand
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopy}
              className="w-full"
            >
              <Copy className="h-3 w-3 mr-1" />
              {copied
                ? t("browser.help.copied")
                : t("browser.help.copyCommand")}
            </Button>
          </div>
        )}
        {error.code === "network" && (
          <p className="text-xs text-muted-foreground">
            {t("browser.help.networkHint")}
          </p>
        )}
        {error.code === "no_system_browser" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            asChild
            className="w-full"
          >
            <a
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t("browser.help.downloadChrome")}
            </a>
          </Button>
        )}
        {error.code === "node_missing" && (
          <p className="text-xs text-muted-foreground">
            {t("browser.help.nodeMissingHint")}
          </p>
        )}
        {error.code === "version_mismatch" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryForce}
            disabled={!onRetryForce}
            className="w-full"
          >
            {t("browser.help.retryWithForce")}
          </Button>
        )}
        {error.code !== "permission_denied" &&
          error.code !== "network" &&
          error.code !== "no_system_browser" &&
          error.code !== "node_missing" &&
          error.code !== "version_mismatch" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onViewLogs}
              disabled={!onViewLogs}
              className="w-full"
            >
              {t("browser.help.viewLogs")}
            </Button>
          )}
        <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
          {error.message}
        </pre>
      </PopoverContent>
    </Popover>
  );
}

export function StepRow({
  label,
  status,
  detail,
  error,
  onRetryForce,
  onViewLogs,
  busy,
}: StepRowProps) {
  const { t } = useTranslation("ahand");
  const statusLabel = t(statusBadgeKey(status));

  return (
    <div className="flex items-center gap-3 text-sm">
      <StatusIcon status={status} busy={busy} />
      <span className="flex-1 font-medium">{label}</span>
      <Badge
        variant="outline"
        size="sm"
        className={cn(
          "h-5 shrink-0 rounded-md px-1.5 text-[10px] font-medium",
          status === "ok" &&
            "border-emerald-200 bg-emerald-50 text-emerald-700",
          status === "failed" && "border-red-200 bg-red-50 text-red-700",
          status === "skipped" &&
            "border-border/60 bg-background/80 text-muted-foreground",
          status === "notRun" &&
            "border-border/60 bg-background/80 text-muted-foreground",
        )}
      >
        {statusLabel}
      </Badge>
      {detail && (
        <span
          className="text-xs text-muted-foreground truncate max-w-[14rem]"
          title={detail}
        >
          {detail}
        </span>
      )}
      {status === "failed" && error && (
        <HelpPopover
          error={error}
          onRetryForce={onRetryForce}
          onViewLogs={onViewLogs}
        />
      )}
    </div>
  );
}
