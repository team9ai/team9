import { useState, useEffect } from "react";
import type {
  Blueprint,
  BlueprintChunk,
  LLMConfig,
  ComponentConfig,
} from "@/types";
import { ChunkEditor } from "./ChunkEditor";
import { ComponentEditor } from "./ComponentEditor";
import { LLMConfigEditor } from "./LLMConfigEditor";
import { SubAgentEditor } from "./SubAgentEditor";
import { toolsApi, blueprintApi, type ToolInfo } from "@/services/api";
import {
  Plus,
  Trash2,
  Save,
  FileJson,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
} from "lucide-react";

interface BlueprintEditorProps {
  initialBlueprint?: Blueprint;
  onSave: (blueprint: Blueprint) => Promise<void>;
  onCancel: () => void;
}

const defaultLLMConfig: LLMConfig = {
  model: "claude-3-opus",
  temperature: 0.7,
  maxTokens: 4096,
};

const defaultBlueprint: Blueprint = {
  name: "",
  description: "",
  components: [],
  llmConfig: defaultLLMConfig,
  tools: [],
  autoCompactThreshold: 20,
};

export function BlueprintEditor({
  initialBlueprint,
  onSave,
  onCancel,
}: BlueprintEditorProps) {
  const [blueprint, setBlueprint] = useState<Blueprint>(
    initialBlueprint || defaultBlueprint,
  );
  const [activeTab, setActiveTab] = useState<
    "basic" | "components" | "chunks" | "subagents" | "json"
  >("basic");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    try {
      setError(null);
      setIsSaving(true);

      // Validate
      if (!blueprint.name.trim()) {
        setError("Blueprint name is required");
        return;
      }
      if (!blueprint.llmConfig.model) {
        setError("LLM model is required");
        return;
      }

      await onSave(blueprint);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const updateBlueprint = (updates: Partial<Blueprint>) => {
    setBlueprint((prev) => ({ ...prev, ...updates }));
  };

  // Component management
  const addComponent = () => {
    const newComponent: ComponentConfig = {
      type: "system",
      instructions: "",
    };
    updateBlueprint({
      components: [...(blueprint.components || []), newComponent],
    });
  };

  const updateComponent = (index: number, component: ComponentConfig) => {
    const newComponents = [...(blueprint.components || [])];
    newComponents[index] = component;
    updateBlueprint({ components: newComponents });
  };

  const removeComponent = (index: number) => {
    updateBlueprint({
      components: (blueprint.components || []).filter((_, i) => i !== index),
    });
  };

  const moveComponent = (index: number, direction: "up" | "down") => {
    const components = blueprint.components || [];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= components.length) return;

    const newComponents = [...components];
    [newComponents[index], newComponents[newIndex]] = [
      newComponents[newIndex],
      newComponents[index],
    ];
    updateBlueprint({ components: newComponents });
  };

  // Legacy chunk management (for backward compatibility)
  const addChunk = () => {
    const newChunk: BlueprintChunk = {
      type: "SYSTEM",
      content: { type: "TEXT", text: "" },
      retentionStrategy: "CRITICAL",
      mutable: false,
      priority: 0,
    };
    updateBlueprint({
      initialChunks: [...(blueprint.initialChunks || []), newChunk],
    });
  };

  const updateChunk = (index: number, chunk: BlueprintChunk) => {
    const newChunks = [...(blueprint.initialChunks || [])];
    newChunks[index] = chunk;
    updateBlueprint({ initialChunks: newChunks });
  };

  const removeChunk = (index: number) => {
    updateBlueprint({
      initialChunks: (blueprint.initialChunks || []).filter(
        (_, i) => i !== index,
      ),
    });
  };

  const moveChunk = (index: number, direction: "up" | "down") => {
    const chunks = blueprint.initialChunks || [];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= chunks.length) return;

    const newChunks = [...chunks];
    [newChunks[index], newChunks[newIndex]] = [
      newChunks[newIndex],
      newChunks[index],
    ];
    updateBlueprint({ initialChunks: newChunks });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">
          {initialBlueprint ? "Edit Blueprint" : "Create Blueprint"}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b">
        {[
          { key: "basic", label: "Basic Info" },
          {
            key: "components",
            label: `Components (${(blueprint.components || []).length})`,
          },
          {
            key: "chunks",
            label: `Chunks (${(blueprint.initialChunks || []).length})`,
            deprecated: true,
          },
          {
            key: "subagents",
            label: `SubAgents (${Object.keys(blueprint.subAgents || {}).length})`,
          },
          { key: "json", label: "JSON Preview" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {"deprecated" in tab && tab.deprecated && (
              <span className="ml-1 text-xs text-amber-500">(deprecated)</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "basic" && (
          <BasicInfoTab blueprint={blueprint} onChange={updateBlueprint} />
        )}

        {activeTab === "components" && (
          <ComponentsTab
            components={blueprint.components || []}
            onAdd={addComponent}
            onUpdate={updateComponent}
            onRemove={removeComponent}
            onMove={moveComponent}
            availableSubAgents={Object.keys(blueprint.subAgents || {})}
          />
        )}

        {activeTab === "chunks" && (
          <ChunksTab
            chunks={blueprint.initialChunks || []}
            onAdd={addChunk}
            onUpdate={updateChunk}
            onRemove={removeChunk}
            onMove={moveChunk}
          />
        )}

        {activeTab === "subagents" && (
          <SubAgentsTab
            subAgents={blueprint.subAgents || {}}
            onChange={(subAgents) => updateBlueprint({ subAgents })}
          />
        )}

        {activeTab === "json" && <JsonPreviewTab blueprint={blueprint} />}
      </div>
    </div>
  );
}

// Basic Info Tab
function BasicInfoTab({
  blueprint,
  onChange,
}: {
  blueprint: Blueprint;
  onChange: (updates: Partial<Blueprint>) => void;
}) {
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);

  useEffect(() => {
    const loadTools = async () => {
      try {
        setLoadingTools(true);
        setToolsError(null);
        const response = await toolsApi.list();
        // Only show control tools here (not external tools)
        // External tools are configured per-component, not at blueprint level
        setAvailableTools(response.tools ?? []);
      } catch (err) {
        setToolsError((err as Error).message);
      } finally {
        setLoadingTools(false);
      }
    };
    loadTools();
  }, []);

  const toggleTool = (toolName: string) => {
    const currentTools = blueprint.tools || [];
    const isSelected = currentTools.includes(toolName);
    if (isSelected) {
      onChange({ tools: currentTools.filter((t) => t !== toolName) });
    } else {
      onChange({ tools: [...currentTools, toolName] });
    }
  };

  const selectAllTools = () => {
    onChange({ tools: availableTools.map((t) => t.name) });
  };

  const deselectAllTools = () => {
    onChange({ tools: [] });
  };

  return (
    <div className="space-y-6">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium">
          Name <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={blueprint.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          placeholder="My Agent"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium">Description</label>
        <textarea
          value={blueprint.description || ""}
          onChange={(e) => onChange({ description: e.target.value })}
          className="mt-1 h-20 w-full rounded-md border bg-background p-2 text-sm"
          placeholder="A helpful assistant that..."
        />
      </div>

      {/* LLM Config */}
      <div>
        <label className="block text-sm font-medium mb-2">
          LLM Configuration
        </label>
        <LLMConfigEditor
          config={blueprint.llmConfig}
          onChange={(llmConfig) => onChange({ llmConfig })}
        />
      </div>

      {/* Tools */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">
            Tools ({(blueprint.tools || []).length} selected)
          </label>
          <div className="flex gap-2">
            <button
              onClick={selectAllTools}
              disabled={loadingTools}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Select All
            </button>
            <span className="text-muted-foreground">|</span>
            <button
              onClick={deselectAllTools}
              disabled={loadingTools}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Deselect All
            </button>
          </div>
        </div>

        {loadingTools ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading available tools...
          </div>
        ) : toolsError ? (
          <div className="text-sm text-destructive">
            Failed to load tools: {toolsError}
          </div>
        ) : availableTools.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No tools available
          </div>
        ) : (
          <div className="mt-1 space-y-1 max-h-60 overflow-y-auto rounded-md border p-2">
            {availableTools.map((tool) => {
              const isSelected = (blueprint.tools || []).includes(tool.name);
              return (
                <label
                  key={tool.name}
                  className={`flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground"
                    }`}
                    onClick={() => toggleTool(tool.name)}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{tool.name}</span>
                      {tool.awaitsExternalResponse && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          async
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {tool.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Auto Compact Threshold */}
      <div>
        <label className="block text-sm font-medium">
          Auto Compact Threshold
        </label>
        <input
          type="number"
          value={blueprint.autoCompactThreshold || 20}
          onChange={(e) =>
            onChange({ autoCompactThreshold: parseInt(e.target.value) || 20 })
          }
          className="mt-1 w-32 rounded-md border bg-background p-2 text-sm"
          min={1}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Number of compressible chunks before auto-compaction triggers
        </p>
      </div>
    </div>
  );
}

// Components Tab
function ComponentsTab({
  components,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
  availableSubAgents,
}: {
  components: ComponentConfig[];
  onAdd: () => void;
  onUpdate: (index: number, component: ComponentConfig) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: "up" | "down") => void;
  availableSubAgents: string[];
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const getComponentLabel = (type: string) => {
    switch (type) {
      case "system":
        return "System";
      case "agent":
        return "Agent";
      case "workflow":
        return "Workflow";
      default:
        return type;
    }
  };

  const getComponentPreview = (component: ComponentConfig) => {
    if (component.instructions) {
      const preview = component.instructions.slice(0, 50);
      return preview + (component.instructions.length > 50 ? "..." : "");
    }
    return "(no instructions)";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define components that make up this agent's configuration
        </p>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Component
        </button>
      </div>

      {components.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No components defined yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Components combine instructions and tools into modular building
            blocks.
          </p>
          <button
            onClick={onAdd}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Add your first component
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {components.map((component, index) => (
            <div key={index} className="rounded-lg border">
              {/* Component header */}
              <div
                className="flex cursor-pointer items-center gap-2 p-3 hover:bg-muted/50"
                onClick={() =>
                  setExpandedIndex(expandedIndex === index ? null : index)
                }
              >
                {expandedIndex === index ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}

                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    component.type === "system"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                      : component.type === "agent"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                  }`}
                >
                  {getComponentLabel(component.type)}
                </span>

                {component.tools && component.tools.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({component.tools.length} tools)
                  </span>
                )}

                <span className="flex-1 truncate text-sm text-muted-foreground">
                  {getComponentPreview(component)}
                </span>

                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onMove(index, "up")}
                    disabled={index === 0}
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => onMove(index, "down")}
                    disabled={index === components.length - 1}
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => onRemove(index)}
                    className="rounded p-1 text-destructive hover:bg-destructive/10"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Component editor (expanded) */}
              {expandedIndex === index && (
                <div className="border-t p-3">
                  <ComponentEditor
                    component={component}
                    onChange={(updated) => onUpdate(index, updated)}
                    availableSubAgents={availableSubAgents}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Chunks Tab (deprecated - kept for backward compatibility)
function ChunksTab({
  chunks,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
}: {
  chunks: BlueprintChunk[];
  onAdd: () => void;
  onUpdate: (index: number, chunk: BlueprintChunk) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: "up" | "down") => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define the initial memory chunks for this agent
        </p>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Chunk
        </button>
      </div>

      {chunks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No chunks defined yet.</p>
          <button
            onClick={onAdd}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Add your first chunk
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {chunks.map((chunk, index) => (
            <div key={index} className="rounded-lg border">
              {/* Chunk header */}
              <div
                className="flex cursor-pointer items-center gap-2 p-3 hover:bg-muted/50"
                onClick={() =>
                  setExpandedIndex(expandedIndex === index ? null : index)
                }
              >
                {expandedIndex === index ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}

                <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                  {chunk.type}
                </span>

                {chunk.subType && (
                  <span className="text-xs text-muted-foreground">
                    / {chunk.subType}
                  </span>
                )}

                <span className="flex-1 truncate text-sm text-muted-foreground">
                  {getChunkPreview(chunk.content)}
                </span>

                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onMove(index, "up")}
                    disabled={index === 0}
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => onMove(index, "down")}
                    disabled={index === chunks.length - 1}
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => onRemove(index)}
                    className="rounded p-1 text-destructive hover:bg-destructive/10"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Chunk editor (expanded) */}
              {expandedIndex === index && (
                <div className="border-t p-3">
                  <ChunkEditor
                    chunk={chunk}
                    onChange={(updated) => onUpdate(index, updated)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// SubAgents Tab
function SubAgentsTab({
  subAgents,
  onChange,
}: {
  subAgents: Record<string, Blueprint>;
  onChange: (subAgents: Record<string, Blueprint>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [availableBlueprints, setAvailableBlueprints] = useState<Blueprint[]>(
    [],
  );
  const [loadingBlueprints, setLoadingBlueprints] = useState(true);

  useEffect(() => {
    const loadBlueprints = async () => {
      try {
        setLoadingBlueprints(true);
        const blueprints = await blueprintApi.list();
        setAvailableBlueprints(blueprints);
      } catch (err) {
        console.error("Failed to load blueprints:", err);
      } finally {
        setLoadingBlueprints(false);
      }
    };
    loadBlueprints();
  }, []);

  const addSubAgent = () => {
    if (!newKey.trim() || subAgents[newKey]) return;

    // Find selected blueprint or create empty one
    const selectedBlueprint = availableBlueprints.find(
      (b) => b.id === selectedBlueprintId,
    );

    if (selectedBlueprint) {
      // Use the selected blueprint (copy it)
      onChange({
        ...subAgents,
        [newKey]: {
          ...selectedBlueprint,
          id: undefined, // Remove ID to avoid conflicts
        },
      });
    } else {
      // Create empty blueprint
      onChange({
        ...subAgents,
        [newKey]: {
          name: newKey,
          components: [],
          llmConfig: { model: "claude-3-haiku" },
        },
      });
    }
    setNewKey("");
    setSelectedBlueprintId("");
  };

  const updateSubAgent = (key: string, blueprint: Blueprint) => {
    onChange({ ...subAgents, [key]: blueprint });
  };

  const removeSubAgent = (key: string) => {
    const { [key]: _, ...rest } = subAgents;
    onChange(rest);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define sub-agents that can be delegated tasks
        </p>
      </div>

      {/* Add sub-agent form */}
      <div className="flex items-end gap-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Sub-agent Key
          </label>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSubAgent()}
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="e.g., researcher, coder"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Blueprint Template
          </label>
          {loadingBlueprints ? (
            <div className="flex items-center gap-2 h-[38px] px-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <select
              value={selectedBlueprintId}
              onChange={(e) => setSelectedBlueprintId(e.target.value)}
              className="w-full rounded-md border bg-background p-2 text-sm"
            >
              <option value="">-- Create empty --</option>
              {availableBlueprints.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  {bp.name}{" "}
                  {bp.description ? `(${bp.description.slice(0, 30)}...)` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={addSubAgent}
          disabled={!newKey.trim() || subAgents[newKey] !== undefined}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {newKey && subAgents[newKey] !== undefined && (
        <p className="text-xs text-destructive">
          A sub-agent with key "{newKey}" already exists
        </p>
      )}

      {Object.keys(subAgents).length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No sub-agents defined yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Select an existing blueprint or create an empty sub-agent to get
            started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(subAgents).map(([key, subBlueprint]) => (
            <SubAgentEditor
              key={key}
              agentKey={key}
              blueprint={subBlueprint}
              onChange={(updated) => updateSubAgent(key, updated)}
              onRemove={() => removeSubAgent(key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// JSON Preview Tab
function JsonPreviewTab({ blueprint }: { blueprint: Blueprint }) {
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(blueprint, null, 2);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          JSON representation of the blueprint
        </p>
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <FileJson className="h-4 w-4" />
          {copied ? "Copied!" : "Copy JSON"}
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-xs">
        {jsonString}
      </pre>
    </div>
  );
}

function getChunkPreview(content: unknown): string {
  if (!content) return "(empty)";
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.type === "TEXT" && typeof obj.text === "string") {
      return obj.text.slice(0, 60) + (obj.text.length > 60 ? "..." : "");
    }
    if (obj.type === "IMAGE") return "[Image]";
    if (obj.type === "MIXED") return "[Mixed content]";
  }
  return String(content).slice(0, 60);
}
