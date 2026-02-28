import { cn } from "@/lib/utils";
import { useIsUserOnline } from "@/hooks/useIMUsers";

interface OnlineStatusDotProps {
  /** User ID for real-time online status detection */
  userId: string;
  /** Whether to show offline state (gray dot). If false, hides when offline. */
  showOffline?: boolean;
  className?: string;
}

/**
 * Real-time online status indicator dot.
 * Uses useIsUserOnline hook internally for consistent, real-time status across all components.
 */
export function OnlineStatusDot({
  userId,
  showOffline = false,
  className,
}: OnlineStatusDotProps) {
  const isOnline = useIsUserOnline(userId);

  if (!isOnline && !showOffline) return null;

  return (
    <div
      className={cn(
        "rounded-full",
        isOnline ? "bg-success" : "bg-muted-foreground",
        className,
      )}
    />
  );
}
