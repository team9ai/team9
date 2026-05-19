import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  FileText,
  Globe2,
  Search,
  SearchCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DeepResearchThoughtProgress {
  id?: string;
  title?: string;
  text?: string;
  status?: string;
}

interface DeepResearchSourceProgress {
  id?: string;
  url: string;
  title?: string;
  domain?: string;
  status?: string;
}

interface DeepResearchProgressSnapshot {
  phase?: string;
  activeStep?: string;
  thoughts: DeepResearchThoughtProgress[];
  sources: DeepResearchSourceProgress[];
  queries: string[];
  counts?: Record<string, unknown>;
}

export interface DeepResearchProgressMeta {
  title: string;
  kind: "report";
  status?: string;
  phase?: string;
  progress?: DeepResearchProgressSnapshot;
}

interface DeepResearchProgressCardProps {
  meta: DeepResearchProgressMeta;
  isStreaming?: boolean;
  startedAt?: number;
  className?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getArray<T>(value: unknown, mapper: (item: unknown) => T | null): T[] {
  return Array.isArray(value)
    ? value.map(mapper).filter((item): item is T => item !== null)
    : [];
}

function parseProgress(
  value: unknown,
): DeepResearchProgressSnapshot | undefined {
  if (!isRecord(value)) return undefined;

  const thoughts = getArray(value.thoughts, (item) => {
    if (!isRecord(item)) return null;
    const text = stringValue(item.text);
    if (!text) return null;
    return {
      ...(stringValue(item.id) ? { id: stringValue(item.id) } : {}),
      ...(stringValue(item.title) ? { title: stringValue(item.title) } : {}),
      text,
      ...(stringValue(item.status) ? { status: stringValue(item.status) } : {}),
    };
  });

  const sources = getArray(value.sources, (item) => {
    if (!isRecord(item)) return null;
    const url = stringValue(item.url);
    if (!url) return null;
    return {
      ...(stringValue(item.id) ? { id: stringValue(item.id) } : {}),
      url,
      ...(stringValue(item.title) ? { title: stringValue(item.title) } : {}),
      ...(stringValue(item.domain) ? { domain: stringValue(item.domain) } : {}),
      ...(stringValue(item.status) ? { status: stringValue(item.status) } : {}),
    };
  });

  const queries = Array.isArray(value.queries)
    ? value.queries
        .map((item) => stringValue(item))
        .filter((item): item is string => Boolean(item))
    : [];

  return {
    ...(stringValue(value.phase) ? { phase: stringValue(value.phase) } : {}),
    ...(stringValue(value.activeStep)
      ? { activeStep: stringValue(value.activeStep) }
      : {}),
    thoughts,
    sources,
    queries,
    ...(isRecord(value.counts) ? { counts: value.counts } : {}),
  };
}

export function getDeepResearchProgressMeta(
  metadata: unknown,
): DeepResearchProgressMeta | null {
  if (!isRecord(metadata)) return null;
  const deepResearch = isRecord(metadata.deepResearch)
    ? metadata.deepResearch
    : null;
  if (!deepResearch) return null;
  if (deepResearch.kind === "plan") return null;

  const progress = parseProgress(deepResearch.progress);
  const hasProgress =
    Boolean(progress) ||
    stringValue(deepResearch.phase) ||
    stringValue(deepResearch.status);
  if (!hasProgress) return null;

  return {
    title: stringValue(deepResearch.title) ?? "深度研究",
    kind: "report",
    ...(stringValue(deepResearch.status)
      ? { status: stringValue(deepResearch.status) }
      : {}),
    ...(stringValue(deepResearch.phase)
      ? { phase: stringValue(deepResearch.phase) }
      : {}),
    ...(progress ? { progress } : {}),
  };
}

function getWebsiteCount(progress: DeepResearchProgressSnapshot | undefined) {
  return (
    numberValue(progress?.counts?.websites) ??
    numberValue(progress?.counts?.websitesResearching) ??
    progress?.sources.length ??
    0
  );
}

function getStatusText(
  meta: DeepResearchProgressMeta,
  isStreaming: boolean,
): string {
  const phase = meta.progress?.phase ?? meta.phase;
  const websites = getWebsiteCount(meta.progress);
  if (meta.status === "failed" || phase === "failed") return "研究失败";
  if (!isStreaming || phase === "completed") {
    return "研究报告已完成";
  }
  if (websites > 0) return `正在研究 ${websites} 个网站...`;
  if (phase === "started") return "正在规划研究并检索资料...";
  if (phase === "submitted") return "正在启动深度研究...";
  if (phase === "synthesizing") return "正在生成报告...";
  if (phase === "planning") return "正在梳理研究方向...";
  return meta.progress?.activeStep ?? "正在进行深度研究...";
}

function formatElapsed(startedAt: number, now: number): string {
  const elapsedMs = Math.max(0, now - startedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes <= 0) return "刚刚开始";
  return `已运行 ${minutes} 分钟`;
}

function sourceDomain(source: DeepResearchSourceProgress): string {
  if (source.domain) return source.domain;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.url;
  }
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function ThoughtTimeline({
  thoughts,
  isStreaming,
}: {
  thoughts: DeepResearchThoughtProgress[];
  isStreaming: boolean;
}) {
  if (thoughts.length === 0 && !isStreaming) {
    return (
      <div className="text-sm text-muted-foreground">暂无研究过程记录</div>
    );
  }

  return (
    <div className="space-y-5">
      {thoughts.map((thought, index) => {
        const running = isStreaming && thought.status !== "completed";
        return (
          <div
            key={thought.id ?? `${index}-${thought.title ?? ""}`}
            className="grid grid-cols-[28px_1fr] gap-x-3"
          >
            <div className="relative flex justify-center">
              <div
                className={cn(
                  "mt-0.5 flex size-6 items-center justify-center rounded-full border bg-background",
                  running
                    ? "border-info text-info"
                    : "border-border text-muted-foreground",
                )}
              >
                <Brain className="size-3.5" />
              </div>
              {index < thoughts.length - 1 && (
                <div className="absolute top-7 bottom-[-20px] w-px bg-border" />
              )}
            </div>
            <div className="min-w-0 pb-1">
              <div className="mb-1 text-sm font-semibold">
                {thought.title ?? "研究思路"}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                {thought.text}
              </div>
            </div>
          </div>
        );
      })}
      {isStreaming && (
        <div className="grid grid-cols-[28px_1fr] gap-x-3">
          <div className="flex justify-center">
            <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-info text-info">
              <Search className="size-3.5 animate-pulse" />
            </div>
          </div>
          <div className="space-y-2 py-1">
            <div className="h-3 w-56 rounded bg-muted animate-pulse" />
            <div className="h-3 w-full max-w-xl rounded bg-muted animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}

function SourceGrid({ sources }: { sources: DeepResearchSourceProgress[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {sources.slice(0, 18).map((source) => {
        const domain = sourceDomain(source);
        return (
          <a
            key={source.id ?? source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm transition-colors hover:bg-muted"
          >
            <img
              src={faviconUrl(domain)}
              alt=""
              className="size-4 shrink-0 rounded-sm"
              loading="lazy"
            />
            <span className="shrink-0 max-w-24 truncate text-muted-foreground">
              {domain}
            </span>
            <span className="min-w-0 truncate">
              {source.title ?? source.url}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function ProcessStep({
  icon: Icon,
  title,
  children,
  isLast = false,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-x-3">
      <div className="relative flex justify-center">
        <div className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="size-4" />
        </div>
        {!isLast && (
          <div className="absolute top-8 bottom-[-18px] w-px bg-border" />
        )}
      </div>
      <div className="min-w-0 pb-5">
        <div className="mb-2 text-sm font-semibold">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function DeepResearchProgressCard({
  meta,
  isStreaming = false,
  startedAt,
  className,
}: DeepResearchProgressCardProps) {
  const progress = meta.progress;
  const thoughts = progress?.thoughts ?? [];
  const sources = progress?.sources ?? [];
  const queries = progress?.queries ?? [];
  const hasProcessData =
    thoughts.length > 0 || sources.length > 0 || queries.length > 0;
  const [expanded, setExpanded] = useState(isStreaming && hasProcessData);
  const [now, setNow] = useState(() => Date.now());
  const statusText = useMemo(
    () => getStatusText(meta, isStreaming),
    [meta, isStreaming],
  );
  const visibleStatusText =
    isStreaming && startedAt
      ? `${statusText} · ${formatElapsed(startedAt, now)}`
      : statusText;

  useEffect(() => {
    if (!hasProcessData) {
      setExpanded(false);
      return;
    }
    if (isStreaming) {
      setExpanded(true);
    }
  }, [hasProcessData, isStreaming]);

  useEffect(() => {
    if (!isStreaming || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isStreaming, startedAt]);

  return (
    <div
      className={cn(
        "w-full max-w-5xl rounded-md border border-border bg-muted/25 px-4 py-3 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-info">
          <SearchCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{meta.title}</div>
          <div className="truncate text-muted-foreground">
            {visibleStatusText}
          </div>
        </div>
        {hasProcessData && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "隐藏思考过程" : "显示思考过程"}
            {expanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        )}
      </div>

      {isStreaming && !hasProcessData && (
        <div className="mt-3 border-t border-border pt-3 text-sm leading-6 text-muted-foreground">
          正在等待研究服务返回可展示过程；收到研究思路、检索词或网站后会自动展开。
        </div>
      )}

      {expanded && (
        <div className="mt-4 border-t border-border pt-4">
          {thoughts.length > 0 && (
            <ProcessStep icon={Brain} title="梳理研究脉络">
              <ThoughtTimeline thoughts={thoughts} isStreaming={isStreaming} />
            </ProcessStep>
          )}

          {sources.length > 0 && (
            <ProcessStep icon={Globe2} title={`研究网站 · ${sources.length}`}>
              <SourceGrid sources={sources} />
            </ProcessStep>
          )}

          <ProcessStep icon={FileText} title="生成报告" isLast>
            {queries.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {queries.map((query) => (
                  <span
                    key={query}
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {query}
                  </span>
                ))}
              </div>
            )}
            <div className="text-sm leading-6 text-muted-foreground">
              {visibleStatusText}
            </div>
          </ProcessStep>
        </div>
      )}
    </div>
  );
}
