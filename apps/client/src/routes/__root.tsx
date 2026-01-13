import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy } from "react";

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

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <ReactQueryDevtools />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  ),
});
