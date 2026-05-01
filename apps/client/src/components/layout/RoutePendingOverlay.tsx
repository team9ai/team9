import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

function useIsRouteChangePending() {
  return useRouterState({
    select: (state) =>
      state.status === "pending" &&
      Boolean(state.resolvedLocation) &&
      state.location.href !== state.resolvedLocation?.href,
  });
}

export function RoutePendingOverlay() {
  const isPending = useIsRouteChangePending();

  if (!isPending) return null;

  return (
    <div
      data-testid="route-pending-overlay"
      role="status"
      aria-label="Loading page"
      className="absolute inset-0 z-20 flex h-full w-full flex-col bg-background p-6"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <PendingSkeleton className="h-6 w-52 max-w-[50%]" />
          <PendingSkeleton className="h-4 w-80 max-w-[70%]" />
        </div>
        <PendingSkeleton className="h-9 w-24" />
      </div>

      <div className="flex-1 space-y-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <PendingSkeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <PendingSkeleton className="h-4 w-40 max-w-[45%]" />
              <PendingSkeleton className="h-4 w-full" />
              <PendingSkeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingSkeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("route-pending-skeleton rounded-md", className)}
      {...props}
    />
  );
}
