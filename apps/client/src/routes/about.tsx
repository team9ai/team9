import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  const navigate = useNavigate();

  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">About</h1>
      <p className="mb-4">This is a sample page using TanStack Router.</p>

      <button
        onClick={() => navigate({ to: "/" })}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Navigate to Home
      </button>
    </main>
  );
}
