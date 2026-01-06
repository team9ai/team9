import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, Loader2, Bot } from "lucide-react";
import type { StateSummary } from "@/types";

/**
 * Data passed to the SubAgentNode component
 */
export type SubAgentNodeData = {
  state: StateSummary;
  isSelected: boolean;
  subAgentId: string;
  subAgentName?: string;
  onSelect: (stateId: string, subAgentId?: string) => void;
  // Status indicators
  isCompleted?: boolean;
  isRunning?: boolean;
  isFirst?: boolean; // First node in SubAgent chain
  isLast?: boolean; // Last node in SubAgent chain
  isPlaceholder?: boolean; // True if this is a placeholder (not clickable)
  // Index signature for React Flow compatibility
  [key: string]: unknown;
};

/**
 * Node type for SubAgentNode
 */
export type SubAgentNodeType = Node<SubAgentNodeData, "subAgentNode">;

/**
 * SubAgentNode - Custom React Flow node for displaying SubAgent states
 *
 * Visual differences from StateNode:
 * - Smaller size (scale-90)
 * - Different border color (blue/purple accent)
 * - Bot icon indicator
 * - Shows SubAgent name on first node
 */
export const SubAgentNode = memo(function SubAgentNode({
  data,
}: NodeProps<SubAgentNodeType>) {
  const {
    state,
    isSelected,
    subAgentId,
    subAgentName,
    onSelect,
    isCompleted,
    isRunning,
    isFirst,
    isLast,
    isPlaceholder,
  } = data;

  return (
    <div className="group relative nopan nodrag">
      {/* Input handle (left side) - or top for first node */}
      {isFirst ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-blue-500 !w-2 !h-2"
        />
      ) : (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-blue-400 !w-2 !h-2"
        />
      )}

      {/* SubAgent label (shown on first node) */}
      {isFirst && subAgentName && (
        <div className="absolute -top-5 left-0 flex items-center gap-1 text-[9px] text-blue-500">
          <Bot className="h-3 w-3" />
          <span className="truncate max-w-20">{subAgentName}</span>
        </div>
      )}

      {/* Node content */}
      <button
        onClick={() => !isPlaceholder && onSelect(state.id, subAgentId)}
        className={`
          flex flex-col items-center justify-center
          h-14 w-20 rounded-lg border-2 transition-all cursor-pointer
          scale-95
          ${
            isSelected
              ? "border-blue-500 bg-blue-500/10"
              : isCompleted
                ? "border-green-500/70 bg-green-500/5"
                : "border-blue-400/50 bg-card/80 hover:border-blue-400"
          }
          ${isRunning ? "animate-pulse" : ""}
        `}
      >
        {/* Version and status */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
            v{state.version}
          </span>
          {isRunning && (
            <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
          )}
          {isCompleted && isLast && (
            <Check className="h-3 w-3 text-green-500" />
          )}
        </div>
        <span className="text-[9px] text-muted-foreground">
          {state.chunkCount} chunks
        </span>
      </button>

      {/* Timestamp tooltip */}
      <div
        className="
          absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2
          whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px]
          shadow-md group-hover:block border
        "
      >
        <div>{new Date(state.createdAt).toLocaleString()}</div>
        <div className="text-[9px] text-muted-foreground">{subAgentId}</div>
      </div>

      {/* Output handle (right side) - or bottom for last completed node */}
      {isLast && isCompleted ? (
        <Handle
          type="source"
          position={Position.Top}
          id="result"
          className="!bg-green-500 !w-2 !h-2"
        />
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-blue-400 !w-2 !h-2"
        />
      )}
    </div>
  );
});
