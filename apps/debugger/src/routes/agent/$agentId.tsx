import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useDebugStore } from "@/stores/useDebugStore";
import { ExecutionTree } from "@/components/tree/ExecutionTree";
import { StateViewer } from "@/components/state/StateViewer";
import { AgentControls } from "@/components/agent/AgentControls";

export const Route = createFileRoute("/agent/$agentId")({
  component: AgentDebugPage,
});

function AgentDebugPage() {
  const { agentId } = Route.useParams();
  const {
    currentAgent,
    isLoading,
    error,
    stateHistory,
    selectedState,
    setCurrentAgent,
    clearCurrentAgent,
  } = useDebugStore();

  useEffect(() => {
    setCurrentAgent(agentId);
    return () => clearCurrentAgent();
  }, [agentId, setCurrentAgent, clearCurrentAgent]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading agent...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!currentAgent) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
        <p className="text-destructive">Agent not found</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      {/* Header with agent info and controls */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <h1 className="text-xl font-bold">{currentAgent.name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span>ID: {currentAgent.id.slice(0, 16)}...</span>
            <span>Model: {currentAgent.llmConfig.model}</span>
            {currentAgent.modelOverride && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                Override: {currentAgent.modelOverride.model}
              </span>
            )}
          </div>
        </div>
        <AgentControls />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Execution tree */}
        <div className="w-2/3 overflow-auto rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-lg font-semibold">Execution Tree</h2>
          <ExecutionTree states={stateHistory} />
        </div>

        {/* State viewer */}
        <div className="w-1/3 overflow-auto rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-lg font-semibold">
            {selectedState
              ? `State: v${selectedState.version}`
              : "Select a State"}
          </h2>
          {selectedState ? (
            <StateViewer state={selectedState} agentId={agentId} />
          ) : (
            <p className="text-muted-foreground">
              Click on a node in the execution tree to view its state.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
