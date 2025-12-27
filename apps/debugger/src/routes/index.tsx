import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { AgentInstance } from "@/types";
import { agentApi } from "@/services/api";

export const Route = createFileRoute("/")({
  component: AgentsPage,
});

function AgentsPage() {
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      setIsLoading(true);
      const data = await agentApi.list();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteAgent = async (id: string) => {
    try {
      await agentApi.delete(id);
      await loadAgents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading agents...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
        <p className="text-destructive">{error}</p>
        <button
          onClick={loadAgents}
          className="mt-2 text-sm text-primary underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <Link
          to="/blueprints"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create from Blueprint
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No agents yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create an agent from a blueprint to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onDelete={() => deleteAgent(agent.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onDelete,
}: {
  agent: AgentInstance;
  onDelete: () => void;
}) {
  const statusColors = {
    running: "bg-green-500",
    paused: "bg-yellow-500",
    completed: "bg-blue-500",
    error: "bg-red-500",
  };

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{agent.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            ID: {agent.id.slice(0, 12)}...
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${statusColors[agent.status]}`}
          />
          <span className="text-xs capitalize text-muted-foreground">
            {agent.status}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Model: {agent.llmConfig.model}</span>
        {agent.modelOverride && (
          <span className="rounded bg-secondary px-1">Override</span>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          to={`/agent/${agent.id}`}
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Debug
        </Link>
        <button
          onClick={onDelete}
          className="rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Created: {new Date(agent.createdAt).toLocaleString()}
      </div>
    </div>
  );
}
