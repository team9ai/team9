import { create } from "zustand";
import type {
  AgentInstance,
  MemoryState,
  StateSummary,
  ExecutionNode,
  SSEEventType,
  StateChangeEvent,
} from "@/types";
import { agentApi } from "@/services/api";
import { agentEventManager } from "@/services/sse/agent-events";

interface DebugStore {
  // Current agent
  currentAgentId: string | null;
  currentAgent: AgentInstance | null;

  // States
  stateHistory: StateSummary[];
  currentState: MemoryState | null;
  selectedStateId: string | null;
  selectedState: MemoryState | null;

  // Execution tree
  executionTree: ExecutionNode[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentAgent: (agentId: string) => Promise<void>;
  clearCurrentAgent: () => void;
  refreshAgent: () => Promise<void>;
  refreshStateHistory: () => Promise<void>;
  selectState: (stateId: string) => Promise<void>;

  // Agent control
  pauseAgent: () => Promise<void>;
  resumeAgent: () => Promise<void>;
  injectEvent: (eventType: string, payload?: unknown) => Promise<void>;
  forkFromState: (stateId: string) => Promise<AgentInstance>;

  // SSE events
  handleSSEEvent: (type: SSEEventType, data: unknown) => void;
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  // Initial state
  currentAgentId: null,
  currentAgent: null,
  stateHistory: [],
  currentState: null,
  selectedStateId: null,
  selectedState: null,
  executionTree: [],
  isLoading: false,
  error: null,

  // Set current agent and subscribe to events
  setCurrentAgent: async (agentId: string) => {
    set({ isLoading: true, error: null });

    try {
      // Unsubscribe from previous agent
      const prevAgentId = get().currentAgentId;
      if (prevAgentId) {
        agentEventManager.disconnect(prevAgentId);
      }

      // Fetch agent
      const agent = await agentApi.get(agentId);

      // Fetch state history
      const stateHistory = await agentApi.getStateHistory(agentId);

      // Fetch current state
      const currentState = await agentApi.getCurrentState(agentId);

      // Build execution tree from state history
      const executionTree = buildExecutionTree(stateHistory);

      set({
        currentAgentId: agentId,
        currentAgent: agent,
        stateHistory,
        currentState,
        selectedStateId: currentState.id,
        selectedState: currentState,
        executionTree,
        isLoading: false,
      });

      // Subscribe to SSE events
      agentEventManager.subscribe(agentId, (type, data) => {
        get().handleSSEEvent(type, data);
      });
    } catch (error) {
      set({
        error: (error as Error).message,
        isLoading: false,
      });
    }
  },

  // Clear current agent
  clearCurrentAgent: () => {
    const agentId = get().currentAgentId;
    if (agentId) {
      agentEventManager.disconnect(agentId);
    }

    set({
      currentAgentId: null,
      currentAgent: null,
      stateHistory: [],
      currentState: null,
      selectedStateId: null,
      selectedState: null,
      executionTree: [],
      error: null,
    });
  },

  // Refresh current agent
  refreshAgent: async () => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      const agent = await agentApi.get(agentId);
      set({ currentAgent: agent });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Refresh state history
  refreshStateHistory: async () => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      const stateHistory = await agentApi.getStateHistory(agentId);
      const currentState = await agentApi.getCurrentState(agentId);
      const executionTree = buildExecutionTree(stateHistory);

      set({
        stateHistory,
        currentState,
        executionTree,
      });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Select a state
  selectState: async (stateId: string) => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      const state = await agentApi.getState(agentId, stateId);
      set({
        selectedStateId: stateId,
        selectedState: state,
      });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Pause agent
  pauseAgent: async () => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      await agentApi.pause(agentId);
      await get().refreshAgent();
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Resume agent
  resumeAgent: async () => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      await agentApi.resume(agentId);
      await get().refreshAgent();
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Inject event
  injectEvent: async (eventType: string, payload?: unknown) => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      await agentApi.injectEvent(agentId, {
        event: { type: eventType, payload },
      });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Fork from state
  forkFromState: async (stateId: string) => {
    const agentId = get().currentAgentId;
    if (!agentId) throw new Error("No agent selected");

    const forkedAgent = await agentApi.fork(agentId, { stateId });
    return forkedAgent;
  },

  // Handle SSE events
  handleSSEEvent: (type: SSEEventType, data: unknown) => {
    switch (type) {
      case "state:change": {
        const event = data as StateChangeEvent;
        // Refresh state history when state changes
        get().refreshStateHistory();
        break;
      }
      case "agent:paused":
      case "agent:resumed":
        get().refreshAgent();
        break;
      case "subagent:spawn":
      case "subagent:result":
        get().refreshStateHistory();
        break;
      default:
        // Log other events for debugging
        console.log("SSE event:", type, data);
    }
  },
}));

/**
 * Build execution tree from state history
 */
function buildExecutionTree(states: StateSummary[]): ExecutionNode[] {
  if (states.length === 0) return [];

  // Simple linear tree for now
  // TODO: Handle branching (forks) and sub-agents
  return states.map((state, index) => ({
    id: `node_${state.id}`,
    stateId: state.id,
    version: state.version,
    triggerEvent: undefined, // TODO: Get from state change event
    children: [],
    isSubAgent: false,
  }));
}
