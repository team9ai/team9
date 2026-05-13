import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSendMessage } from "@/hooks/useMessages";
import { useCurrentUser } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatAbsoluteTooltip } from "@/lib/date-format";
import { formatMessageTime, parseApiDate } from "@/lib/date-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  readOnly?: boolean;
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

function findNextIncompleteTabIndex(
  tabs: ParsedTab[],
  selections: Record<string, string[]>,
  fromIndex: number,
): number {
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const index = (fromIndex + offset) % tabs.length;
    const tab = tabs[index];
    if ((selections[tab.title] ?? []).length === 0) {
      return index;
    }
  }

  return -1;
}

function findFirstIncompleteTabIndex(
  tabs: ParsedTab[],
  selections: Record<string, string[]>,
): number {
  return tabs.findIndex((tab) => (selections[tab.title] ?? []).length === 0);
}

function buildSelectionText(
  metadata: AgentEventMetadata,
  parsed: ParsedChoicesSurface | null,
): string {
  if (!metadata.selections) return "";

  const parts: string[] = [];
  for (const [tabTitle, sel] of Object.entries(metadata.selections)) {
    const parsedTab = parsed?.tabs.find((t) => t.title === tabTitle);
    const labels = sel.selected
      .filter((v) => v !== "__other__")
      .map((v) => parsedTab?.options.find((o) => o.value === v)?.label ?? v);
    if (sel.selected.includes("__other__")) {
      labels.push(sel.otherText ? `Other — "${sel.otherText}"` : "Other");
    }

    const text = labels.join(", ");
    parts.push(
      parsed && parsed.tabs.length > 1 ? `${tabTitle}：${text}` : text,
    );
  }

  return parts.join("；");
}

function ChoiceIndicator({
  checked,
  type,
  disabled,
}: {
  checked: boolean;
  type: ParsedTab["type"];
  disabled?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center border transition-colors",
        type === "single-select" ? "rounded-full" : "rounded-[4px]",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/55 bg-background",
        disabled && "opacity-60",
      )}
    >
      {checked &&
        (type === "single-select" ? (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        ) : (
          <Check className="h-3 w-3" />
        ))}
    </span>
  );
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
    <div className="mb-3 flex gap-1.5">
      {tabs.map((tab, i) => (
        <button
          type="button"
          key={tab.title}
          onClick={() => onSelect(i)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
            i === activeIndex
              ? "bg-primary text-primary-foreground"
              : "bg-muted/55 text-foreground hover:bg-muted/80",
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
      <div className="space-y-1">
        {tab.options.map((opt) => (
          <label
            key={opt.value}
            className="grid grid-cols-[1rem_1fr] items-start gap-2 opacity-60"
          >
            <input
              type={tab.type === "single-select" ? "radio" : "checkbox"}
              checked={selected.includes(opt.value)}
              disabled
              className="sr-only"
            />
            <ChoiceIndicator
              checked={selected.includes(opt.value)}
              type={tab.type}
              disabled
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
          <div className="opacity-60">
            <label className="grid grid-cols-[1rem_1fr] items-start gap-2">
              <input
                type={tab.type === "single-select" ? "radio" : "checkbox"}
                checked={selected.includes("__other__")}
                disabled
                className="sr-only"
              />
              <ChoiceIndicator
                checked={selected.includes("__other__")}
                type={tab.type}
                disabled
              />
              <span className="text-sm font-semibold">Other</span>
            </label>
            {selected.includes("__other__") && (
              <input
                type="text"
                value={otherText}
                disabled
                className="mt-1 ml-6 w-full bg-card border border-border rounded px-2 py-1 text-xs opacity-60"
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
  currentUserId,
}: {
  metadata: AgentEventMetadata;
  parsed: ParsedChoicesSurface | null;
  expanded: boolean;
  onToggle: () => void;
  currentUserId?: string;
}) {
  const status = metadata.status as string;

  const isResolved = status === "resolved" || status === "completed";
  const isTimeout = status === "timeout";
  const completedAt = metadata.completedAt ?? metadata.updatedAt;
  const completedDate = completedAt ? parseApiDate(completedAt) : null;
  const timeLabel = completedDate ? formatMessageTime(completedDate) : null;
  const responderName = metadata.responderName ?? "User";
  const actorLabel = `${responderName}${
    metadata.responderId && metadata.responderId === currentUserId ? "(你)" : ""
  }`;
  const selectionText = buildSelectionText(metadata, parsed);
  const summary = isResolved
    ? `${actorLabel}${timeLabel ? `在${timeLabel}` : ""}已选择了${
        selectionText || "选项"
      }`
    : isTimeout
      ? "Selection timed out"
      : "Selection cancelled";

  return (
    <div className="group/a2ui-surface bg-card border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group/header flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        {isResolved ? (
          <UserAvatar
            userId={metadata.responderId}
            name={responderName}
            avatarUrl={metadata.responderAvatarUrl}
            className="h-6 w-6"
            fallbackClassName="text-[10px] font-semibold"
          />
        ) : (
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs",
              isTimeout
                ? "bg-amber-500/10 text-amber-600"
                : "bg-red-500/10 text-red-600",
            )}
          >
            {isTimeout ? "\u23F1" : "\u2717"}
          </span>
        )}
        <span className="text-sm text-foreground truncate flex-1 min-w-0">
          {summary}
        </span>
        {completedDate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/a2ui-surface:opacity-100">
                {timeLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="bg-foreground text-background border-foreground text-xs font-medium"
            >
              {formatAbsoluteTooltip(completedDate)}
            </TooltipContent>
          </Tooltip>
        )}
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            "group-hover/header:text-foreground",
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
  const currentUser = useCurrentUser();
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedValues, setSelectedValues] = useState<
    Record<string, string[]>
  >(() => buildInitialSelections(parsed.tabs));
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>(() =>
    buildInitialOtherTexts(parsed.tabs),
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const surfaceId = metadata.surfaceId ?? parsed.surfaceId;
  const [validationError, setValidationError] = useState<string | null>(null);

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
  const firstIncompleteTabIndex = findFirstIncompleteTabIndex(
    parsed.tabs,
    selectedValues,
  );
  const hasIncompleteTabs = firstIncompleteTabIndex >= 0;
  const primaryButtonLabel = hasIncompleteTabs ? "下一个" : "提交";

  const handleOptionChange = (value: string) => {
    if (validationError) setValidationError(null);
    const current = selectedValues[tabKey] ?? [];
    const nextForTab =
      tab.type === "single-select"
        ? [value]
        : current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
    const nextSelections = { ...selectedValues, [tabKey]: nextForTab };

    setSelectedValues(nextSelections);

    if (
      tab.type === "single-select" &&
      current.length === 0 &&
      nextForTab.length > 0 &&
      value !== "__other__"
    ) {
      const nextTabIndex = findNextIncompleteTabIndex(
        parsed.tabs,
        nextSelections,
        activeTabIndex,
      );
      if (nextTabIndex >= 0) {
        setActiveTabIndex(nextTabIndex);
      }
    }
  };

  const handleOtherTextChange = (text: string) => {
    setOtherTexts((prev) => ({ ...prev, [tabKey]: text }));
  };

  const submitSelections = () => {
    setValidationError(null);

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
                              responderId: currentUser.data?.id,
                              responderName:
                                currentUser.data?.displayName ??
                                currentUser.data?.username,
                              responderAvatarUrl: currentUser.data?.avatarUrl,
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

  const handlePrimaryAction = () => {
    if (sendMessage.isPending) return;

    const currentSelection = selectedValues[tabKey] ?? [];
    if (currentSelection.length === 0) {
      setValidationError(`请先选择“${tab.title}”`);
      return;
    }

    const nextTabIndex = findNextIncompleteTabIndex(
      parsed.tabs,
      selectedValues,
      activeTabIndex,
    );
    if (nextTabIndex >= 0) {
      setValidationError(null);
      setActiveTabIndex(nextTabIndex);
      return;
    }

    submitSelections();
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="bg-card border border-border rounded-lg p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <UserAvatar
          userId={message.senderId ?? undefined}
          name={message.sender?.displayName}
          username={message.sender?.username}
          avatarUrl={message.sender?.avatarUrl}
          isBot={message.sender?.userType === "bot"}
          className="h-5 w-5"
          fallbackClassName="text-[10px] font-semibold"
        />
        <span>
          <span className="font-semibold text-foreground">
            {message.sender?.displayName ?? message.sender?.username ?? "Agent"}
            (agent)
          </span>
          向你提问
        </span>
      </div>

      {parsed.tabs.length > 1 && (
        <TabBar
          tabs={parsed.tabs}
          activeIndex={activeTabIndex}
          onSelect={(index) => {
            setActiveTabIndex(index);
            setValidationError(null);
          }}
        />
      )}

      <fieldset className="border-none p-0 m-0">
        <legend className="mb-3 text-sm font-semibold">{tab.prompt}</legend>

        <div
          className="space-y-1.5"
          role={tab.type === "single-select" ? "radiogroup" : undefined}
        >
          {tab.options.map((opt) => (
            <label
              key={opt.value}
              className="grid cursor-pointer grid-cols-[1rem_1fr] items-start gap-2 rounded-md py-0.5"
            >
              <input
                type={tab.type === "single-select" ? "radio" : "checkbox"}
                name={`a2ui-${surfaceId}-${tabKey}`}
                checked={selected.includes(opt.value)}
                onChange={() => handleOptionChange(opt.value)}
                className="sr-only"
              />
              <ChoiceIndicator
                checked={selected.includes(opt.value)}
                type={tab.type}
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
              <label className="grid cursor-pointer grid-cols-[1rem_1fr] items-start gap-2 rounded-md py-0.5">
                <input
                  type={tab.type === "single-select" ? "radio" : "checkbox"}
                  name={`a2ui-${surfaceId}-${tabKey}`}
                  checked={selected.includes("__other__")}
                  onChange={() => handleOptionChange("__other__")}
                  className="sr-only"
                />
                <ChoiceIndicator
                  checked={selected.includes("__other__")}
                  type={tab.type}
                />
                <span className="text-sm font-semibold">Other</span>
              </label>
              {selected.includes("__other__") && (
                <input
                  type="text"
                  value={otherText}
                  onChange={(e) => handleOtherTextChange(e.target.value)}
                  placeholder="Enter your answer..."
                  className="mt-1 ml-6 w-[calc(100%-1.5rem)] bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          )}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={handlePrimaryAction}
        disabled={sendMessage.isPending}
        className="w-full mt-3 bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendMessage.isPending ? "提交中..." : primaryButtonLabel}
      </button>
      {validationError && (
        <p className="text-center text-xs text-red-500 mt-1">
          {validationError}
        </p>
      )}
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
  readOnly = false,
}: A2UISurfaceBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const currentUser = useCurrentUser();

  const payload = metadata.payload;
  const parsed = payload ? parseChoicesPayload(payload) : null;

  // Active / running → interactive form (unless readOnly)
  if (metadata.status === "running" && !readOnly) {
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
      currentUserId={currentUser.data?.id}
    />
  );
}
