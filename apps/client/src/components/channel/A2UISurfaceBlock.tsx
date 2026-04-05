import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSendMessage } from "@/hooks/useMessages";
import type { AgentEventMetadata, Message } from "@/types/im";
import {
  parseChoicesPayload,
  type ParsedChoicesSurface,
  type ParsedTab,
} from "@/lib/a2ui-parser";

export interface A2UISurfaceBlockProps {
  message: Message;
  metadata: AgentEventMetadata;
  channelId: string;
  onSubmit?: (
    surfaceId: string,
    selections: Record<
      string,
      { selected: string[]; otherText: string | null }
    >,
  ) => void;
  onCancel?: (surfaceId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInitialSelections(tabs: ParsedTab[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const tab of tabs) {
    result[tab.title] = [...tab.defaultSelected];
  }
  return result;
}

function buildInitialOtherTexts(tabs: ParsedTab[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tab of tabs) {
    result[tab.title] = "";
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tab Bar (shared by active & read-only views)
// ---------------------------------------------------------------------------

function TabBar({
  tabs,
  activeIndex,
  onSelect,
}: {
  tabs: ParsedTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex gap-1 mb-2">
      {tabs.map((tab, i) => (
        <button
          key={tab.title}
          onClick={() => onSelect(i)}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition-colors",
            i === activeIndex
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground hover:bg-accent",
          )}
        >
          {tab.title}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-Only Choices Form (for resolved / timeout / cancelled expanded view)
// ---------------------------------------------------------------------------

function ReadOnlyChoicesForm({
  parsed,
  selections,
}: {
  parsed: ParsedChoicesSurface;
  selections?: Record<string, { selected: string[]; otherText: string | null }>;
}) {
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const tab = parsed.tabs[activeTabIndex];
  const tabSel = selections?.[tab.title];
  const selected = tabSel?.selected ?? [];
  const otherText = tabSel?.otherText ?? "";

  return (
    <div className="pt-2">
      {parsed.tabs.length > 1 && (
        <TabBar
          tabs={parsed.tabs}
          activeIndex={activeTabIndex}
          onSelect={setActiveTabIndex}
        />
      )}
      <p className="text-sm font-medium mb-2">{tab.prompt}</p>
      <div className="space-y-1.5">
        {tab.options.map((opt) => (
          <div key={opt.value} className="flex items-start gap-2 opacity-60">
            <input
              type={tab.type === "single-select" ? "radio" : "checkbox"}
              checked={selected.includes(opt.value)}
              disabled
              readOnly
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-semibold">{opt.label}</span>
              {opt.description && (
                <p className="text-xs text-muted-foreground">
                  {opt.description}
                </p>
              )}
            </div>
          </div>
        ))}
        {tab.hasOther && (
          <div className="opacity-60">
            <div className="flex items-start gap-2">
              <input
                type={tab.type === "single-select" ? "radio" : "checkbox"}
                checked={selected.includes("__other__")}
                disabled
                readOnly
                className="mt-0.5"
              />
              <span className="text-sm font-semibold">Other</span>
            </div>
            {selected.includes("__other__") && (
              <input
                type="text"
                value={otherText}
                disabled
                readOnly
                className="mt-1 ml-5 w-full bg-card border border-border rounded px-2 py-1 text-xs opacity-60"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsed Header (resolved / timeout / cancelled)
// ---------------------------------------------------------------------------

function CollapsedHeader({
  metadata,
  parsed,
  expanded,
  onToggle,
}: {
  metadata: AgentEventMetadata;
  parsed: ParsedChoicesSurface | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = metadata.status as string;

  const isResolved = status === "resolved" || status === "completed";
  const isTimeout = status === "timeout";
  // cancelled is whatever remains

  const icon = isResolved ? "\u2713" : isTimeout ? "\u23F1" : "\u2717";
  const colorClass = isResolved
    ? "text-emerald-500"
    : isTimeout
      ? "text-amber-500"
      : "text-red-500";

  // Build summary text
  let summary: string;
  if (isResolved && metadata.selections && parsed) {
    const parts: string[] = [];
    for (const [tabTitle, sel] of Object.entries(metadata.selections)) {
      const parsedTab = parsed.tabs.find((t) => t.title === tabTitle);
      const labels = sel.selected
        .filter((v) => v !== "__other__")
        .map((v) => parsedTab?.options.find((o) => o.value === v)?.label ?? v);
      if (sel.selected.includes("__other__")) {
        labels.push(
          sel.otherText ? `Other \u2014 "${sel.otherText}"` : "Other",
        );
      }
      parts.push(labels.join(", "));
    }
    const responder = metadata.responderName ?? "User";
    summary = `${responder} selected: ${parts.join("; ")}`;
  } else if (isResolved) {
    // Resolved but no parsed data (e.g., payload parse failed)
    summary = "Choices submitted";
  } else if (isTimeout) {
    summary = "Selection timed out";
  } else {
    summary = "Selection cancelled";
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-accent/50 transition-colors group cursor-pointer"
      >
        <span className={cn("text-sm shrink-0", colorClass)}>{icon}</span>
        <span className="text-sm text-foreground truncate flex-1 min-w-0">
          {summary}
        </span>
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            "group-hover:text-foreground",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && parsed && (
        <div className="px-3 pb-3 border-t border-border">
          <ReadOnlyChoicesForm
            parsed={parsed}
            selections={metadata.selections}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Surface (running / interactive)
// ---------------------------------------------------------------------------

function ActiveSurface({
  message,
  metadata,
  parsed,
  channelId,
  onSubmit,
  onCancel,
}: {
  message: Message;
  metadata: AgentEventMetadata;
  parsed: ParsedChoicesSurface;
  channelId: string;
  onSubmit?: A2UISurfaceBlockProps["onSubmit"];
  onCancel?: A2UISurfaceBlockProps["onCancel"];
}) {
  const sendMessage = useSendMessage(channelId);
  const queryClient = useQueryClient();
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedValues, setSelectedValues] = useState<
    Record<string, string[]>
  >(() => buildInitialSelections(parsed.tabs));
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>(() =>
    buildInitialOtherTexts(parsed.tabs),
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const surfaceId = metadata.surfaceId ?? parsed.surfaceId;

  // Scope Esc to this surface via container focus
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (onCancel) {
        onCancel(surfaceId);
      }
    }
  };

  const tab = parsed.tabs[activeTabIndex];
  const tabKey = tab.title;
  const selected = selectedValues[tabKey] ?? [];
  const otherText = otherTexts[tabKey] ?? "";

  const handleOptionChange = (value: string) => {
    setSelectedValues((prev) => {
      const current = prev[tabKey] ?? [];
      if (tab.type === "single-select") {
        return { ...prev, [tabKey]: [value] };
      }
      // multi-select: toggle
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [tabKey]: next };
    });
  };

  const handleOtherTextChange = (text: string) => {
    setOtherTexts((prev) => ({ ...prev, [tabKey]: text }));
  };

  const handleSubmit = () => {
    if (sendMessage.isPending) return;
    const selections: Record<
      string,
      { selected: string[]; otherText: string | null }
    > = {};
    for (const t of parsed.tabs) {
      const sel = selectedValues[t.title] ?? [];
      const hasOtherSelected = sel.includes("__other__");
      selections[t.title] = {
        selected: sel,
        otherText: hasOtherSelected ? (otherTexts[t.title] ?? "") : null,
      };
    }
    // Build summary with human-readable labels (not raw values)
    const summary = Object.entries(selections)
      .map(([title, sel]) => {
        const parsedTab = parsed.tabs.find((t) => t.title === title);
        const labels = sel.selected
          .filter((v) => v !== "__other__")
          .map(
            (v) => parsedTab?.options.find((o) => o.value === v)?.label ?? v,
          );
        if (sel.otherText) labels.push(`Other — "${sel.otherText}"`);
        return `${title}: ${labels.join(", ")}`;
      })
      .join("; ");

    sendMessage.mutate(
      {
        content: summary,
        metadata: {
          agentEventType: "a2ui_response",
          status: "completed",
          surfaceId,
          selections,
        },
      },
      {
        onSuccess: () => {
          // Notify parent (if handler provided)
          if (onSubmit) onSubmit(surfaceId, selections);

          // Mark surface as resolved in ALL matching message caches
          // (covers both ["messages", channelId] and ["messages", channelId, anchor])
          const matchingQueries = queryClient
            .getQueryCache()
            .findAll({ queryKey: ["messages", channelId] });
          for (const query of matchingQueries) {
            queryClient.setQueryData(
              query.queryKey,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (old: any) => {
                if (!old?.pages) return old;
                return {
                  ...old,
                  pages: old.pages.map((page: unknown) => {
                    const msgs: Message[] = Array.isArray(page)
                      ? page
                      : ((page as { messages: Message[] }).messages ?? []);
                    const updated = msgs.map((m: Message) =>
                      m.id === message.id
                        ? {
                            ...m,
                            metadata: {
                              ...(m.metadata as Record<string, unknown>),
                              status: "resolved",
                              selections,
                            },
                          }
                        : m,
                    );
                    return Array.isArray(page)
                      ? updated
                      : { ...(page as object), messages: updated };
                  }),
                };
              },
            );
          }
        },
      },
    );
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="bg-card border border-border rounded-lg overflow-hidden px-3 py-3 outline-none"
    >
      {parsed.tabs.length > 1 && (
        <TabBar
          tabs={parsed.tabs}
          activeIndex={activeTabIndex}
          onSelect={setActiveTabIndex}
        />
      )}

      <p className="text-sm font-medium mb-2">{tab.prompt}</p>

      <div className="space-y-1.5">
        {tab.options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-2 cursor-pointer"
          >
            <input
              type={tab.type === "single-select" ? "radio" : "checkbox"}
              name={`a2ui-${surfaceId}-${tabKey}`}
              checked={selected.includes(opt.value)}
              onChange={() => handleOptionChange(opt.value)}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-semibold">{opt.label}</span>
              {opt.description && (
                <p className="text-xs text-muted-foreground">
                  {opt.description}
                </p>
              )}
            </div>
          </label>
        ))}

        {tab.hasOther && (
          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type={tab.type === "single-select" ? "radio" : "checkbox"}
                name={`a2ui-${surfaceId}-${tabKey}`}
                checked={selected.includes("__other__")}
                onChange={() => handleOptionChange("__other__")}
                className="mt-0.5"
              />
              <span className="text-sm font-semibold">Other</span>
            </label>
            {selected.includes("__other__") && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => handleOtherTextChange(e.target.value)}
                placeholder="Enter your answer..."
                className="mt-1 ml-5 w-full bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={sendMessage.isPending}
        className="w-full mt-3 bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendMessage.isPending ? "Submitting..." : "Submit answers"}
      </button>
      {onCancel && (
        <p className="text-center text-xs text-muted-foreground mt-1">
          Press Esc to cancel
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function A2UISurfaceBlock({
  message,
  metadata,
  channelId,
  onSubmit,
  onCancel,
}: A2UISurfaceBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const payload = metadata.payload;
  const parsed = payload ? parseChoicesPayload(payload) : null;

  // Active / running → interactive form
  if (metadata.status === "running") {
    if (!parsed) {
      return (
        <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
          <span className="text-red-500">
            Failed to parse A2UI surface payload
          </span>
        </div>
      );
    }
    return (
      <ActiveSurface
        message={message}
        metadata={metadata}
        parsed={parsed}
        channelId={channelId}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  // Completed / failed → collapsed header with optional expand
  return (
    <CollapsedHeader
      metadata={metadata}
      parsed={parsed}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
    />
  );
}
