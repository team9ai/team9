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
  SubAgentSpawnEvent,
  SubAgentResultEvent,
} from "@/types";
import { agentApi } from "@/services/api";
import { agentEventManager } from "@/services/sse/agent-events";
import type { SubAgentInfo } from "@/components/tree/utils/layout";

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

  // SubAgents
  subAgents: Map<string, SubAgentInfo>;
  subAgentUnsubscribes: Map<string, () => void>;

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
  selectState: (stateId: string, subAgentId?: string) => Promise<void>;

  // Agent control
  injectEvent: (eventType: string, payload?: unknown) => Promise<void>;
  forkFromState: (stateId: string) => Promise<AgentInstance>;

  // Execution mode control
  refreshExecutionModeStatus: () => Promise<void>;
  setExecutionMode: (mode: ExecutionMode) => Promise<void>;
  step: () => Promise<StepResult | null>;

  // SSE events
  handleSSEEvent: (type: SSEEventType, data: unknown) => void;

  // SubAgent helpers
  getSubAgentsArray: () => SubAgentInfo[];
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
  subAgents: new Map(),
  subAgentUnsubscribes: new Map(),
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

      // Cleanup previous subagent subscriptions
      const prevUnsubscribes = get().subAgentUnsubscribes;
      prevUnsubscribes.forEach((unsubscribe) => unsubscribe());

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

      // Load subagent data if agent has subAgentIds
      const subAgents = new Map<string, SubAgentInfo>();
      if (agent.subAgentIds && agent.subAgentIds.length > 0) {
        // Build a map from subAgentId (from provenance.context) to spawn state
        // The spawn state's provenance.context contains the subAgentId
        const spawnStateBySubAgentId = new Map<
          string,
          { parentStateId: string; stateId: string }
        >();
        const resultStateByChildThreadId = new Map<string, string>();

        for (const state of stateHistory) {
          if (state.provenance?.eventType === "LLM_SUBAGENT_SPAWN") {
            // Get subAgentId from provenance context
            const subAgentIdFromContext = state.provenance.context
              ?.subAgentId as string | undefined;
            if (subAgentIdFromContext) {
              // Use this state's ID as the parent - the spawn arrow connects from this state
              // (which contains the spawn chunk)
              spawnStateBySubAgentId.set(subAgentIdFromContext, {
                parentStateId: state.id,
                stateId: state.id,
              });
            }
          }
          if (state.provenance?.eventType === "SUBAGENT_RESULT") {
            // Get childThreadId from provenance context if available
            const childThreadId = state.provenance.context?.childThreadId as
              | string
              | undefined;
            if (childThreadId) {
              resultStateByChildThreadId.set(childThreadId, state.id);
            }
          }
        }

        // Fetch each subagent's data
        for (const childThreadId of agent.subAgentIds) {
          try {
            const subAgent = await agentApi.get(childThreadId);
            const subAgentStates =
              await agentApi.getStateHistory(childThreadId);

            // Find the parent state ID by matching childThreadId with subAgentId pattern
            // subAgentId format: ${parentAgentId}:subagent:${subagentKey}:${childThreadId}
            let parentStateId: string | undefined;
            let resultStateId: string | undefined;

            // Look for spawn state that matches this childThreadId
            for (const [
              subAgentId,
              spawnInfo,
            ] of spawnStateBySubAgentId.entries()) {
              if (subAgentId.includes(childThreadId)) {
                parentStateId = spawnInfo.parentStateId;
                break;
              }
            }

            // If no match by subAgentId pattern, fall back to timestamp matching
            if (!parentStateId) {
              for (const state of stateHistory) {
                if (state.provenance?.eventType === "LLM_SUBAGENT_SPAWN") {
                  const timeDiff = Math.abs(
                    state.createdAt - subAgent.createdAt,
                  );
                  if (timeDiff < 5000) {
                    // Use this state's ID as the parent (spawn arrow connects from this state)
                    parentStateId = state.id;
                    break;
                  }
                }
              }
            }

            // If still no match, use the first state as fallback
            if (!parentStateId && stateHistory.length > 0) {
              parentStateId = stateHistory[0].id;
            }

            // Find result state by childThreadId first, then by timestamp
            resultStateId = resultStateByChildThreadId.get(childThreadId);
            if (!resultStateId && subAgent.status === "completed") {
              for (const state of stateHistory) {
                if (state.provenance?.eventType === "SUBAGENT_RESULT") {
                  if (state.createdAt > subAgent.createdAt) {
                    resultStateId = state.id;
                    break;
                  }
                }
              }
            }

            const subAgentInfo: SubAgentInfo = {
              id: childThreadId,
              name: subAgent.name || "SubAgent",
              parentStateId: parentStateId ?? stateHistory[0]?.id ?? "",
              resultStateId,
              states: subAgentStates,
              isCompleted: subAgent.status === "completed",
            };

            subAgents.set(childThreadId, subAgentInfo);
          } catch (error) {
            console.warn(`Failed to load subagent ${childThreadId}:`, error);
          }
        }
      }

      // Subscribe to SSE events for running subagents
      const subAgentUnsubscribes = new Map<string, () => void>();
      for (const [subAgentId, subAgentInfo] of subAgents.entries()) {
        if (!subAgentInfo.isCompleted) {
          // Subscribe to subagent SSE events using the childThreadId
          const unsubscribe = agentEventManager.subscribe(
            subAgentId,
            (subType, subData) => {
              console.log(
                "[DebugStore] SubAgent SSE event (from load):",
                subAgentId,
                subType,
                subData,
              );

              if (subType === "state:change") {
                // Update subagent states when state changes
                const stateChange = subData as {
                  threadId: string;
                  newState: { id: string; version: number; createdAt: number };
                };

                const currentSubAgents = new Map(get().subAgents);
                const info = currentSubAgents.get(subAgentId);

                if (info) {
                  // Check if state already exists to avoid duplicates
                  const existingState = info.states.find(
                    (s) => s.id === stateChange.newState.id,
                  );
                  if (!existingState) {
                    const newStateSummary: StateSummary = {
                      id: stateChange.newState.id,
                      threadId: stateChange.threadId,
                      version: stateChange.newState.version,
                      createdAt: stateChange.newState.createdAt,
                      chunkCount: 0,
                      provenance: undefined,
                      previousStateId:
                        info.states.length > 0
                          ? info.states[info.states.length - 1].id
                          : undefined,
                    };

                    const updatedSubAgent: SubAgentInfo = {
                      ...info,
                      states: [...info.states, newStateSummary],
                    };

                    currentSubAgents.set(subAgentId, updatedSubAgent);
                    set({ subAgents: currentSubAgents });
                  }
                }
              }
            },
          );
          subAgentUnsubscribes.set(subAgentId, unsubscribe);
        }
      }

      set({
        currentAgentId: agentId,
        currentAgent: agent,
        stateHistory,
        currentState,
        selectedStateId: currentState.id,
        selectedState: currentState,
        executionTree,
        executionModeStatus,
        subAgents,
        subAgentUnsubscribes,
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

    // Cleanup subagent subscriptions
    const unsubscribes = get().subAgentUnsubscribes;
    unsubscribes.forEach((unsubscribe) => unsubscribe());

    set({
      currentAgentId: null,
      currentAgent: null,
      stateHistory: [],
      currentState: null,
      selectedStateId: null,
      selectedState: null,
      executionTree: [],
      subAgents: new Map(),
      subAgentUnsubscribes: new Map(),
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

  // Select a state (supports both main agent and subagent states)
  selectState: async (stateId: string, subAgentId?: string) => {
    const agentId = get().currentAgentId;
    if (!agentId) return;

    try {
      // If subAgentId is provided, fetch from that subagent
      const targetAgentId = subAgentId ?? agentId;
      const state = await agentApi.getState(targetAgentId, stateId);
      set({
        selectedStateId: stateId,
        selectedState: state,
      });
    } catch (error) {
      // If fetching from main agent fails and no subAgentId was provided,
      // try to find the state in subagents
      if (!subAgentId) {
        const subAgents = get().subAgents;
        for (const [subId, subAgentInfo] of subAgents.entries()) {
          const foundState = subAgentInfo.states.find((s) => s.id === stateId);
          if (foundState) {
            try {
              const state = await agentApi.getState(subId, stateId);
              set({
                selectedStateId: stateId,
                selectedState: state,
              });
              return;
            } catch {
              // Continue searching
            }
          }
        }
      }
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
      case "subagent:spawn": {
        // SubAgent spawned - create new SubAgentInfo and subscribe to its events
        const spawnEvent = data as SubAgentSpawnEvent & {
          parentAgentId: string;
          childThreadId: string;
          subagentKey: string;
          subagentId: string;
        };
        console.log("[DebugStore] SubAgent spawned:", spawnEvent);

        // Use childThreadId as the real subagent ID for API calls
        const {
          childThreadId,
          subagentKey,
          subagentId,
          parentStateId: eventParentStateId,
        } = spawnEvent;

        // Check if this subagent already exists (prevent duplicates)
        const existingSubAgents = get().subAgents;
        if (existingSubAgents.has(childThreadId)) {
          console.log(
            "[DebugStore] SubAgent already exists, skipping:",
            childThreadId,
          );
          break;
        }

        // Use parentStateId from the SSE event (the state that triggered spawn)
        // Fall back to current state if not provided
        const stateHistory = get().stateHistory;
        const currentState = get().currentState;
        const parentStateId =
          eventParentStateId ??
          currentState?.id ??
          stateHistory[stateHistory.length - 1]?.id;

        if (!parentStateId) {
          console.warn(
            "[DebugStore] Cannot find parent state for subagent spawn",
          );
          break;
        }

        // Create new SubAgentInfo using childThreadId as the ID for API calls
        const newSubAgentInfo: SubAgentInfo = {
          id: childThreadId, // Use childThreadId for API calls
          name: subagentKey,
          parentStateId,
          resultStateId: undefined,
          states: [],
          isCompleted: false,
        };

        // Update subAgents map - keyed by childThreadId for API compatibility
        const subAgents = new Map(existingSubAgents);
        subAgents.set(childThreadId, newSubAgentInfo);
        set({ subAgents });

        // Subscribe to subagent SSE events using the composite subagentId
        const unsubscribe = agentEventManager.subscribe(
          subagentId,
          (subType, subData) => {
            console.log(
              "[DebugStore] SubAgent SSE event:",
              childThreadId,
              subType,
              subData,
            );

            if (subType === "state:change") {
              // Update subagent states when state changes
              const stateChange = subData as {
                threadId: string;
                newState: { id: string; version: number; createdAt: number };
              };

              const currentSubAgents = new Map(get().subAgents);
              const subAgentInfo = currentSubAgents.get(childThreadId);

              if (subAgentInfo) {
                // Create a StateSummary from the state change event
                const newStateSummary: StateSummary = {
                  id: stateChange.newState.id,
                  threadId: stateChange.threadId,
                  version: stateChange.newState.version,
                  createdAt: stateChange.newState.createdAt,
                  chunkCount: 0, // Will be updated if available
                  provenance: undefined,
                  previousStateId:
                    subAgentInfo.states.length > 0
                      ? subAgentInfo.states[subAgentInfo.states.length - 1].id
                      : undefined,
                };

                // Add state to subagent's states array
                const updatedSubAgent: SubAgentInfo = {
                  ...subAgentInfo,
                  states: [...subAgentInfo.states, newStateSummary],
                };

                currentSubAgents.set(childThreadId, updatedSubAgent);
                set({ subAgents: currentSubAgents });
              }
            }
          },
        );

        // Store unsubscribe function - keyed by childThreadId for consistency
        const unsubscribes = new Map(get().subAgentUnsubscribes);
        unsubscribes.set(childThreadId, unsubscribe);
        set({ subAgentUnsubscribes: unsubscribes });

        // Fetch the initial state history for the subagent
        agentApi
          .getStateHistory(childThreadId)
          .then((states) => {
            const currentSubAgents = new Map(get().subAgents);
            const subAgentInfo = currentSubAgents.get(childThreadId);
            if (subAgentInfo) {
              const updatedSubAgent: SubAgentInfo = {
                ...subAgentInfo,
                states,
              };
              currentSubAgents.set(childThreadId, updatedSubAgent);
              set({ subAgents: currentSubAgents });
            }
          })
          .catch((error) => {
            console.warn(
              `[DebugStore] Failed to fetch subagent states for ${childThreadId}:`,
              error,
            );
          });

        get().refreshStateHistory();
        break;
      }
      case "subagent:result": {
        // SubAgent completed - update SubAgentInfo with result
        const resultEvent = data as SubAgentResultEvent & {
          parentAgentId?: string;
          childThreadId?: string;
          subagentKey?: string;
        };
        console.log("[DebugStore] SubAgent result:", resultEvent);

        // Find the subagent by childThreadId (which is our key)
        const currentSubAgents = new Map(get().subAgents);
        const { childThreadId } = resultEvent;

        // Try to find the subagent - first by childThreadId, then by subAgentId
        let foundSubAgentId: string | undefined = childThreadId;
        if (!currentSubAgents.has(foundSubAgentId ?? "")) {
          // Fallback: search by subAgentId pattern
          for (const [id] of currentSubAgents.entries()) {
            if (id.includes(resultEvent.subAgentId)) {
              foundSubAgentId = id;
              break;
            }
          }
        }

        if (foundSubAgentId && currentSubAgents.has(foundSubAgentId)) {
          const subAgentInfo = currentSubAgents.get(foundSubAgentId)!;

          // Get current state as the result state
          const currentState = get().currentState;
          const stateHistory = get().stateHistory;
          const resultStateId =
            currentState?.id ?? stateHistory[stateHistory.length - 1]?.id;

          const updatedSubAgent: SubAgentInfo = {
            ...subAgentInfo,
            isCompleted: true,
            resultStateId,
          };

          currentSubAgents.set(foundSubAgentId, updatedSubAgent);
          set({ subAgents: currentSubAgents });

          // Cleanup subscription
          const unsubscribes = get().subAgentUnsubscribes;
          const unsubscribe = unsubscribes.get(foundSubAgentId);
          if (unsubscribe) {
            unsubscribe();
            const newUnsubscribes = new Map(unsubscribes);
            newUnsubscribes.delete(foundSubAgentId);
            set({ subAgentUnsubscribes: newUnsubscribes });
          }
        }

        get().refreshStateHistory();
        break;
      }
      default:
        // Log other events for debugging
        console.log("SSE event:", type, data);
    }
  },

  // Get subAgents as an array for the ExecutionTree
  getSubAgentsArray: () => {
    return Array.from(get().subAgents.values());
  },
}));

/**
 * Build execution tree from state history
 *
 * Supports:
 * - Linear execution (simple chain)
 * - Fork branches (multiple children from same parent)
 * - Tree structure via previousStateId
 */
function buildExecutionTree(states: StateSummary[]): ExecutionNode[] {
  if (states.length === 0) return [];

  // Build parent -> children mapping
  const childrenMap = new Map<string | null, StateSummary[]>();

  for (const state of states) {
    const parentId = state.previousStateId ?? null;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(state);
  }

  // Sort children by createdAt to maintain chronological order
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.createdAt - b.createdAt);
  }

  // Recursive node builder
  function buildNode(state: StateSummary): ExecutionNode {
    const children = childrenMap.get(state.id) ?? [];

    return {
      id: `node_${state.id}`,
      stateId: state.id,
      version: state.version,
      triggerEvent: state.provenance?.eventType
        ? {
            type: state.provenance.eventType,
            timestamp: state.createdAt,
          }
        : undefined,
      children: children.map(buildNode),
      isSubAgent: false,
    };
  }

  // Find root nodes (no previousStateId)
  const roots = childrenMap.get(null) ?? [];

  return roots.map(buildNode);
}
