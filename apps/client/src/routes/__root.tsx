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

export const Route = createRootRoute({
  component: RootComponent,
});
