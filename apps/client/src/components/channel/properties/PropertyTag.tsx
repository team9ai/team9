import { forwardRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PropertyTagProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "color"
> {
  label: string;
  color?: string;
  canDelete?: boolean;
  onDelete?: () => void;
}

export const PropertyTag = forwardRef<HTMLSpanElement, PropertyTagProps>(
  function PropertyTag(
    { label, color, canDelete = false, onDelete, className, ...rest },
    ref,
  ) {
    return (
      <span
        ref={ref}
        className={cn(
          "group/tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs relative",
          className,
        )}
        {...rest}
      >
        {color && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate max-w-[120px]">{label}</span>
        {canDelete && onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDelete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 -mr-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-background/60 opacity-0 group-hover/tag:opacity-100 transition-opacity"
            aria-label={`Remove ${label}`}
          >
            <X size={12} />
          </button>
        )}
      </span>
    );
  },
);
