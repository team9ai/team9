import { createRootRoute, Outlet, Link } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-3">
          <nav className="flex items-center gap-6">
            <Link to="/" className="text-xl font-bold text-primary">
              Agent Debugger
            </Link>
            <div className="flex gap-4">
              <Link
                to="/"
                className="text-sm font-medium text-muted-foreground hover:text-foreground [&.active]:text-foreground"
              >
                Agents
              </Link>
              <Link
                to="/blueprints"
                className="text-sm font-medium text-muted-foreground hover:text-foreground [&.active]:text-foreground"
              >
                Blueprints
              </Link>
              <Link
                to="/batch-test"
                className="text-sm font-medium text-muted-foreground hover:text-foreground [&.active]:text-foreground"
              >
                Batch Test
              </Link>
            </div>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </div>
  );
}
