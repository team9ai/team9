import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy } from "react";
import { useThemeEffect } from "@/hooks/useTheme";

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/router-devtools").then((mod) => ({
        default: mod.TanStackRouterDevtools,
      })),
    );

const ReactQueryDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-query-devtools").then((mod) => ({
        default: mod.ReactQueryDevtools,
      })),
    );

function RootComponent() {
  useThemeEffect();

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
