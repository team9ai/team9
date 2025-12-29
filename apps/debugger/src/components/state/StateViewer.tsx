import { useState } from "react";
import type { MemoryState, MemoryChunk, WorkingFlowChild, Step } from "@/types";
import {
  ChevronDown,
  ChevronRight,
  Edit2,
  Lock,
  Unlock,
  GitBranch,
  ExternalLink,
  X,
  Loader2,
} from "lucide-react";
import { agentApi } from "@/services/api/agent.api";

interface StateViewerProps {
  state: MemoryState;
  agentId?: string;
}

/**
 * Get display name for event type
 */
function getEventTypeDisplay(eventType?: string): string {
  if (!eventType) return "Unknown";
  // Convert snake_case to Title Case
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Get color for provenance source
 */
function getSourceColor(source?: string): string {
  switch (source) {
    case "event_dispatch":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "compaction":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "truncation":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "manual":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "fork":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "initial":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

/**
 * Get status color for step status
 */
function getStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

/**
 * Step detail modal component
 */
function StepDetailModal({
  step,
  isLoading,
  error,
  onClose,
}: {
  step: Step | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (!step && !isLoading && !error) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Step Details</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">
              Loading step details...
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {step && !isLoading && (
          <div className="space-y-4">
            {/* Step metadata */}
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted-foreground">Step ID:</span>
                  <span className="ml-1 font-mono text-xs">{step.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span
                    className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${getStatusColor(step.status)}`}
                  >
                    {step.status}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Thread ID:</span>
                  <span className="ml-1 font-mono text-xs">
                    {step.threadId.slice(0, 12)}...
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="ml-1">
                    {step.duration ? `${step.duration}ms` : "In progress..."}
                  </span>
                </div>
              </div>
            </div>

            {/* Timing info */}
            <div className="rounded-md border p-3 text-sm">
              <h3 className="mb-2 font-medium">Timing</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Started:</span>
                  <span className="ml-1">
                    {new Date(step.startedAt).toLocaleString()}
                  </span>
                </div>
                {step.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completed:</span>
                    <span className="ml-1">
                      {new Date(step.completedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Trigger event */}
            <div className="rounded-md border p-3 text-sm">
              <h3 className="mb-2 font-medium">Trigger Event</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Event Type:</span>
                  <span className="ml-1 font-semibold">
                    {getEventTypeDisplay(step.triggerEvent.type)}
                  </span>
                </div>
                {step.triggerEvent.eventId && (
                  <div>
                    <span className="text-muted-foreground">Event ID:</span>
                    <span className="ml-1 font-mono">
                      {step.triggerEvent.eventId.slice(0, 12)}...
                    </span>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground">Event Time:</span>
                  <span className="ml-1">
                    {new Date(step.triggerEvent.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* LLM Interaction - the request/response to/from LLM */}
            {step.llmInteraction && (
              <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 text-sm">
                <h3 className="mb-2 font-medium text-purple-700 dark:text-purple-300">
                  LLM Interaction
                </h3>

                {/* LLM timing and usage */}
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="ml-1 font-semibold">
                      {step.llmInteraction.duration
                        ? `${step.llmInteraction.duration}ms`
                        : "N/A"}
                    </span>
                  </div>
                  {step.llmInteraction.response?.finishReason && (
                    <div>
                      <span className="text-muted-foreground">
                        Finish Reason:
                      </span>
                      <span className="ml-1">
                        {step.llmInteraction.response.finishReason}
                      </span>
                    </div>
                  )}
                  {step.llmInteraction.response?.usage && (
                    <>
                      <div>
                        <span className="text-muted-foreground">
                          Prompt Tokens:
                        </span>
                        <span className="ml-1">
                          {step.llmInteraction.response.usage.promptTokens}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Completion Tokens:
                        </span>
                        <span className="ml-1">
                          {step.llmInteraction.response.usage.completionTokens}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* LLM Request - Messages sent to LLM */}
                <div className="mb-3">
                  <h4 className="mb-1 text-xs font-medium text-purple-600 dark:text-purple-400">
                    Request ({step.llmInteraction.request.messages.length}{" "}
                    messages)
                  </h4>
                  <div className="max-h-64 space-y-2 overflow-auto">
                    {step.llmInteraction.request.messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`rounded p-2 text-xs ${
                          msg.role === "system"
                            ? "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
                            : msg.role === "user"
                              ? "bg-blue-50 dark:bg-blue-900/30"
                              : "bg-green-50 dark:bg-green-900/30"
                        }`}
                      >
                        <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {msg.role}
                        </div>
                        <pre className="whitespace-pre-wrap break-words">
                          {typeof msg.content === "string"
                            ? msg.content.slice(0, 500) +
                              (msg.content.length > 500 ? "..." : "")
                            : JSON.stringify(msg.content, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LLM Tools if available */}
                {step.llmInteraction.request.tools &&
                  step.llmInteraction.request.tools.length > 0 && (
                    <div className="mb-3">
                      <h4 className="mb-1 text-xs font-medium text-purple-600 dark:text-purple-400">
                        Tools ({step.llmInteraction.request.tools.length})
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {step.llmInteraction.request.tools.map((tool, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
                          >
                            {tool.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                {/* LLM Response */}
                {step.llmInteraction.response && (
                  <div className="mb-3">
                    <h4 className="mb-1 text-xs font-medium text-purple-600 dark:text-purple-400">
                      Response
                    </h4>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-green-50 p-2 text-xs dark:bg-green-900/30">
                      {step.llmInteraction.response.content ||
                        "(no text content)"}
                    </pre>

                    {/* Tool Calls if any */}
                    {step.llmInteraction.response.toolCalls &&
                      step.llmInteraction.response.toolCalls.length > 0 && (
                        <div className="mt-2">
                          <h5 className="mb-1 text-[10px] font-medium text-muted-foreground">
                            Tool Calls:
                          </h5>
                          {step.llmInteraction.response.toolCalls.map(
                            (toolCall, idx) => (
                              <div
                                key={idx}
                                className="rounded bg-orange-50 p-2 text-xs dark:bg-orange-900/30"
                              >
                                <div className="font-mono font-semibold">
                                  {toolCall.name}
                                </div>
                                <pre className="mt-1 text-[10px]">
                                  {JSON.stringify(toolCall.arguments, null, 2)}
                                </pre>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                  </div>
                )}

                {/* LLM Error if any */}
                {step.llmInteraction.error && (
                  <div className="rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-900/30 dark:text-red-200">
                    <span className="font-medium">Error:</span>{" "}
                    {step.llmInteraction.error}
                  </div>
                )}
              </div>
            )}

            {/* Full Event Payload - the raw request/response data */}
            {step.eventPayload && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <h3 className="mb-2 font-medium text-primary">
                  Event Payload (Raw Data)
                </h3>
                <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(step.eventPayload, null, 2)}
                </pre>
              </div>
            )}

            {/* State transitions */}
            <div className="rounded-md border p-3 text-sm">
              <h3 className="mb-2 font-medium">State Transitions</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {step.previousStateId && (
                  <div>
                    <span className="text-muted-foreground">
                      Previous State:
                    </span>
                    <span className="ml-1 font-mono">
                      {step.previousStateId.slice(0, 12)}...
                    </span>
                  </div>
                )}
                {step.resultStateId && (
                  <div>
                    <span className="text-muted-foreground">Result State:</span>
                    <span className="ml-1 font-mono">
                      {step.resultStateId.slice(0, 12)}...
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Error if failed */}
            {step.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                <h3 className="mb-2 font-medium text-red-800 dark:text-red-200">
                  Error
                </h3>
                <pre className="overflow-auto text-xs text-red-700 dark:text-red-300">
                  {step.error}
                </pre>
              </div>
            )}

            {/* Context if available */}
            {step.context && Object.keys(step.context).length > 0 && (
              <div className="rounded-md border p-3 text-sm">
                <h3 className="mb-2 font-medium">Context</h3>
                <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(step.context, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function StateViewer({ state, agentId }: StateViewerProps) {
  // Ensure chunks is an array
  const chunks = Array.isArray(state.chunks) ? state.chunks : [];

  // Step detail modal state
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stepDetail, setStepDetail] = useState<Step | null>(null);
  const [isLoadingStep, setIsLoadingStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const handleStepClick = async (stepId: string) => {
    if (!agentId) {
      setStepError("Agent ID is not available");
      setSelectedStepId(stepId);
      return;
    }

    setSelectedStepId(stepId);
    setIsLoadingStep(true);
    setStepError(null);
    setStepDetail(null);

    try {
      const step = await agentApi.getStepById(agentId, stepId);
      setStepDetail(step);
    } catch (err) {
      setStepError(
        err instanceof Error ? err.message : "Failed to load step details",
      );
    } finally {
      setIsLoadingStep(false);
    }
  };

  const handleCloseModal = () => {
    setSelectedStepId(null);
    setStepDetail(null);
    setStepError(null);
  };

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

      {/* State Provenance - shows what event caused this state */}
      {state.provenance && (
        <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="mb-2 flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium text-primary">State Transition</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {state.provenance.eventType && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Triggered by:</span>
                <span className="ml-1 font-semibold">
                  {getEventTypeDisplay(state.provenance.eventType)}
                </span>
              </div>
            )}
            {state.provenance.source && (
              <div>
                <span className="text-muted-foreground">Source:</span>
                <span
                  className={`ml-1 rounded px-1 py-0.5 text-[10px] font-medium ${getSourceColor(state.provenance.source)}`}
                >
                  {state.provenance.source}
                </span>
              </div>
            )}
            {state.provenance.stepId && (
              <div>
                <span className="text-muted-foreground">Step ID:</span>
                <button
                  onClick={() => handleStepClick(state.provenance!.stepId!)}
                  className="ml-1 inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                >
                  {state.provenance.stepId.slice(0, 8)}...
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
            {state.previousStateId && (
              <div className="col-span-2">
                <span className="text-muted-foreground">From state:</span>
                <span className="ml-1 font-mono text-[10px]">
                  {state.previousStateId.slice(0, 12)}...
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chunks */}
      <div>
        <h3 className="mb-2 text-sm font-medium">Chunks ({chunks.length})</h3>
        <div className="space-y-2">
          {chunks.map((chunk, index) => (
            <ChunkCard key={chunk.id || `chunk-${index}`} chunk={chunk} />
          ))}
        </div>
      </div>

      {/* Step detail modal */}
      {selectedStepId && (
        <StepDetailModal
          step={stepDetail}
          isLoading={isLoadingStep}
          error={stepError}
          onClose={handleCloseModal}
        />
      )}
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
