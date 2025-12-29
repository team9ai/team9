import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/batch-test/")({
  component: BatchTestPage,
});

function BatchTestPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Batch Test</h1>
      <p className="mt-4 text-muted-foreground">
        Batch testing functionality coming soon...
      </p>
    </div>
  );
}
