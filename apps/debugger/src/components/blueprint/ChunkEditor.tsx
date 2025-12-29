import { useState } from "react";
import type {
  BlueprintChunk,
  ChunkContent,
  TextContent,
  ImageContent,
  MixedContent,
} from "@/types";
import { Plus, Trash2, Image, FileText, Layers } from "lucide-react";

interface ChunkEditorProps {
  chunk: BlueprintChunk;
  onChange: (chunk: BlueprintChunk) => void;
}

const CHUNK_TYPES = [
  "SYSTEM",
  "AGENT",
  "WORKFLOW",
  "DELEGATION",
  "ENVIRONMENT",
  "WORKING_FLOW",
  "OUTPUT",
];

const WORKING_FLOW_SUBTYPES = [
  "COMPACTED",
  "USER",
  "THINKING",
  "RESPONSE",
  "AGENT_ACTION",
  "ACTION_RESPONSE",
];

const RETENTION_STRATEGIES = [
  { value: "CRITICAL", label: "Critical (Never compress)" },
  { value: "COMPRESSIBLE", label: "Compressible" },
  { value: "BATCH_COMPRESSIBLE", label: "Batch Compressible" },
  { value: "DISPOSABLE", label: "Disposable" },
  { value: "EPHEMERAL", label: "Ephemeral (Session only)" },
];

export function ChunkEditor({ chunk, onChange }: ChunkEditorProps) {
  const updateChunk = (updates: Partial<BlueprintChunk>) => {
    onChange({ ...chunk, ...updates });
  };

  return (
    <div className="space-y-4">
      {/* Type and SubType */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Type
          </label>
          <select
            value={chunk.type}
            onChange={(e) => updateChunk({ type: e.target.value })}
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          >
            {CHUNK_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {chunk.type === "WORKING_FLOW" && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              SubType
            </label>
            <select
              value={chunk.subType || ""}
              onChange={(e) =>
                updateChunk({ subType: e.target.value || undefined })
              }
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            >
              <option value="">None</option>
              {WORKING_FLOW_SUBTYPES.map((subType) => (
                <option key={subType} value={subType}>
                  {subType}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          Content
        </label>
        <ContentEditor
          content={chunk.content}
          onChange={(content) => updateChunk({ content })}
        />
      </div>

      {/* Retention Strategy */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground">
          Retention Strategy
        </label>
        <select
          value={chunk.retentionStrategy || "CRITICAL"}
          onChange={(e) => updateChunk({ retentionStrategy: e.target.value })}
          className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
        >
          {RETENTION_STRATEGIES.map((strategy) => (
            <option key={strategy.value} value={strategy.value}>
              {strategy.label}
            </option>
          ))}
        </select>
      </div>

      {/* Mutable and Priority */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={chunk.mutable || false}
              onChange={(e) => updateChunk({ mutable: e.target.checked })}
              className="rounded"
            />
            Mutable
          </label>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Allow agent to modify this chunk
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Priority
          </label>
          <input
            type="number"
            value={chunk.priority || 0}
            onChange={(e) =>
              updateChunk({ priority: parseInt(e.target.value) || 0 })
            }
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// Content Editor Component
function ContentEditor({
  content,
  onChange,
}: {
  content: ChunkContent;
  onChange: (content: ChunkContent) => void;
}) {
  const contentType = getContentType(content);

  const setContentType = (type: "TEXT" | "IMAGE" | "MIXED") => {
    switch (type) {
      case "TEXT":
        onChange({ type: "TEXT", text: "" });
        break;
      case "IMAGE":
        onChange({ type: "IMAGE", data: "", mimeType: "image/png" });
        break;
      case "MIXED":
        onChange({ type: "MIXED", parts: [] });
        break;
    }
  };

  return (
    <div className="rounded-md border p-3">
      {/* Content type selector */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setContentType("TEXT")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
            contentType === "TEXT"
              ? "bg-primary text-primary-foreground"
              : "border hover:bg-muted"
          }`}
        >
          <FileText className="h-3 w-3" />
          Text
        </button>
        <button
          onClick={() => setContentType("IMAGE")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
            contentType === "IMAGE"
              ? "bg-primary text-primary-foreground"
              : "border hover:bg-muted"
          }`}
        >
          <Image className="h-3 w-3" />
          Image
        </button>
        <button
          onClick={() => setContentType("MIXED")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
            contentType === "MIXED"
              ? "bg-primary text-primary-foreground"
              : "border hover:bg-muted"
          }`}
        >
          <Layers className="h-3 w-3" />
          Mixed
        </button>
      </div>

      {/* Content editor based on type */}
      {contentType === "TEXT" && (
        <TextContentEditor
          content={content as TextContent}
          onChange={onChange}
        />
      )}

      {contentType === "IMAGE" && (
        <ImageContentEditor
          content={content as ImageContent}
          onChange={onChange}
        />
      )}

      {contentType === "MIXED" && (
        <MixedContentEditor
          content={content as MixedContent}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function TextContentEditor({
  content,
  onChange,
}: {
  content: TextContent;
  onChange: (content: TextContent) => void;
}) {
  return (
    <textarea
      value={content.text || ""}
      onChange={(e) => onChange({ type: "TEXT", text: e.target.value })}
      className="h-32 w-full rounded-md border bg-background p-2 text-sm font-mono"
      placeholder="Enter text content..."
    />
  );
}

function ImageContentEditor({
  content,
  onChange,
}: {
  content: ImageContent;
  onChange: (content: ImageContent) => void;
}) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      onChange({
        type: "IMAGE",
        data: base64,
        mimeType: file.type,
        altText: content.altText,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Image File
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="text-sm"
        />
      </div>

      {content.data && (
        <div className="rounded border p-2">
          <img
            src={`data:${content.mimeType};base64,${content.data}`}
            alt={content.altText || "Preview"}
            className="max-h-32 object-contain"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Alt Text
        </label>
        <input
          type="text"
          value={content.altText || ""}
          onChange={(e) => onChange({ ...content, altText: e.target.value })}
          className="w-full rounded-md border bg-background p-2 text-sm"
          placeholder="Describe the image..."
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Or paste Base64 directly
        </label>
        <textarea
          value={content.data || ""}
          onChange={(e) => onChange({ ...content, data: e.target.value })}
          className="h-20 w-full rounded-md border bg-background p-2 text-xs font-mono"
          placeholder="base64 encoded image data..."
        />
      </div>
    </div>
  );
}

function MixedContentEditor({
  content,
  onChange,
}: {
  content: MixedContent;
  onChange: (content: MixedContent) => void;
}) {
  const addPart = (type: "TEXT" | "IMAGE") => {
    const newPart =
      type === "TEXT"
        ? { type: "TEXT" as const, text: "" }
        : { type: "IMAGE" as const, data: "", mimeType: "image/png" };

    onChange({
      type: "MIXED",
      parts: [...(content.parts || []), newPart],
    });
  };

  const updatePart = (index: number, part: TextContent | ImageContent) => {
    const newParts = [...(content.parts || [])];
    newParts[index] = part;
    onChange({ type: "MIXED", parts: newParts });
  };

  const removePart = (index: number) => {
    onChange({
      type: "MIXED",
      parts: (content.parts || []).filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => addPart("TEXT")}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
        >
          <Plus className="h-3 w-3" />
          Add Text
        </button>
        <button
          onClick={() => addPart("IMAGE")}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
        >
          <Plus className="h-3 w-3" />
          Add Image
        </button>
      </div>

      {(content.parts || []).length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No parts yet. Add text or image parts above.
        </p>
      ) : (
        <div className="space-y-2">
          {(content.parts || []).map((part, index) => (
            <div key={index} className="rounded border p-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  Part {index + 1}: {part.type}
                </span>
                <button
                  onClick={() => removePart(index)}
                  className="text-destructive hover:bg-destructive/10 rounded p-1"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {part.type === "TEXT" ? (
                <textarea
                  value={part.text || ""}
                  onChange={(e) =>
                    updatePart(index, { type: "TEXT", text: e.target.value })
                  }
                  className="h-20 w-full rounded border bg-background p-2 text-sm"
                  placeholder="Enter text..."
                />
              ) : (
                <ImageContentEditor
                  content={part}
                  onChange={(updated) => updatePart(index, updated)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getContentType(content: ChunkContent): "TEXT" | "IMAGE" | "MIXED" {
  if (!content || typeof content !== "object") return "TEXT";
  const type = (content as Record<string, unknown>).type;
  if (type === "IMAGE") return "IMAGE";
  if (type === "MIXED") return "MIXED";
  return "TEXT";
}
