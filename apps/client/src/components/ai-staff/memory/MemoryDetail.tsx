import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, FileText, Link as LinkIcon, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { MemoryConnection, MemoryRecord, MemorySubject } from "./types";

interface MemoryDetailProps {
  memory: MemoryRecord | null;
  subjectsById: Map<string, MemorySubject>;
  memoriesById: Map<string, MemoryRecord>;
  onNavigateMemory: (memoryId: string) => void;
  onNavigateSubject: (subjectId: string) => void;
}

export function MemoryDetail({
  memory,
  subjectsById,
  memoriesById,
  onNavigateMemory,
  onNavigateSubject,
}: MemoryDetailProps) {
  if (!memory) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <FileText size={32} className="text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          Select a memory on the left to view its content.
        </p>
        <div className="mt-4 max-w-sm rounded-lg border border-dashed border-border bg-muted/30 p-4 text-left">
          <p className="mb-2 text-xs font-medium text-foreground">
            About the diary pattern
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Every evening the agent runs a diary session: it reviews the day,
            summarizes what it did, and writes a memory held by itself that
            links to a <code className="text-[11px]">date</code> subject. Those
            diary entries power tomorrow's context.
          </p>
        </div>
      </div>
    );
  }

  const holders = memory.holderSubjectIds
    .map((id) => subjectsById.get(id))
    .filter((s): s is MemorySubject => Boolean(s));

  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* Header */}
        <div className="mb-4">
          <h3 className="mb-2 text-base font-semibold text-foreground">
            {memory.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {holders.map((h) => (
              <Badge
                key={h.id}
                variant="secondary"
                className="cursor-pointer gap-1 font-normal"
                onClick={() => onNavigateSubject(h.id)}
              >
                <span className="text-[10px] uppercase tracking-wide opacity-70">
                  {h.type}
                </span>
                {h.name}
              </Badge>
            ))}
            <span className="opacity-60">·</span>
            <span>{formatCreatedAt(memory.createdAt)}</span>
          </div>
        </div>

        {/* Markdown body */}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {memory.markdown}
          </ReactMarkdown>
        </div>

        {/* Source (信源) */}
        <div className="mt-6 rounded-md border border-border bg-muted/30 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Radio size={11} />
            Source
          </div>
          <code className="break-all text-xs text-foreground">
            {memory.source}
          </code>
        </div>

        {/* Connections */}
        {memory.connections.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <LinkIcon size={11} />
              Connections
            </div>
            <div className="space-y-1">
              {memory.connections.map((c, i) => (
                <ConnectionRow
                  key={`${memory.id}-conn-${i}`}
                  connection={c}
                  subjectsById={subjectsById}
                  memoriesById={memoriesById}
                  onNavigateMemory={onNavigateMemory}
                  onNavigateSubject={onNavigateSubject}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

interface ConnectionRowProps {
  connection: MemoryConnection;
  subjectsById: Map<string, MemorySubject>;
  memoriesById: Map<string, MemoryRecord>;
  onNavigateMemory: (memoryId: string) => void;
  onNavigateSubject: (subjectId: string) => void;
}

function ConnectionRow({
  connection,
  subjectsById,
  memoriesById,
  onNavigateMemory,
  onNavigateSubject,
}: ConnectionRowProps) {
  const isMemoryLink = Boolean(connection.targetMemoryId);
  const memoryTarget = connection.targetMemoryId
    ? memoriesById.get(connection.targetMemoryId)
    : undefined;
  const subjectTarget = connection.targetSubjectId
    ? subjectsById.get(connection.targetSubjectId)
    : undefined;

  const handleClick = () => {
    if (memoryTarget) {
      onNavigateMemory(memoryTarget.id);
    } else if (subjectTarget) {
      onNavigateSubject(subjectTarget.id);
    }
  };

  let label: string;
  let kindLabel: string;
  if (isMemoryLink && memoryTarget) {
    label = `memory · ${memoryTarget.title}`;
    kindLabel = "memory";
  } else if (subjectTarget) {
    label = `${subjectTarget.type} · ${subjectTarget.name}`;
    kindLabel = "subject";
  } else {
    label = "(unknown target)";
    kindLabel = "unknown";
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-sm transition-colors",
        "hover:border-border hover:bg-muted/40",
      )}
    >
      <ArrowRight
        size={13}
        className="shrink-0 text-muted-foreground group-hover:text-foreground"
      />
      <span className="flex-1 truncate text-foreground">{label}</span>
      <Badge
        variant={connection.kind === "main" ? "default" : "outline"}
        className="h-4 px-1.5 text-[10px] font-normal"
      >
        {connection.kind}
      </Badge>
      <span className="text-[10px] text-muted-foreground/70">{kindLabel}</span>
    </button>
  );
}

function formatCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
