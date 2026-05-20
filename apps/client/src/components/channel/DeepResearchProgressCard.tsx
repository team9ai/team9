import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  FileText,
  Globe2,
  ImageIcon,
  Search,
  SearchCheck,
  type LucideIcon,
} from "lucide-react";
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

interface DeepResearchVisualProgress {
  id?: string;
  src: string;
  title?: string;
  alt?: string;
}

interface DeepResearchProgressSnapshot {
  phase?: string;
  activeStep?: string;
  thoughts: DeepResearchThoughtProgress[];
  sources: DeepResearchSourceProgress[];
  visuals: DeepResearchVisualProgress[];
  queries: string[];
  counts?: Record<string, unknown>;
}

export interface DeepResearchProgressMeta {
  title: string;
  kind: "report";
  status?: string;
  phase?: string;
  mode?: string;
  visualization?: string;
  sources?: {
    googleSearch?: boolean;
    uploadedFiles?: boolean;
  };
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

function visualSource(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!isRecord(value)) return undefined;

  const direct =
    stringValue(value.url) ??
    stringValue(value.imageUrl) ??
    stringValue(value.publicUrl) ??
    stringValue(value.dataUrl) ??
    stringValue(value.src);
  if (direct) return direct;

  const base64 = stringValue(value.base64) ?? stringValue(value.data);
  if (!base64) return undefined;

  const mimeType = stringValue(value.mimeType) ?? "image/png";
  return `data:${mimeType};base64,${base64}`;
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

  const visuals = getArray(value.visuals ?? value.images, (item) => {
    const src = visualSource(item);
    if (!src) return null;
    const record = isRecord(item) ? item : {};
    return {
      ...(stringValue(record.id) ? { id: stringValue(record.id) } : {}),
      src,
      ...(stringValue(record.title)
        ? { title: stringValue(record.title) }
        : {}),
      ...(stringValue(record.alt) ? { alt: stringValue(record.alt) } : {}),
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
    visuals,
    queries,
    ...(isRecord(value.counts) ? { counts: value.counts } : {}),
  };
}

function parseDeepResearchSources(
  value: unknown,
): DeepResearchProgressMeta["sources"] | undefined {
  if (!isRecord(value)) return undefined;
  const googleSearch =
    typeof value.googleSearch === "boolean" ? value.googleSearch : undefined;
  const uploadedFiles =
    typeof value.uploadedFiles === "boolean" ? value.uploadedFiles : undefined;

  if (googleSearch === undefined && uploadedFiles === undefined) {
    return undefined;
  }

  return {
    ...(googleSearch !== undefined ? { googleSearch } : {}),
    ...(uploadedFiles !== undefined ? { uploadedFiles } : {}),
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
  const agent = stringValue(deepResearch.agent);
  const agentConfig = isRecord(deepResearch.agentConfig)
    ? deepResearch.agentConfig
    : isRecord(deepResearch.agent_config)
      ? deepResearch.agent_config
      : null;
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
    ...(stringValue(deepResearch.mode)
      ? { mode: stringValue(deepResearch.mode) }
      : agent?.includes("-max-")
        ? { mode: "max" }
        : {}),
    ...(stringValue(deepResearch.visualization)
      ? { visualization: stringValue(deepResearch.visualization) }
      : stringValue(agentConfig?.visualization)
        ? { visualization: stringValue(agentConfig?.visualization) }
        : {}),
    ...(parseDeepResearchSources(deepResearch.sources)
      ? { sources: parseDeepResearchSources(deepResearch.sources) }
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
  const titleDomain = domainFromDisplayText(source.title);
  if (source.domain && source.domain !== "vertexaisearch.cloud.google.com") {
    return source.domain;
  }
  if (titleDomain) return titleDomain;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.url;
  }
}

function domainFromDisplayText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    ?.trim()
    .toLowerCase();
  return candidate && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(candidate)
    ? candidate
    : undefined;
}

function isUrlLike(value: string | undefined): boolean {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
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
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
      {sources.slice(0, 32).map((source) => {
        const domain = sourceDomain(source);
        const title =
          source.title && !isUrlLike(source.title) ? source.title : domain;
        const showDomain = title.toLowerCase() !== domain.toLowerCase();
        return (
          <a
            key={source.id ?? source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-muted"
          >
            <img
              src={faviconUrl(domain)}
              alt=""
              className="size-4 shrink-0 rounded-sm"
              loading="lazy"
            />
            <span className="min-w-0 truncate">{title}</span>
            {showDomain && (
              <span className="shrink-0 max-w-24 truncate text-muted-foreground">
                {domain}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

function SourceSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1"
        >
          <div className="size-4 shrink-0 rounded-sm bg-muted animate-pulse" />
          <div className="h-3 min-w-0 flex-1 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function VisualGrid({ visuals }: { visuals: DeepResearchVisualProgress[] }) {
  if (visuals.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {visuals.slice(0, 6).map((visual, index) => (
        <figure
          key={visual.id ?? `${index}-${visual.src}`}
          className="overflow-hidden rounded-md border border-border bg-background"
        >
          <img
            src={visual.src}
            alt={visual.alt ?? visual.title ?? "Deep Research visual"}
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
          {visual.title && (
            <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {visual.title}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

function getContextBadges(meta: DeepResearchProgressMeta): string[] {
  const badges: string[] = [];
  if (meta.mode === "max") {
    badges.push("Deep Research Max");
  } else if (meta.mode) {
    badges.push("Deep Research");
  }
  if (meta.sources?.googleSearch) badges.push("Web");
  if (meta.sources?.uploadedFiles) badges.push("Files");
  if (meta.visualization === "auto") badges.push("Visuals");
  return badges;
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
  const visuals = progress?.visuals ?? [];
  const queries = progress?.queries ?? [];
  const hasProcessData =
    thoughts.length > 0 ||
    sources.length > 0 ||
    visuals.length > 0 ||
    queries.length > 0;
  const showProcess = hasProcessData || isStreaming;
  const contextBadges = getContextBadges(meta);
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
          {contextBadges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {contextBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[0.68rem] font-medium text-muted-foreground"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {showProcess && (
        <div className="mt-4 border-t border-border pt-4">
          {thoughts.length > 0 ? (
            <ProcessStep icon={Brain} title="系统构建研究框架">
              <ThoughtTimeline thoughts={thoughts} isStreaming={isStreaming} />
            </ProcessStep>
          ) : isStreaming ? (
            <ProcessStep icon={Brain} title="系统构建研究框架">
              <div className="space-y-2 py-1">
                <div className="h-3 w-56 rounded bg-muted animate-pulse" />
                <div className="h-3 w-full max-w-xl rounded bg-muted animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
              </div>
            </ProcessStep>
          ) : null}

          {(sources.length > 0 || isStreaming) && (
            <ProcessStep
              icon={Globe2}
              title={
                sources.length > 0
                  ? isStreaming
                    ? `正在研究网站 · ${sources.length}`
                    : `研究过的网站 · ${sources.length}`
                  : "正在研究网站"
              }
            >
              {sources.length > 0 ? (
                <SourceGrid sources={sources} />
              ) : (
                <SourceSkeletonGrid />
              )}
              {sources.length === 0 && queries.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
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
            </ProcessStep>
          )}

          {visuals.length > 0 && (
            <ProcessStep
              icon={ImageIcon}
              title={`可视化结果 · ${visuals.length}`}
            >
              <VisualGrid visuals={visuals} />
            </ProcessStep>
          )}

          <ProcessStep icon={FileText} title="生成报告" isLast>
            {queries.length > 0 && sources.length > 0 && (
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
