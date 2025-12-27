import { useDebugStore } from "@/stores/useDebugStore";
import type { StateSummary } from "@/types";
import { GitBranch, Circle, ArrowRight } from "lucide-react";

interface ExecutionTreeProps {
  states: StateSummary[];
}

export function ExecutionTree({ states }: ExecutionTreeProps) {
  const { selectedStateId, selectState, forkFromState } = useDebugStore();

  if (states.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        No states yet. Inject an event to start the agent.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Horizontal scrollable tree container */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4">
        {states.map((state, index) => (
          <div key={state.id} className="flex items-center">
            {/* State node */}
            <StateNode
              state={state}
              isSelected={state.id === selectedStateId}
              onClick={() => selectState(state.id)}
              onFork={() => forkFromState(state.id)}
            />

            {/* Connector to next node */}
            {index < states.length - 1 && (
              <div className="flex items-center px-1">
                <div className="h-0.5 w-8 bg-border" />
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Circle className="h-3 w-3 fill-primary stroke-primary" />
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1">
          <Circle className="h-3 w-3 stroke-muted-foreground" />
          <span>History</span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowRight className="h-3 w-3" />
          <span>Event Trigger</span>
        </div>
      </div>
    </div>
  );
}

interface StateNodeProps {
  state: StateSummary;
  isSelected: boolean;
  onClick: () => void;
  onFork: () => void;
}

function StateNode({ state, isSelected, onClick, onFork }: StateNodeProps) {
  return (
    <div className="group relative">
      {/* Node */}
      <button
        onClick={onClick}
        className={`
          flex flex-col items-center justify-center
          h-16 w-24 rounded-lg border-2 transition-colors
          ${
            isSelected
              ? "border-primary bg-primary/10"
              : "border-border bg-card hover:border-primary/50"
          }
        `}
      >
        <span className="text-xs font-medium">v{state.version}</span>
        <span className="text-[10px] text-muted-foreground">
          {state.chunkCount} chunks
        </span>
      </button>

      {/* Fork button (shown on hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFork();
        }}
        className="
          absolute -right-1 -top-1 hidden group-hover:flex
          h-5 w-5 items-center justify-center
          rounded-full border bg-background shadow-sm
          hover:bg-primary hover:text-primary-foreground
        "
        title="Fork from this state"
      >
        <GitBranch className="h-3 w-3" />
      </button>

      {/* Timestamp tooltip */}
      <div
        className="
        absolute left-1/2 top-full z-10 mt-1 hidden -translate-x-1/2
        whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px]
        shadow-md group-hover:block
      "
      >
        {new Date(state.createdAt).toLocaleString()}
      </div>
    </div>
  );
}
