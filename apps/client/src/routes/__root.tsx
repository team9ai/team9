import {
  createRootRoute,
  Link,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { lazy } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Compass, Home } from "lucide-react";
import { useThemeEffect } from "@/hooks/useTheme";
import { useDeepLink } from "@/hooks/useDeepLink";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
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

function NotFoundComponent() {
  const { t } = useTranslation("common");
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: "/" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background select-none">
      <div className="max-w-md w-full flex flex-col items-center text-center space-y-6">
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-0 blur-3xl opacity-40 bg-gradient-to-br from-primary/40 via-primary/10 to-transparent rounded-full"
          />
          <div className="relative flex items-center justify-center size-20 rounded-2xl bg-muted/60 border border-border shadow-sm">
            <Compass className="size-10 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-6xl font-bold tracking-tight bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">
            404
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {t("notFound.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            {t("notFound.description")}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            className="min-w-32"
          >
            <ArrowLeft />
            {t("notFound.goBack")}
          </Button>
          <Button asChild className="min-w-32">
            <Link to="/">
              <Home />
              {t("notFound.goHome")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFoundComponent,
});
