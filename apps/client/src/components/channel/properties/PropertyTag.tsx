import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PropertyTagProps {
  label: string;
  color?: string;
  canDelete?: boolean;
  onDelete?: () => void;
  className?: string;
}

export function PropertyTag({
  label,
  color,
  canDelete = false,
  onDelete,
  className,
}: PropertyTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs",
        className,
      )}
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
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
