import { useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MOCK_MEMORIES, MOCK_SUBJECTS, MOCK_TYPES } from "./mock-data";
import { SubjectTree } from "./SubjectTree";
import { MemoryDetail } from "./MemoryDetail";
import type { MemoryRecord, MemorySubject } from "./types";

const ALL_TYPE_KEY = "__all__";

export function MemoryTab() {
  const [activeType, setActiveType] = useState<string>(ALL_TYPE_KEY);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(
    MOCK_MEMORIES[0]?.id ?? null,
  );
  const [expandedSubjectIds, setExpandedSubjectIds] = useState<Set<string>>(
    () => {
      const initial = new Set<string>();
      if (MOCK_MEMORIES[0]) {
        for (const holderId of MOCK_MEMORIES[0].holderSubjectIds) {
          initial.add(holderId);
        }
      }
      return initial;
    },
  );
  const [highlightedSubjectId, setHighlightedSubjectId] = useState<
    string | null
  >(null);

  const subjectsById = useMemo(() => {
    const map = new Map<string, MemorySubject>();
    for (const s of MOCK_SUBJECTS) map.set(s.id, s);
    return map;
  }, []);

  const memoriesById = useMemo(() => {
    const map = new Map<string, MemoryRecord>();
    for (const m of MOCK_MEMORIES) map.set(m.id, m);
    return map;
  }, []);

  const memoriesBySubjectId = useMemo(() => {
    const map = new Map<string, MemoryRecord[]>();
    for (const memory of MOCK_MEMORIES) {
      for (const holderId of memory.holderSubjectIds) {
        const bucket = map.get(holderId) ?? [];
        bucket.push(memory);
        map.set(holderId, bucket);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
    return map;
  }, []);

  const visibleSubjects = useMemo(() => {
    if (activeType === ALL_TYPE_KEY) return MOCK_SUBJECTS;
    return MOCK_SUBJECTS.filter((s) => s.type === activeType);
  }, [activeType]);

  const selectedMemory = selectedMemoryId
    ? (memoriesById.get(selectedMemoryId) ?? null)
    : null;

  const handleToggleSubject = (subjectId: string) => {
    setExpandedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  };

  const handleSelectMemory = (memoryId: string) => {
    setSelectedMemoryId(memoryId);
    setHighlightedSubjectId(null);
    // Expand the subject(s) that hold this memory so the selection is visible.
    const memory = memoriesById.get(memoryId);
    if (memory) {
      setExpandedSubjectIds((prev) => {
        const next = new Set(prev);
        for (const holderId of memory.holderSubjectIds) next.add(holderId);
        return next;
      });
    }
  };

  const handleNavigateSubject = (subjectId: string) => {
    const subject = subjectsById.get(subjectId);
    if (!subject) return;
    // Switch type filter to match the target so it's visible.
    if (activeType !== ALL_TYPE_KEY && activeType !== subject.type) {
      setActiveType(ALL_TYPE_KEY);
    }
    setExpandedSubjectIds((prev) => {
      const next = new Set(prev);
      next.add(subjectId);
      return next;
    });
    setHighlightedSubjectId(subjectId);
    window.setTimeout(() => setHighlightedSubjectId(null), 1500);
  };

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-md border border-border">
      {/* Type filter bar */}
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-2">
        <TooltipProvider delayDuration={200}>
          <TypePill
            label="All"
            active={activeType === ALL_TYPE_KEY}
            onClick={() => setActiveType(ALL_TYPE_KEY)}
          />
          {MOCK_TYPES.map((t) => (
            <Tooltip key={t.name}>
              <TooltipTrigger asChild>
                <div>
                  <TypePill
                    label={t.name}
                    active={activeType === t.name}
                    onClick={() => setActiveType(t.name)}
                    custom={t.isCustom}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-xs">
                <p className="text-xs font-medium">{t.name}</p>
                <p className="mt-1 text-[11px] opacity-80">{t.description}</p>
                <p className="mt-1 text-[10px] font-mono opacity-70">
                  externalId: {t.externalIdSpec}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>

        <div className="flex-1" />

        <NewTypePopover />
      </div>

      {/* Master-detail body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[38%] min-w-[240px] border-r border-border bg-background">
          <SubjectTree
            subjects={visibleSubjects}
            memoriesBySubjectId={memoriesBySubjectId}
            expandedSubjectIds={expandedSubjectIds}
            onToggleSubject={handleToggleSubject}
            selectedMemoryId={selectedMemoryId}
            onSelectMemory={handleSelectMemory}
            highlightedSubjectId={highlightedSubjectId}
          />
        </div>
        <div className="flex-1 bg-background">
          <MemoryDetail
            memory={selectedMemory}
            subjectsById={subjectsById}
            memoriesById={memoriesById}
            onNavigateMemory={handleSelectMemory}
            onNavigateSubject={handleNavigateSubject}
          />
        </div>
      </div>
    </div>
  );
}

interface TypePillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  custom?: boolean;
}

function TypePill({ label, active, onClick, custom }: TypePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {custom && <Sparkles size={10} className="opacity-70" />}
      {label}
    </button>
  );
}

function NewTypePopover() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [externalIdSpec, setExternalIdSpec] = useState("");
  const [open, setOpen] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setExternalIdSpec("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-full px-2.5 text-xs"
        >
          <Plus size={11} />
          New Type
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold">Create memory type</h4>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              When the agent encounters a new concept worth tracking, it creates
              a type and reuses it on future memories.
            </p>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. contract"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this type represent?"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">externalId spec</Label>
              <Input
                value={externalIdSpec}
                onChange={(e) => setExternalIdSpec(e.target.value)}
                placeholder="e.g. contract slug"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
            Demo preview — type is not persisted.
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
            >
              Create
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
