import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TauriLogStream } from "@/hooks/useBrowserRuntime";

export interface LogDrawerStep {
  name: string;
  logs: { line: string; stream: TauriLogStream }[];
}

interface LogDrawerProps {
  steps: LogDrawerStep[];
  expandedByDefault?: boolean;
}

function streamColor(stream: TauriLogStream): string {
  if (stream === "stderr") return "text-amber-600";
  if (stream === "info") return "text-muted-foreground italic";
  return "";
}

export function LogDrawer({ steps, expandedByDefault }: LogDrawerProps) {
  const { t } = useTranslation("ahand");
  const [expanded, setExpanded] = useState(!!expandedByDefault);
  const wasExpandedDefault = useRef(!!expandedByDefault);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-expand when caller flips expandedByDefault to true (e.g. install
  // starts). Don't auto-collapse on the way back — let users keep logs open
  // if they manually expanded them.
  useEffect(() => {
    if (expandedByDefault && !wasExpandedDefault.current) {
      setExpanded(true);
    }
    wasExpandedDefault.current = !!expandedByDefault;
  }, [expandedByDefault]);

  const totalLines = steps.reduce((sum, s) => sum + s.logs.length, 0);

  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [steps, expanded]);

  if (totalLines === 0) return null;

  return (
    <div className="border-t pt-3">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {expanded
          ? t("browser.logDrawer.collapse")
          : t("browser.logDrawer.expand", { count: totalLines })}
      </button>
      {expanded && (
        <div
          ref={logRef}
          className="mt-2 max-h-60 overflow-y-auto font-mono text-xs bg-muted/40 p-2 rounded"
        >
          {steps.flatMap((s) =>
            s.logs.map((l, i) => (
              <div
                key={`${s.name}-${i}`}
                className={cn("whitespace-pre-wrap", streamColor(l.stream))}
              >
                <span className="text-muted-foreground">[{s.name}]</span>{" "}
                {l.line}
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}
