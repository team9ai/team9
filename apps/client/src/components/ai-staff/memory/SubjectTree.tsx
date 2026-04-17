import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { MemoryRecord, MemorySubject } from "./types";

interface SubjectTreeProps {
  subjects: MemorySubject[];
  memoriesBySubjectId: Map<string, MemoryRecord[]>;
  expandedSubjectIds: Set<string>;
  onToggleSubject: (subjectId: string) => void;
  selectedMemoryId: string | null;
  onSelectMemory: (memoryId: string) => void;
  highlightedSubjectId: string | null;
}

export function SubjectTree({
  subjects,
  memoriesBySubjectId,
  expandedSubjectIds,
  onToggleSubject,
  selectedMemoryId,
  onSelectMemory,
  highlightedSubjectId,
}: SubjectTreeProps) {
  if (subjects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No subjects for this type yet.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {subjects.map((subject) => {
          const memories = memoriesBySubjectId.get(subject.id) ?? [];
          const isExpanded = expandedSubjectIds.has(subject.id);
          const isHighlighted = highlightedSubjectId === subject.id;

          return (
            <div key={subject.id} className="mb-1">
              <button
                type="button"
                onClick={() => onToggleSubject(subject.id)}
                className={cn(
                  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  "hover:bg-muted/60",
                  isHighlighted && "bg-primary/10 ring-1 ring-primary/30",
                )}
              >
                {isExpanded ? (
                  <ChevronDown
                    size={13}
                    className="shrink-0 text-muted-foreground"
                  />
                ) : (
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-muted-foreground"
                  />
                )}
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {subject.type}
                </span>
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {subject.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  {memories.length}
                </span>
              </button>

              {isExpanded && memories.length > 0 && (
                <div className="ml-4 mt-0.5 border-l border-border/60 pl-2">
                  {memories.map((m) => {
                    const isSelected = m.id === selectedMemoryId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelectMemory(m.id)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
                          "hover:bg-muted/60",
                          isSelected && "bg-primary/10 text-primary-foreground",
                        )}
                      >
                        <FileText
                          size={11}
                          className={cn(
                            "shrink-0",
                            isSelected
                              ? "text-primary"
                              : "text-muted-foreground/70",
                          )}
                        />
                        <span
                          className={cn(
                            "flex-1 truncate",
                            isSelected
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {m.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {isExpanded && memories.length === 0 && (
                <div className="ml-4 mt-0.5 border-l border-border/60 pl-2">
                  <p className="px-2 py-1 text-xs italic text-muted-foreground/70">
                    No memories yet.
                  </p>
                </div>
              )}

              {subject.externalId && (
                <p className="ml-6 -mt-0.5 px-2 text-[10px] font-mono text-muted-foreground/60">
                  {subject.externalId}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
