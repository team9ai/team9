import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Blueprint } from "@/types";
import { blueprintApi, agentApi } from "@/services/api";
import { BlueprintEditor } from "@/components/blueprint/BlueprintEditor";
import { Plus, FileJson, Edit2 } from "lucide-react";

export const Route = createFileRoute("/blueprints/")({
  component: BlueprintsPage,
});

type EditorMode =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; blueprint: Blueprint }
  | { type: "import" };

function BlueprintsPage() {
  const navigate = useNavigate();
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>({ type: "closed" });

  useEffect(() => {
    loadBlueprints();
  }, []);

  const loadBlueprints = async () => {
    try {
      setIsLoading(true);
      const data = await blueprintApi.list();
      setBlueprints(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteBlueprint = async (id: string) => {
    try {
      await blueprintApi.delete(id);
      await loadBlueprints();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createAgentFromBlueprint = async (blueprint: Blueprint) => {
    try {
      const agent = await agentApi.create({ blueprint });
      navigate({ to: `/agent/${agent.id}` });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveBlueprint = async (blueprint: Blueprint) => {
    await blueprintApi.save(blueprint);
    await loadBlueprints();
    setEditorMode({ type: "closed" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading blueprints...</div>
      </div>
    );
  }

  // Show editor modal
  if (editorMode.type === "create" || editorMode.type === "edit") {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <BlueprintEditor
          initialBlueprint={
            editorMode.type === "edit" ? editorMode.blueprint : undefined
          }
          onSave={handleSaveBlueprint}
          onCancel={() => setEditorMode({ type: "closed" })}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blueprints</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setEditorMode({ type: "import" })}
            className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <FileJson className="h-4 w-4" />
            Import JSON
          </button>
          <button
            onClick={() => setEditorMode({ type: "create" })}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Create Blueprint
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {editorMode.type === "import" && (
        <ImportBlueprintModal
          onClose={() => setEditorMode({ type: "closed" })}
          onImport={async (blueprint) => {
            await blueprintApi.save(blueprint);
            await loadBlueprints();
            setEditorMode({ type: "closed" });
          }}
        />
      )}

      {blueprints.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No blueprints yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a new blueprint or import from JSON to get started.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => setEditorMode({ type: "import" })}
              className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <FileJson className="h-4 w-4" />
              Import JSON
            </button>
            <button
              onClick={() => setEditorMode({ type: "create" })}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Create Blueprint
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {blueprints.map((blueprint) => (
            <BlueprintCard
              key={blueprint.id}
              blueprint={blueprint}
              onEdit={() => setEditorMode({ type: "edit", blueprint })}
              onDelete={() => deleteBlueprint(blueprint.id!)}
              onCreate={() => createAgentFromBlueprint(blueprint)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BlueprintCard({
  blueprint,
  onEdit,
  onDelete,
  onCreate,
}: {
  blueprint: Blueprint;
  onEdit: () => void;
  onDelete: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold">{blueprint.name}</h3>
          {blueprint.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {blueprint.description}
            </p>
          )}
        </div>
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Edit blueprint"
        >
          <Edit2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-secondary px-2 py-0.5">
          {blueprint.llmConfig.model}
        </span>
        <span className="rounded bg-secondary px-2 py-0.5">
          {blueprint.initialChunks.length} chunks
        </span>
        {blueprint.tools && blueprint.tools.length > 0 && (
          <span className="rounded bg-secondary px-2 py-0.5">
            {blueprint.tools.length} tools
          </span>
        )}
        {blueprint.subAgents && Object.keys(blueprint.subAgents).length > 0 && (
          <span className="rounded bg-secondary px-2 py-0.5">
            {Object.keys(blueprint.subAgents).length} sub-agents
          </span>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onCreate}
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create Agent
        </button>
        <button
          onClick={onDelete}
          className="rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ImportBlueprintModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (blueprint: Blueprint) => Promise<void>;
}) {
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    try {
      setError(null);
      setIsImporting(true);

      const blueprint = JSON.parse(json) as Blueprint;

      // Validate
      const validation = await blueprintApi.validate(blueprint);
      if (!validation.valid) {
        setError(validation.errors.join(", "));
        return;
      }

      await onImport(blueprint);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Import Blueprint</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste your blueprint JSON below
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          className="mt-4 h-64 w-full rounded-md border bg-background p-3 font-mono text-sm"
          placeholder='{"name": "My Agent", "llmConfig": {"model": "claude-3-opus"}, "initialChunks": [...]}'
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!json.trim() || isImporting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isImporting ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
