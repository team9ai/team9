import { useState } from "react";
import type { Blueprint, BlueprintChunk, ComponentConfig } from "@/types";
import { ChunkEditor } from "./ChunkEditor";
import { ComponentEditor } from "./ComponentEditor";
import { LLMConfigEditor } from "./LLMConfigEditor";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

interface SubAgentEditorProps {
  agentKey: string;
  blueprint: Blueprint;
  onChange: (blueprint: Blueprint) => void;
  onRemove: () => void;
}

export function SubAgentEditor({
  agentKey,
  blueprint,
  onChange,
  onRemove,
}: SubAgentEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<
    "info" | "components" | "chunks" | "llm"
  >("info");

  const updateBlueprint = (updates: Partial<Blueprint>) => {
    onChange({ ...blueprint, ...updates });
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

  // Legacy chunk management (deprecated)
  const addChunk = () => {
    const newChunk: BlueprintChunk = {
      type: "SYSTEM",
      content: { type: "TEXT", text: "" },
      retentionStrategy: "CRITICAL",
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

  return (
    <div className="rounded-lg border">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center gap-2 p-3 hover:bg-muted/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}

        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900 dark:text-orange-200">
          {agentKey}
        </span>

        <span className="flex-1 text-sm font-medium">{blueprint.name}</span>

        <span className="text-xs text-muted-foreground">
          {blueprint.llmConfig.model} • {(blueprint.components || []).length}{" "}
          components
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-1 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t">
          {/* Section tabs */}
          <div className="flex border-b">
            {[
              { key: "info", label: "Info" },
              {
                key: "components",
                label: `Components (${(blueprint.components || []).length})`,
              },
              {
                key: "chunks",
                label: `Chunks (${(blueprint.initialChunks || []).length})`,
                deprecated: true,
              },
              { key: "llm", label: "LLM Config" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() =>
                  setActiveSection(tab.key as typeof activeSection)
                }
                className={`px-3 py-2 text-xs font-medium ${
                  activeSection === tab.key
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {"deprecated" in tab && tab.deprecated && (
                  <span className="ml-1 text-[10px] text-amber-500">
                    (deprecated)
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-3">
            {activeSection === "info" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">
                    Name
                  </label>
                  <input
                    type="text"
                    value={blueprint.name}
                    onChange={(e) => updateBlueprint({ name: e.target.value })}
                    className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground">
                    Description
                  </label>
                  <textarea
                    value={blueprint.description || ""}
                    onChange={(e) =>
                      updateBlueprint({ description: e.target.value })
                    }
                    className="mt-1 h-20 w-full rounded-md border bg-background p-2 text-sm"
                  />
                </div>

                {/* Tools */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">
                    Tools
                  </label>
                  <ToolsEditor
                    tools={blueprint.tools || []}
                    onChange={(tools) => updateBlueprint({ tools })}
                  />
                </div>
              </div>
            )}

            {activeSection === "components" && (
              <div className="space-y-3">
                <button
                  onClick={addComponent}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="h-3 w-3" />
                  Add Component
                </button>

                {(blueprint.components || []).length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No components defined yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(blueprint.components || []).map((component, index) => (
                      <ComponentItem
                        key={index}
                        index={index}
                        component={component}
                        onUpdate={(c) => updateComponent(index, c)}
                        onRemove={() => removeComponent(index)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === "chunks" && (
              <div className="space-y-3">
                <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-300">
                  Chunks are deprecated. Please use Components instead.
                </div>
                <button
                  onClick={addChunk}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="h-3 w-3" />
                  Add Chunk
                </button>

                {(blueprint.initialChunks || []).length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No chunks defined yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(blueprint.initialChunks || []).map((chunk, index) => (
                      <ChunkItem
                        key={index}
                        index={index}
                        chunk={chunk}
                        onUpdate={(c) => updateChunk(index, c)}
                        onRemove={() => removeChunk(index)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === "llm" && (
              <LLMConfigEditor
                config={blueprint.llmConfig}
                onChange={(llmConfig) => updateBlueprint({ llmConfig })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ComponentItem({
  component,
  onUpdate,
  onRemove,
}: {
  index: number;
  component: ComponentConfig;
  onUpdate: (component: ComponentConfig) => void;
  onRemove: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

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

  const getComponentPreview = (comp: ComponentConfig) => {
    if (comp.instructions) {
      const preview = comp.instructions.slice(0, 40);
      return preview + (comp.instructions.length > 40 ? "..." : "");
    }
    return "(no instructions)";
  };

  return (
    <div className="rounded border">
      <div
        className="flex cursor-pointer items-center gap-2 p-2 hover:bg-muted/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}

        <span
          className={`rounded px-1 py-0.5 text-[10px] font-medium ${
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
          <span className="text-[10px] text-muted-foreground">
            ({component.tools.length} tools)
          </span>
        )}

        <span className="flex-1 truncate text-xs text-muted-foreground">
          {getComponentPreview(component)}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-0.5 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t p-2">
          <ComponentEditor component={component} onChange={onUpdate} />
        </div>
      )}
    </div>
  );
}

function ChunkItem({
  chunk,
  onUpdate,
  onRemove,
}: {
  index: number;
  chunk: BlueprintChunk;
  onUpdate: (chunk: BlueprintChunk) => void;
  onRemove: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded border">
      <div
        className="flex cursor-pointer items-center gap-2 p-2 hover:bg-muted/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}

        <span className="rounded bg-secondary px-1 py-0.5 text-[10px] font-medium">
          {chunk.type}
        </span>

        <span className="flex-1 truncate text-xs text-muted-foreground">
          {getChunkPreview(chunk.content)}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-0.5 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t p-2">
          <ChunkEditor chunk={chunk} onChange={onUpdate} />
        </div>
      )}
    </div>
  );
}

function ToolsEditor({
  tools,
  onChange,
}: {
  tools: string[];
  onChange: (tools: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTool = () => {
    if (!input.trim()) return;
    onChange([...tools, input.trim()]);
    setInput("");
  };

  return (
    <div>
      <div className="mt-1 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTool()}
          className="flex-1 rounded-md border bg-background p-2 text-sm"
          placeholder="Tool name"
        />
        <button
          onClick={addTool}
          className="rounded-md border px-2 py-1 text-sm hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tools.map((tool, index) => (
            <span
              key={index}
              className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
            >
              {tool}
              <button
                onClick={() => onChange(tools.filter((_, i) => i !== index))}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function getChunkPreview(content: unknown): string {
  if (!content) return "(empty)";
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.type === "TEXT" && typeof obj.text === "string") {
      return obj.text.slice(0, 40) + (obj.text.length > 40 ? "..." : "");
    }
    if (obj.type === "IMAGE") return "[Image]";
    if (obj.type === "MIXED") return "[Mixed content]";
  }
  return String(content).slice(0, 40);
}
