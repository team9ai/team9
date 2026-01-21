import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-input bg-background",
        notification: "bg-red-500 text-white",
      },
      size: {
        default: "h-5 min-w-5 px-1.5 text-xs rounded-full",
        sm: "h-4 min-w-4 px-1 text-[10px] rounded-full",
        lg: "h-6 min-w-6 px-2 text-sm rounded-full",
        dot: "h-2.5 w-2.5 rounded-full p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Maximum count to display, shows "99+" if exceeded */
  maxCount?: number;
  /** Count to display */
  count?: number;
  /** Show as dot without count */
  dot?: boolean;
  /** Show zero count */
  showZero?: boolean;
}

function Badge({
  className,
  variant,
  size,
  count,
  maxCount = 99,
  dot = false,
  showZero = false,
  children,
  ...props
}: BadgeProps) {
  // Don't render if count is 0 and showZero is false
  if (count !== undefined && count === 0 && !showZero && !dot) {
    return null;
  }

  // Render as dot
  if (dot) {
    return (
      <span
        className={cn(badgeVariants({ variant, size: "dot", className }))}
        {...props}
      />
    );
  }

  // Render with count
  if (count !== undefined) {
    const displayCount = count > maxCount ? `${maxCount}+` : count;
    return (
      <span
        className={cn(badgeVariants({ variant, size, className }))}
        {...props}
      >
        {displayCount}
      </span>
    );
  }

  // Render with children
  return (
    <span
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </span>
  );
}

export interface NotificationBadgeProps {
  /** Count to display */
  count: number;
  /** Maximum count to display */
  maxCount?: number;
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: "sm" | "default" | "lg";
}

/**
 * A notification badge component for displaying unread counts
 * Positioned absolutely - should be placed inside a relative container
 */
function NotificationBadge({
  count,
  maxCount = 99,
  className,
  size = "sm",
}: NotificationBadgeProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <Badge
      variant="notification"
      size={size}
      count={count}
      maxCount={maxCount}
      className={cn("absolute -top-1.5 -right-1.5", className)}
    />
  );
}

export { Badge, NotificationBadge, badgeVariants };
