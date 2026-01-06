import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useDebugStore } from "@/stores/useDebugStore";
import type { StateSummary } from "@/types";
import { nodeTypes } from "./nodes";
import { buildTreeLayout, type SubAgentInfo } from "./utils/layout";
import { Circle, ArrowRight, Bot, GitBranch } from "lucide-react";
import type { StateNodeData } from "./nodes/StateNode";
import type { SubAgentNodeData } from "./nodes/SubAgentNode";

// Stable empty array reference to prevent unnecessary re-renders
const EMPTY_SUBAGENTS: SubAgentInfo[] = [];

interface ExecutionTreeProps {
  states: StateSummary[];
}

/**
 * ExecutionTree - Visualizes agent execution states using React Flow
 *
 * Features:
 * - Tree/branch visualization for fork operations
 * - SubAgent visualization (displayed below main agent)
 * - Interactive node selection
 * - Pan/zoom navigation
 * - Fork action on hover
 */
function ExecutionTreeInner({ states }: ExecutionTreeProps) {
  const { selectedStateId, selectState, forkFromState } = useDebugStore();
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Handle node click via React Flow's onNodeClick
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Both StateNodeData and SubAgentNodeData have state.id
      const data = node.data as StateNodeData | SubAgentNodeData;
      if (data.state?.id) {
        // For SubAgentNode, pass the subAgentId for proper API call
        const subAgentId =
          node.type === "subAgentNode"
            ? (data as SubAgentNodeData).subAgentId
            : undefined;
        selectState(data.state.id, subAgentId);
      }
    },
    [selectState],
  );

  // Callbacks for node interactions (used in node data)
  const handleSelect = useCallback(
    (stateId: string, subAgentId?: string) => {
      selectState(stateId, subAgentId);
    },
    [selectState],
  );

  const handleFork = useCallback(
    (stateId: string) => {
      forkFromState(stateId);
    },
    [forkFromState],
  );

  // Get SubAgent info from store
  // Subscribe to a serialized version of subAgents to detect meaningful changes
  const subAgentsKey = useDebugStore((state) => {
    if (state.subAgents.size === 0) return "";
    // Create a key that changes when subagent content changes
    const entries = Array.from(state.subAgents.values()).map(
      (info) =>
        `${info.id}:${info.states.length}:${info.isCompleted}:${info.resultStateId ?? ""}`,
    );
    return entries.join("|");
  });

  // Memoize subAgents array based on the serialized key
  const subAgents: SubAgentInfo[] = useMemo(() => {
    if (subAgentsKey === "") return EMPTY_SUBAGENTS;
    return Array.from(useDebugStore.getState().subAgents.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAgentsKey]);

  // Build layout when states change
  // Note: We use refs for callbacks to avoid unnecessary re-renders
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildTreeLayout(
      states,
      subAgents,
      selectedStateId,
      {
        onSelect: handleSelect,
        onFork: handleFork,
      },
    );

    setNodes(newNodes);
    setEdges(newEdges);
  }, [
    states,
    subAgents,
    selectedStateId,
    handleSelect,
    handleFork,
    setNodes,
    setEdges,
  ]);

  // Fit view when nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      // Small delay to ensure nodes are rendered
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView]);

  if (states.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        No states yet. Inject an event to start the agent.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[300px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="hsl(var(--muted-foreground))" gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === "subAgentNode") {
              return "hsl(var(--blue-400, 96 165 250))";
            }
            if (node.data?.isSelected) {
              return "hsl(var(--primary))";
            }
            return "hsl(var(--muted-foreground))";
          }}
          maskColor="hsl(var(--background) / 0.8)"
          className="!bg-background"
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex items-center gap-4 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-2 rounded-md border">
        <div className="flex items-center gap-1">
          <Circle className="h-3 w-3 fill-primary stroke-primary" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1">
          <Circle className="h-3 w-3 stroke-muted-foreground" />
          <span>State</span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowRight className="h-3 w-3" />
          <span>Transition</span>
        </div>
        <div className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          <span>Fork</span>
        </div>
        <div className="flex items-center gap-1">
          <Bot className="h-3 w-3 text-blue-500" />
          <span>SubAgent</span>
        </div>
      </div>
    </div>
  );
}

/**
 * ExecutionTree with ReactFlowProvider wrapper
 */
export function ExecutionTree(props: ExecutionTreeProps) {
  return (
    <ReactFlowProvider>
      <ExecutionTreeInner {...props} />
    </ReactFlowProvider>
  );
}
