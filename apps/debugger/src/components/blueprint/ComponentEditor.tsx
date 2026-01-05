import { useState, useEffect } from "react";
import type {
  ComponentConfig,
  ComponentType,
  CustomToolConfig,
  ToolDefinition,
} from "@/types";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Plug,
  Users,
} from "lucide-react";
import { toolsApi, type ToolInfo } from "@/services/api/tools.api";

interface ComponentEditorProps {
  component: ComponentConfig;
  onChange: (component: ComponentConfig) => void;
  /** Available sub-agent keys from the blueprint */
  availableSubAgents?: string[];
}

const COMPONENT_TYPES: {
  value: ComponentType;
  label: string;
  description: string;
}[] = [
  {
    value: "system",
    label: "System",
    description: "System-level instructions and common tools",
  },
  {
    value: "agent",
    label: "Agent",
    description: "Agent-specific instructions and tools",
  },
  {
    value: "workflow",
    label: "Workflow",
    description: "Workflow-specific instructions and tools",
  },
];

export function ComponentEditor({
  component,
  onChange,
  availableSubAgents = [],
}: ComponentEditorProps) {
  const [showTools, setShowTools] = useState(false);
  const [showSubAgents, setShowSubAgents] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [externalTools, setExternalTools] = useState<ToolInfo[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);

  // Load external tools on mount
  useEffect(() => {
    setLoadingExternal(true);
    toolsApi
      .listExternalTools()
      .then(setExternalTools)
      .catch(console.error)
      .finally(() => setLoadingExternal(false));
  }, []);

  const updateComponent = (updates: Partial<ComponentConfig>) => {
    onChange({ ...component, ...updates } as ComponentConfig);
  };

  const addTool = () => {
    if (!newToolName.trim()) return;

    const newTool: CustomToolConfig = {
      definition: {
        name: newToolName.trim(),
        description: "",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    };

    updateComponent({
      tools: [...(component.tools || []), newTool],
    });
    setNewToolName("");
  };

  const updateTool = (index: number, tool: CustomToolConfig) => {
    const newTools = [...(component.tools || [])];
    newTools[index] = tool;
    updateComponent({ tools: newTools });
  };

  const removeTool = (index: number) => {
    updateComponent({
      tools: (component.tools || []).filter((_, i) => i !== index),
    });
  };

  const addExternalTool = (toolInfo: ToolInfo) => {
    // Check if already added
    const existingTools = component.tools || [];
    if (existingTools.some((t) => t.definition.name === toolInfo.name)) {
      return; // Already added
    }

    const newTool: CustomToolConfig = {
      definition: {
        name: toolInfo.name,
        description: toolInfo.description,
        parameters: toolInfo.parameters,
        awaitsExternalResponse: toolInfo.awaitsExternalResponse,
      },
    };

    updateComponent({
      tools: [...existingTools, newTool],
    });
  };

  const isExternalToolAdded = (name: string) => {
    return (component.tools || []).some((t) => t.definition.name === name);
  };

  return (
    <div className="space-y-4">
      {/* Component Type */}
      <div>
        <label className="block text-sm font-medium mb-1">Type</label>
        <select
          value={component.type}
          onChange={(e) => {
            const newType = e.target.value as ComponentType;
            // When changing to system, ensure instructions is set
            if (newType === "system" && !component.instructions) {
              updateComponent({
                type: newType,
                instructions: "",
              } as ComponentConfig);
            } else {
              updateComponent({ type: newType } as ComponentConfig);
            }
          }}
          className="w-full rounded-md border bg-background p-2 text-sm"
        >
          {COMPONENT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {COMPONENT_TYPES.find((t) => t.value === component.type)?.description}
        </p>
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Instructions{" "}
          {component.type === "system" && (
            <span className="text-destructive">*</span>
          )}
        </label>
        <textarea
          value={component.instructions || ""}
          onChange={(e) => updateComponent({ instructions: e.target.value })}
          className="w-full h-32 rounded-md border bg-background p-2 text-sm font-mono"
          placeholder={
            component.type === "system"
              ? "You are a helpful assistant..."
              : "Optional agent/workflow specific instructions..."
          }
        />
      </div>

      {/* Tools Section */}
      <div className="border rounded-lg">
        <button
          onClick={() => setShowTools(!showTools)}
          className="flex items-center gap-2 w-full p-3 hover:bg-muted/50 text-left"
        >
          {showTools ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">
            Tools ({(component.tools || []).length})
          </span>
          <span className="text-xs text-muted-foreground">
            - Custom tools for this component
          </span>
        </button>

        {showTools && (
          <div className="border-t p-3 space-y-4">
            {/* External Tools Section */}
            {externalTools.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Plug className="h-4 w-4" />
                  <span>Available External Tools</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {externalTools.map((tool) => {
                    const isAdded = isExternalToolAdded(tool.name);
                    return (
                      <button
                        key={tool.name}
                        onClick={() => !isAdded && addExternalTool(tool)}
                        disabled={isAdded}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isAdded
                            ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 cursor-default"
                            : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
                        }`}
                        title={tool.description}
                      >
                        <Plug className="h-3 w-3" />
                        {tool.name}
                        {isAdded && (
                          <span className="text-[10px]">(added)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click to add external tools registered in the runtime.
                </p>
              </div>
            )}
            {loadingExternal && (
              <p className="text-xs text-muted-foreground">
                Loading external tools...
              </p>
            )}

            {/* Custom Tool Input */}
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">
                Add Custom Tool
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTool()}
                  className="flex-1 rounded-md border bg-background p-2 text-sm"
                  placeholder="Tool name"
                />
                <button
                  onClick={addTool}
                  disabled={!newToolName.trim()}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
            </div>

            {/* Tool list */}
            {(component.tools || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No tools configured. Add external tools above or create custom
                tools.
              </p>
            ) : (
              <div className="space-y-2">
                {(component.tools || []).map((tool, index) => (
                  <ToolEditor
                    key={index}
                    tool={tool}
                    onChange={(updated) => updateTool(index, updated)}
                    onRemove={() => removeTool(index)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SubAgents Section */}
      <div className="border rounded-lg">
        <button
          onClick={() => setShowSubAgents(!showSubAgents)}
          className="flex items-center gap-2 w-full p-3 hover:bg-muted/50 text-left"
        >
          {showSubAgents ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">
            Sub-Agents ({(component.subAgents || []).length})
          </span>
          <span className="text-xs text-muted-foreground">
            - Sub-agents available in this component
          </span>
        </button>

        {showSubAgents && (
          <div className="border-t p-3 space-y-4">
            {availableSubAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No sub-agents defined in this blueprint.
                <br />
                <span className="text-xs">
                  Add sub-agents in the "SubAgents" tab first.
                </span>
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>Available Sub-Agents</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableSubAgents.map((key) => {
                    const isEnabled = (component.subAgents || []).includes(key);
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          const currentSubAgents = component.subAgents || [];
                          if (isEnabled) {
                            updateComponent({
                              subAgents: currentSubAgents.filter(
                                (k) => k !== key,
                              ),
                            });
                          } else {
                            updateComponent({
                              subAgents: [...currentSubAgents, key],
                            });
                          }
                        }}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isEnabled
                            ? "border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
                            : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                        }`}
                      >
                        <Users className="h-3 w-3" />
                        {key}
                        {isEnabled && <span className="text-[10px]">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click to enable/disable sub-agents for this component. Enabled
                  sub-agents can be spawned using the{" "}
                  <code className="bg-muted px-1 rounded">spawn_subagent</code>{" "}
                  tool.
                </p>
              </div>
            )}

            {/* Show enabled sub-agents */}
            {(component.subAgents || []).length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Enabled ({(component.subAgents || []).length}):
                </div>
                <div className="flex flex-wrap gap-1">
                  {(component.subAgents || []).map((key) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                    >
                      {key}
                      <button
                        onClick={() =>
                          updateComponent({
                            subAgents: (component.subAgents || []).filter(
                              (k) => k !== key,
                            ),
                          })
                        }
                        className="ml-1 hover:text-purple-900 dark:hover:text-purple-100"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Tool Editor Component
function ToolEditor({
  tool,
  onChange,
  onRemove,
}: {
  tool: CustomToolConfig;
  onChange: (tool: CustomToolConfig) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const updateDefinition = (updates: Partial<ToolDefinition>) => {
    onChange({
      ...tool,
      definition: { ...tool.definition, ...updates },
    });
  };

  return (
    <div className="border rounded-lg">
      <div
        className="flex items-center gap-2 p-2 hover:bg-muted/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-mono text-sm font-medium">
          {tool.definition.name}
        </span>
        <span className="flex-1 text-xs text-muted-foreground truncate">
          {tool.definition.description || "(no description)"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-destructive hover:bg-destructive/10 rounded"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="border-t p-3 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <input
              type="text"
              value={tool.definition.name}
              onChange={(e) => updateDefinition({ name: e.target.value })}
              className="w-full rounded-md border bg-background p-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Description
            </label>
            <textarea
              value={tool.definition.description}
              onChange={(e) =>
                updateDefinition({ description: e.target.value })
              }
              className="w-full h-16 rounded-md border bg-background p-2 text-sm"
              placeholder="What this tool does..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Parameters (JSON Schema)
            </label>
            <textarea
              value={JSON.stringify(tool.definition.parameters, null, 2)}
              onChange={(e) => {
                try {
                  const params = JSON.parse(e.target.value);
                  updateDefinition({ parameters: params });
                } catch {
                  // Invalid JSON, ignore
                }
              }}
              className="w-full h-24 rounded-md border bg-background p-2 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`async-${tool.definition.name}`}
              checked={tool.definition.awaitsExternalResponse || false}
              onChange={(e) =>
                updateDefinition({ awaitsExternalResponse: e.target.checked })
              }
              className="rounded"
            />
            <label
              htmlFor={`async-${tool.definition.name}`}
              className="text-xs"
            >
              Awaits external response (async tool)
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
