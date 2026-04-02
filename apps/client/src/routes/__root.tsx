import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy } from "react";
import { useThemeEffect } from "@/hooks/useTheme";
import { useDeepLink } from "@/hooks/useDeepLink";
void lazy;

function RootComponent() {
  useThemeEffect();
  useDeepLink();

  return (
    <>
      <Outlet />
      {/* <ReactQueryDevtools />
      <TanStackRouterDevtools position="bottom-right" /> */}
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
