import { create } from "zustand";
import type {
  AgentInstance,
  MemoryState,
  StateSummary,
  ExecutionNode,
  SSEEventType,
  ExecutionMode,
  ExecutionModeStatus,
  StepResult,
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

  // Execution mode
  executionModeStatus: ExecutionModeStatus | null;
  isStepping: boolean;
  lastStepResult: StepResult | null;

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
  injectEvent: (eventType: string, payload?: unknown) => Promise<void>;
  forkFromState: (stateId: string) => Promise<AgentInstance>;

  // Execution mode control
  refreshExecutionModeStatus: () => Promise<void>;
  setExecutionMode: (mode: ExecutionMode) => Promise<void>;
  step: () => Promise<StepResult | null>;

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
  executionModeStatus: null,
  isStepping: false,
  lastStepResult: null,
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

      // Fetch execution mode status
      const executionModeStatus =
        await agentApi.getExecutionModeStatus(agentId);

      set({
        currentAgentId: agentId,
        currentAgent: agent,
        stateHistory,
        currentState,
        selectedStateId: currentState.id,
        selectedState: currentState,
        executionTree,
        executionModeStatus,
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
      executionModeStatus: null,
      isStepping: false,
      lastStepResult: null,
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

      // Always select the latest state (currentState) after refresh
      set({
        stateHistory,
        currentState,
        selectedStateId: currentState.id,
        selectedState: currentState,
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

  // Inject event
  injectEvent: async (eventType: string, payload?: unknown) => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      // Build the event by spreading payload fields at the event level
      // This matches the AgentEvent structure expected by the server
      const event = {
        type: eventType,
        timestamp: Date.now(),
        ...(typeof payload === "object" && payload !== null ? payload : {}),
      };

      await agentApi.injectEvent(agentId, { event });

      // Refresh state history after injection
      // This ensures we see the new state even if SSE is delayed
      await get().refreshStateHistory();
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

  // Refresh execution mode status
  refreshExecutionModeStatus: async () => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      const status = await agentApi.getExecutionModeStatus(agentId);
      set({ executionModeStatus: status });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Set execution mode
  setExecutionMode: async (mode: ExecutionMode) => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      const status = await agentApi.setExecutionMode(agentId, mode);
      set({ executionModeStatus: status });
      await get().refreshAgent();
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  // Execute a single step
  step: async () => {
    const agentId = get().currentAgentId;
    if (!agentId) return null;

    try {
      set({ isStepping: true });
      const result = await agentApi.step(agentId);
      set({ lastStepResult: result, isStepping: false });

      // Refresh state history and execution mode status after step
      await get().refreshStateHistory();
      await get().refreshExecutionModeStatus();

      return result;
    } catch (error) {
      set({ error: (error as Error).message, isStepping: false });
      return null;
    }
  },

  // Handle SSE events
  handleSSEEvent: (type: SSEEventType, data: unknown) => {
    console.log("[DebugStore] SSE event received:", type, data);
    switch (type) {
      case "state:change":
        // Refresh state history when state changes
        console.log(
          "[DebugStore] Refreshing state history due to state:change",
        );
        get().refreshStateHistory();
        break;
      case "agent:status_changed":
        // Refresh agent when status changes
        get().refreshAgent();
        break;
      case "agent:mode_changed":
        // Refresh execution mode status and agent when mode changes
        get().refreshExecutionModeStatus();
        get().refreshAgent();
        break;
      case "agent:stepped":
        // Refresh state history and execution mode status after a step
        get().refreshStateHistory();
        get().refreshExecutionModeStatus();
        break;
      case "agent:response":
        // LLM has responded - refresh state history to see the response
        console.log(
          "[DebugStore] LLM response received, refreshing state history",
        );
        get().refreshStateHistory();
        break;
      case "agent:thinking":
        // LLM is thinking - could show loading indicator
        console.log("[DebugStore] Agent is thinking...");
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
