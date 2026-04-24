import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy } from "react";
import { useThemeEffect } from "@/hooks/useTheme";
import { useDeepLink } from "@/hooks/useDeepLink";
import { TooltipProvider } from "@/components/ui/tooltip";
void lazy;

function RootComponent() {
  useThemeEffect();
  useDeepLink();

  return (
    <TooltipProvider delayDuration={200}>
      <Outlet />
      {/* <ReactQueryDevtools />
      <TanStackRouterDevtools position="bottom-right" /> */}
    </TooltipProvider>
  );
}

function RootErrorComponent({ error }: { error: unknown }) {
  const err = error instanceof Error ? error : null;
  const message = err?.message ?? String(error);
  const stack = err?.stack ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background select-text">
      <div className="max-w-2xl w-full space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            Something went wrong
          </h1>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Reload
          </button>
        </div>
        <pre className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-3 text-xs whitespace-pre-wrap break-all">
          {message}
        </pre>
        {stack && (
          <details className="rounded-md border border-border bg-muted/30 p-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Stack trace
            </summary>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-all">
              {stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
});
