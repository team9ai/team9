import { useState } from "react";
import type { Blueprint, BlueprintChunk, LLMConfig } from "@/types";
import { ChunkEditor } from "./ChunkEditor";
import { LLMConfigEditor } from "./LLMConfigEditor";
import { SubAgentEditor } from "./SubAgentEditor";
import {
  Plus,
  Trash2,
  Save,
  FileJson,
  ChevronDown,
  ChevronRight,
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
  initialChunks: [],
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
    "basic" | "chunks" | "subagents" | "json"
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

  const addChunk = () => {
    const newChunk: BlueprintChunk = {
      type: "SYSTEM",
      content: { type: "TEXT", text: "" },
      retentionStrategy: "CRITICAL",
      mutable: false,
      priority: 0,
    };
    updateBlueprint({
      initialChunks: [...blueprint.initialChunks, newChunk],
    });
  };

  const updateChunk = (index: number, chunk: BlueprintChunk) => {
    const newChunks = [...blueprint.initialChunks];
    newChunks[index] = chunk;
    updateBlueprint({ initialChunks: newChunks });
  };

  const removeChunk = (index: number) => {
    updateBlueprint({
      initialChunks: blueprint.initialChunks.filter((_, i) => i !== index),
    });
  };

  const moveChunk = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blueprint.initialChunks.length) return;

    const newChunks = [...blueprint.initialChunks];
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
            key: "chunks",
            label: `Chunks (${blueprint.initialChunks.length})`,
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
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "basic" && (
          <BasicInfoTab blueprint={blueprint} onChange={updateBlueprint} />
        )}

        {activeTab === "chunks" && (
          <ChunksTab
            chunks={blueprint.initialChunks}
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
  const [toolInput, setToolInput] = useState("");

  const addTool = () => {
    if (!toolInput.trim()) return;
    onChange({ tools: [...(blueprint.tools || []), toolInput.trim()] });
    setToolInput("");
  };

  const removeTool = (index: number) => {
    onChange({
      tools: (blueprint.tools || []).filter((_, i) => i !== index),
    });
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
        <label className="block text-sm font-medium">Tools</label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={toolInput}
            onChange={(e) => setToolInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTool()}
            className="flex-1 rounded-md border bg-background p-2 text-sm"
            placeholder="Tool name (e.g., read_file)"
          />
          <button
            onClick={addTool}
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {blueprint.tools && blueprint.tools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {blueprint.tools.map((tool, index) => (
              <span
                key={index}
                className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs"
              >
                {tool}
                <button
                  onClick={() => removeTool(index)}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
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

// Chunks Tab
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

  const addSubAgent = () => {
    if (!newKey.trim() || subAgents[newKey]) return;

    onChange({
      ...subAgents,
      [newKey]: {
        name: newKey,
        initialChunks: [],
        llmConfig: { model: "claude-3-haiku" },
      },
    });
    setNewKey("");
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
        <div className="flex gap-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSubAgent()}
            className="w-40 rounded-md border bg-background p-2 text-sm"
            placeholder="Sub-agent key"
          />
          <button
            onClick={addSubAgent}
            disabled={!newKey.trim()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      {Object.keys(subAgents).length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No sub-agents defined yet.</p>
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
