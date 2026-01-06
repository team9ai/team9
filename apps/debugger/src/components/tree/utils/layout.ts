import type { Node, Edge } from "@xyflow/react";
import type { StateSummary } from "@/types";
import type { StateNodeData } from "../nodes/StateNode";
import type { SubAgentNodeData } from "../nodes/SubAgentNode";

/**
 * Layout configuration
 */
const LAYOUT_CONFIG = {
  // Main agent nodes
  mainNodeWidth: 96, // 24 * 4 (w-24 in tailwind)
  mainNodeHeight: 64, // 16 * 4 (h-16 in tailwind)
  mainHorizontalGap: 150, // Gap between main agent nodes
  mainVerticalGap: 80, // Gap between fork branches

  // SubAgent nodes
  subAgentNodeWidth: 80, // 20 * 4 (w-20 in tailwind)
  subAgentNodeHeight: 56, // 14 * 4 (h-14 in tailwind)
  subAgentHorizontalGap: 120, // Gap between SubAgent nodes
  subAgentVerticalOffset: 150, // Y offset for first SubAgent row
  subAgentRowGap: 120, // Gap between SubAgent rows
};

/**
 * SubAgent info for layout
 */
export interface SubAgentInfo {
  id: string;
  name?: string;
  parentStateId: string; // The main agent state that spawned this SubAgent
  resultStateId?: string; // The main agent state that received the result
  states: StateSummary[];
  isCompleted: boolean;
  /** True if this is extracted from state history without real data (not clickable) */
  isPlaceholder?: boolean;
}

/**
 * Layout result
 */
export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Extract SubAgent info from state history
 * Detects states triggered by LLM_SUBAGENT_SPAWN and SUBAGENT_RESULT events
 */
export function extractSubAgentsFromStates(
  states: StateSummary[],
): SubAgentInfo[] {
  const subAgentMap = new Map<string, SubAgentInfo>();

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    const eventType = state.provenance?.eventType;

    // Detect subagent spawn
    if (eventType === "LLM_SUBAGENT_SPAWN") {
      // Use state id as a proxy for subagent id since we don't have the actual subagent id
      const subagentId = `subagent_from_state_${state.id}`;

      if (!subAgentMap.has(subagentId)) {
        subAgentMap.set(subagentId, {
          id: subagentId,
          name: "SubAgent", // Default name, could be extracted from chunk content if available
          parentStateId: state.id,
          resultStateId: undefined,
          states: [], // SubAgent's internal states not available from main agent's state history
          isCompleted: false,
        });
      }
    }

    // Detect subagent result - look for SUBAGENT_RESULT event type
    if (eventType === "SUBAGENT_RESULT") {
      // Find the corresponding spawn state by looking backwards
      // The spawn state should be an ancestor of this result state
      for (let j = i - 1; j >= 0; j--) {
        const prevState = states[j];
        if (prevState.provenance?.eventType === "LLM_SUBAGENT_SPAWN") {
          const subagentId = `subagent_from_state_${prevState.id}`;
          const subAgentInfo = subAgentMap.get(subagentId);
          if (subAgentInfo && !subAgentInfo.isCompleted) {
            subAgentInfo.resultStateId = state.id;
            subAgentInfo.isCompleted = true;
            break;
          }
        }
      }
    }
  }

  return Array.from(subAgentMap.values());
}

/**
 * Build tree layout from states
 *
 * Supports:
 * - Linear execution (simple left-to-right)
 * - Fork branches (states with same previousStateId)
 * - SubAgent visualization (states from child agents)
 */
export function buildTreeLayout(
  mainStates: StateSummary[],
  subAgents: SubAgentInfo[],
  selectedStateId: string | null,
  callbacks: {
    onSelect: (stateId: string, subAgentId?: string) => void;
    onFork: (stateId: string) => void;
  },
): LayoutResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (mainStates.length === 0) {
    return { nodes, edges };
  }

  // Build parent -> children mapping
  const childrenMap = new Map<string | null, StateSummary[]>();
  for (const state of mainStates) {
    const parentId = state.previousStateId ?? null;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(state);
  }

  // Track node positions for SubAgent layout
  const nodePositions = new Map<string, { x: number; y: number }>();

  // Use provided subAgents directly - they contain real data from API or SSE
  // Don't extract from states as those would only have placeholder IDs
  const mergedSubAgents = [...subAgents];

  // Build SubAgent spawn info and result state mapping
  const spawnedSubAgents = new Map<string, SubAgentInfo[]>();
  const resultStates = new Set<string>(); // States that received subagent results

  for (const subAgent of mergedSubAgents) {
    if (!spawnedSubAgents.has(subAgent.parentStateId)) {
      spawnedSubAgents.set(subAgent.parentStateId, []);
    }
    spawnedSubAgents.get(subAgent.parentStateId)!.push(subAgent);

    // Track which states have received results
    if (subAgent.isCompleted && subAgent.resultStateId) {
      resultStates.add(subAgent.resultStateId);
    }
  }

  // Layout main agent nodes recursively
  function layoutBranch(
    state: StateSummary,
    x: number,
    y: number,
    depth: number,
  ): number {
    // Add node
    const spawned = spawnedSubAgents.get(state.id);
    const hasSpawned = spawned && spawned.length > 0;

    const nodeData: StateNodeData = {
      state,
      isSelected: state.id === selectedStateId,
      isMain: true,
      onSelect: callbacks.onSelect,
      onFork: callbacks.onFork,
      hasSpawnedSubAgents: hasSpawned,
      isWaitingForSubAgent: false, // TODO: Determine from agent status
      hasReceivedResult: resultStates.has(state.id),
    };

    nodes.push({
      id: state.id,
      type: "stateNode",
      position: { x, y },
      data: nodeData,
    });

    nodePositions.set(state.id, { x, y });

    // Get children
    const children = childrenMap.get(state.id) ?? [];

    if (children.length === 0) {
      return y;
    }

    // Add edges to children
    for (const child of children) {
      edges.push({
        id: `edge_${state.id}_${child.id}`,
        source: state.id,
        target: child.id,
        type: "smoothstep",
        style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 2 },
        markerEnd: {
          type: "arrowclosed" as const,
          color: "hsl(var(--muted-foreground))",
          width: 10,
          height: 10,
        },
      });
    }

    // Layout children
    const nextX = x + LAYOUT_CONFIG.mainHorizontalGap;

    if (children.length === 1) {
      // Single child - same y level
      return layoutBranch(children[0], nextX, y, depth + 1);
    }

    // Multiple children (fork) - stack vertically
    let currentY = y;
    let maxY = y;

    for (let i = 0; i < children.length; i++) {
      const childY =
        i === 0 ? currentY : currentY + LAYOUT_CONFIG.mainVerticalGap;
      const branchMaxY = layoutBranch(children[i], nextX, childY, depth + 1);
      maxY = Math.max(maxY, branchMaxY);
      currentY = branchMaxY + LAYOUT_CONFIG.mainVerticalGap;
    }

    return maxY;
  }

  // Find root nodes (no previousStateId)
  const roots = childrenMap.get(null) ?? [];

  let currentY = 0;
  for (const root of roots) {
    const branchMaxY = layoutBranch(root, 0, currentY, 0);
    currentY = branchMaxY + LAYOUT_CONFIG.mainVerticalGap;
  }

  // Layout SubAgent nodes
  // Track how many subAgents are at each row (for stacking multiple subagents)
  let subAgentRowIndex = 0;

  for (const subAgent of mergedSubAgents) {
    const parentPos = nodePositions.get(subAgent.parentStateId);
    if (!parentPos) continue;

    // Position subagent row below the parent node
    const subAgentRowY =
      parentPos.y +
      LAYOUT_CONFIG.mainNodeHeight +
      LAYOUT_CONFIG.subAgentVerticalOffset +
      subAgentRowIndex * LAYOUT_CONFIG.subAgentRowGap;
    const startX = parentPos.x;

    // Handle case when no states yet (subagent just spawned, loading)
    if (subAgent.states.length === 0) {
      // Create a placeholder node for starting subagent
      const placeholderNodeId = `${subAgent.id}_loading`;

      // Add spawn edge to placeholder
      edges.push({
        id: `spawn_${subAgent.id}`,
        source: subAgent.parentStateId,
        sourceHandle: "spawn",
        target: placeholderNodeId,
        type: "smoothstep",
        style: {
          stroke: "hsl(var(--blue-500, 59 130 246))",
          strokeWidth: 2,
          strokeDasharray: "5,5",
        },
        markerEnd: {
          type: "arrowclosed" as const,
          color: "hsl(var(--blue-500, 59 130 246))",
          width: 10,
          height: 10,
        },
        animated: true,
      });

      // Create placeholder state for display
      const placeholderState: StateSummary = {
        id: placeholderNodeId,
        threadId: subAgent.id,
        version: 0,
        createdAt: Date.now(),
        chunkCount: 0,
      };

      const placeholderData: SubAgentNodeData = {
        state: placeholderState,
        isSelected: false,
        subAgentId: subAgent.id,
        subAgentName: subAgent.name,
        onSelect: () => {}, // No-op for placeholder
        isCompleted: false,
        isRunning: true,
        isFirst: true,
        isLast: true,
      };

      nodes.push({
        id: placeholderNodeId,
        type: "subAgentNode",
        position: { x: startX, y: subAgentRowY },
        data: placeholderData,
      });

      subAgentRowIndex++;
      continue;
    }

    // Add spawn edge (from parent to first SubAgent node)
    const firstSubAgentNodeId = `${subAgent.id}_${subAgent.states[0].id}`;
    edges.push({
      id: `spawn_${subAgent.id}`,
      source: subAgent.parentStateId,
      sourceHandle: "spawn",
      target: firstSubAgentNodeId,
      type: "smoothstep",
      style: {
        stroke: "hsl(var(--blue-500, 59 130 246))",
        strokeWidth: 2,
        strokeDasharray: "5,5",
      },
      markerEnd: {
        type: "arrowclosed" as const,
        color: "hsl(var(--blue-500, 59 130 246))",
        width: 10,
        height: 10,
      },
      animated: true,
    });

    // Layout SubAgent states
    for (let i = 0; i < subAgent.states.length; i++) {
      const state = subAgent.states[i];
      const isFirst = i === 0;
      const isLast = i === subAgent.states.length - 1;

      const nodeId = `${subAgent.id}_${state.id}`;
      const nodeX = startX + i * LAYOUT_CONFIG.subAgentHorizontalGap;

      const nodeData: SubAgentNodeData = {
        state,
        isSelected: state.id === selectedStateId,
        subAgentId: subAgent.id,
        subAgentName: subAgent.name,
        onSelect: callbacks.onSelect,
        isCompleted: subAgent.isCompleted && isLast,
        isRunning: !subAgent.isCompleted && isLast,
        isFirst,
        isLast,
      };

      nodes.push({
        id: nodeId,
        type: "subAgentNode",
        position: { x: nodeX, y: subAgentRowY },
        data: nodeData,
      });

      // Add edge to next SubAgent node
      if (!isLast) {
        const nextNodeId = `${subAgent.id}_${subAgent.states[i + 1].id}`;
        edges.push({
          id: `edge_${nodeId}_${nextNodeId}`,
          source: nodeId,
          target: nextNodeId,
          type: "smoothstep",
          style: {
            stroke: "hsl(var(--blue-400, 96 165 250))",
            strokeWidth: 2,
          },
          markerEnd: {
            type: "arrowclosed" as const,
            color: "hsl(var(--blue-400, 96 165 250))",
            width: 10,
            height: 10,
          },
        });
      }

      // Add result edge (from last SubAgent node to result state)
      if (isLast && subAgent.isCompleted && subAgent.resultStateId) {
        edges.push({
          id: `result_${subAgent.id}`,
          source: nodeId,
          sourceHandle: "result",
          target: subAgent.resultStateId,
          targetHandle: "bottom", // Connect to bottom handle of result state
          type: "smoothstep",
          style: {
            stroke: "hsl(var(--green-500, 34 197 94))",
            strokeWidth: 2,
            strokeDasharray: "5,5",
          },
          markerEnd: {
            type: "arrowclosed" as const,
            color: "hsl(var(--green-500, 34 197 94))",
            width: 10,
            height: 10,
          },
          animated: true,
        });
      }
    }

    subAgentRowIndex++;
  }

  return { nodes, edges };
}
