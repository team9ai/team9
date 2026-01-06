import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { GitBranch, ChevronDown, Check, Loader2 } from "lucide-react";
import type { StateSummary } from "@/types";

/**
 * Data passed to the StateNode component
 */
export type StateNodeData = {
  state: StateSummary;
  isSelected: boolean;
  isMain: boolean;
  onSelect: (stateId: string) => void;
  onFork: (stateId: string) => void;
  // SubAgent spawn info
  hasSpawnedSubAgents?: boolean;
  isWaitingForSubAgent?: boolean;
  // Result received indicator
  hasReceivedResult?: boolean;
  // Index signature for React Flow compatibility
  [key: string]: unknown;
};

/**
 * Node type for StateNode
 */
export type StateNodeType = Node<StateNodeData, "stateNode">;

/**
 * StateNode - Custom React Flow node for displaying agent states
 *
 * Visual states:
 * - Normal: Default border
 * - Selected: Primary border and background
 * - Spawn: Has spawned SubAgents (down arrow icon)
 * - Waiting: Waiting for SubAgent result (pulse animation)
 * - Result: Received SubAgent result (checkmark)
 */
export const StateNode = memo(function StateNode({
  data,
}: NodeProps<StateNodeType>) {
  const {
    state,
    isSelected,
    isMain,
    onSelect,
    onFork,
    hasSpawnedSubAgents,
    isWaitingForSubAgent,
    hasReceivedResult,
  } = data;

  return (
    <div className="group relative nopan nodrag">
      {/* Input handle (left side) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-muted-foreground !w-2 !h-2"
      />

      {/* Node content */}
      <button
        onClick={() => onSelect(state.id)}
        className={`
          flex flex-col items-center justify-center
          h-16 w-24 rounded-lg border-2 transition-all cursor-pointer
          ${
            isSelected
              ? "border-primary bg-primary/10"
              : "border-border bg-card hover:border-primary/50"
          }
          ${isWaitingForSubAgent ? "animate-pulse" : ""}
          ${!isMain ? "opacity-90 scale-95" : ""}
        `}
      >
        {/* Version and status indicators */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium">v{state.version}</span>
          {hasSpawnedSubAgents && (
            <ChevronDown className="h-3 w-3 text-blue-500" />
          )}
          {isWaitingForSubAgent && (
            <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
          )}
          {hasReceivedResult && <Check className="h-3 w-3 text-green-500" />}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {state.chunkCount} chunks
        </span>
        {state.provenance?.eventType && (
          <span className="text-[9px] text-muted-foreground/70 truncate max-w-20">
            {state.provenance.eventType}
          </span>
        )}
      </button>

      {/* Fork button (shown on hover) - only for main agent nodes */}
      {isMain && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFork(state.id);
          }}
          className="
            absolute -right-1 -top-1 hidden group-hover:flex
            h-5 w-5 items-center justify-center
            rounded-full border bg-background shadow-sm
            hover:bg-primary hover:text-primary-foreground
            z-10
          "
          title="Fork from this state"
        >
          <GitBranch className="h-3 w-3" />
        </button>
      )}

      {/* Timestamp tooltip */}
      <div
        className="
          absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2
          whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px]
          shadow-md group-hover:block border
        "
      >
        {new Date(state.createdAt).toLocaleString()}
      </div>

      {/* Output handle (right side) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-muted-foreground !w-2 !h-2"
      />

      {/* Bottom handle for spawn edges */}
      {hasSpawnedSubAgents && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="spawn"
          className="!bg-blue-500 !w-2 !h-2"
        />
      )}

      {/* Bottom handle for receiving result edges from SubAgents */}
      {hasReceivedResult && (
        <Handle
          type="target"
          position={Position.Bottom}
          id="bottom"
          className="!bg-green-500 !w-2 !h-2"
        />
      )}
    </div>
  );
});
