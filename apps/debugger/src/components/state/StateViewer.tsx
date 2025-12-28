import { useState } from "react";
import type { MemoryState, MemoryChunk, WorkingFlowChild } from "@/types";
import { ChevronDown, ChevronRight, Edit2, Lock, Unlock } from "lucide-react";

interface StateViewerProps {
  state: MemoryState;
}

export function StateViewer({ state }: StateViewerProps) {
  // Ensure chunks is an array
  const chunks = Array.isArray(state.chunks) ? state.chunks : [];

  return (
    <div className="space-y-3">
      {/* State metadata */}
      <div className="rounded-md bg-muted/50 p-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-muted-foreground">ID:</span>
            <span className="ml-1 font-mono">
              {state.id?.slice(0, 12) || "N/A"}...
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Version:</span>
            <span className="ml-1 font-semibold">{state.version ?? "N/A"}</span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Created:</span>
            <span className="ml-1">
              {state.createdAt
                ? new Date(state.createdAt).toLocaleString()
                : "N/A"}
            </span>
          </div>
        </div>
      </div>

      {/* Chunks */}
      <div>
        <h3 className="mb-2 text-sm font-medium">Chunks ({chunks.length})</h3>
        <div className="space-y-2">
          {chunks.map((chunk, index) => (
            <ChunkCard key={chunk.id || `chunk-${index}`} chunk={chunk} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ChunkCardProps {
  chunk: MemoryChunk;
}

function ChunkCard({ chunk }: ChunkCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get chunk type color
  const typeColors: Record<string, string> = {
    SYSTEM:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    AGENT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    WORKFLOW:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    DELEGATION:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    WORKING_FLOW:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
    OUTPUT: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  };

  // Get retention strategy icon
  const retentionIcons: Record<string, { icon: typeof Lock; color: string }> = {
    CRITICAL: { icon: Lock, color: "text-red-500" },
    COMPRESSIBLE: { icon: Unlock, color: "text-yellow-500" },
    DISPOSABLE: { icon: Unlock, color: "text-green-500" },
  };

  const RetentionIcon = retentionIcons[chunk.retentionStrategy]?.icon || Unlock;
  const retentionColor =
    retentionIcons[chunk.retentionStrategy]?.color || "text-muted-foreground";

  // Get content preview - show children count for WORKING_FLOW containers
  const contentPreview =
    chunk.children && chunk.children.length > 0
      ? `[${chunk.children.length} messages]`
      : getContentPreview(chunk.content);

  return (
    <div className="rounded-md border bg-card">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}

        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeColors[chunk.type] || "bg-gray-100 text-gray-800"}`}
        >
          {chunk.type}
        </span>

        {chunk.subType && (
          <span className="text-[10px] text-muted-foreground">
            / {chunk.subType}
          </span>
        )}

        {chunk.children && chunk.children.length > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {chunk.children.length} children
          </span>
        )}

        <span className="flex-1 truncate text-xs text-muted-foreground">
          {contentPreview}
        </span>

        <RetentionIcon className={`h-3 w-3 ${retentionColor}`} />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t p-3">
          {/* Chunk metadata */}
          <div className="mb-3 grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-muted-foreground">ID:</span>
              <span className="ml-1 font-mono">
                {chunk.id?.slice(0, 12) || "N/A"}...
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Priority:</span>
              <span className="ml-1">{chunk.priority}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Retention:</span>
              <span className="ml-1">{chunk.retentionStrategy}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Mutable:</span>
              <span className="ml-1">{chunk.mutable ? "Yes" : "No"}</span>
            </div>
          </div>

          {/* Children (for WORKING_FLOW containers) */}
          {chunk.children && chunk.children.length > 0 && (
            <div className="mb-3">
              <span className="text-xs font-medium">
                Children ({chunk.children.length})
              </span>
              <div className="mt-2 space-y-2">
                {chunk.children.map((child, index) => (
                  <ChildCard key={child.id || `child-${index}`} child={child} />
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium">Content</span>
              {chunk.mutable && (
                <button className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                  <Edit2 className="h-3 w-3" />
                  Edit
                </button>
              )}
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
              {JSON.stringify(chunk.content, null, 2)}
            </pre>
          </div>

          {/* Parent IDs if any */}
          {chunk.metadata?.parentIds && chunk.metadata.parentIds.length > 0 && (
            <div className="mt-2 text-[10px]">
              <span className="text-muted-foreground">Parents:</span>
              <span className="ml-1 font-mono">
                {chunk.metadata.parentIds.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ChildCardProps {
  child: WorkingFlowChild;
}

/**
 * Card component for displaying a WORKING_FLOW child
 */
function ChildCard({ child }: ChildCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get subtype colors
  const subTypeColors: Record<string, string> = {
    USER: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    RESPONSE:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    THINKING:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    AGENT_ACTION:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    ACTION_RESPONSE:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    COMPACTED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  };

  const contentPreview = getContentPreview(child.content);

  return (
    <div className="rounded border bg-muted/30">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}

        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${subTypeColors[child.subType] || "bg-gray-100 text-gray-800"}`}
        >
          {child.subType}
        </span>

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {contentPreview}
        </span>

        <span className="text-[9px] text-muted-foreground">
          {new Date(child.createdAt).toLocaleTimeString()}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t p-2">
          <div className="mb-2 text-[9px]">
            <span className="text-muted-foreground">ID:</span>
            <span className="ml-1 font-mono">{child.id}</span>
          </div>
          <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-[10px]">
            {JSON.stringify(child.content, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Get a preview of chunk content
 */
function getContentPreview(content: unknown): string {
  if (!content) return "(empty)";

  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>;

    // Handle TEXT content
    if (obj.type === "TEXT" && typeof obj.text === "string") {
      return obj.text.slice(0, 50) + (obj.text.length > 50 ? "..." : "");
    }

    // Handle IMAGE content
    if (obj.type === "IMAGE") {
      return "[Image]";
    }

    // Handle MIXED content
    if (obj.type === "MIXED" && Array.isArray(obj.parts)) {
      return `[Mixed: ${obj.parts.length} parts]`;
    }

    // Default: show first few keys
    const keys = Object.keys(obj).slice(0, 3);
    return `{${keys.join(", ")}${Object.keys(obj).length > 3 ? "..." : ""}}`;
  }

  return String(content).slice(0, 50);
}
