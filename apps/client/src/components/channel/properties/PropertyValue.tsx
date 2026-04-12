import { useMemo } from "react";
import { Check, X as XIcon, ExternalLink } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PropertyTag } from "./PropertyTag";
import { cn } from "@/lib/utils";
import type { PropertyDefinition, SelectOption } from "@/types/properties";

export interface PropertyValueProps {
  definition: PropertyDefinition;
  value: unknown;
  className?: string;
}

function getSelectOptions(definition: PropertyDefinition): SelectOption[] {
  const config = definition.config;
  if (config && Array.isArray(config.options)) {
    return config.options as SelectOption[];
  }
  return [];
}

function formatDate(value: unknown): string {
  if (!value) return "";
  try {
    const date = new Date(value as string);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(value);
  }
}

function formatTimestamp(value: unknown): string {
  if (!value) return "";
  try {
    const date = new Date(value as string);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toLocaleString();
}

function truncateUrl(url: string, maxLen = 30): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    return display.length > maxLen ? display.slice(0, maxLen) + "..." : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "..." : url;
  }
}

export function PropertyValue({
  definition,
  value,
  className,
}: PropertyValueProps) {
  const label = definition.key.startsWith("_")
    ? definition.key.slice(1).replace(/_/g, " ")
    : definition.key;

  const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);

  const rendered = useMemo(() => {
    if (value === null || value === undefined) return null;

    switch (definition.valueType) {
      case "boolean":
        return (
          <span className="flex items-center">
            {value ? (
              <Check size={12} className="text-green-500" />
            ) : (
              <XIcon size={12} className="text-muted-foreground" />
            )}
          </span>
        );

      case "number":
        return <span>{formatNumber(value)}</span>;

      case "date":
        return <span>{formatDate(value)}</span>;

      case "timestamp":
        return <span>{formatTimestamp(value)}</span>;

      case "date_range":
      case "timestamp_range": {
        const range = value as { start?: string; end?: string };
        const fmt =
          definition.valueType === "date_range" ? formatDate : formatTimestamp;
        return (
          <span>
            {range.start ? fmt(range.start) : "?"} -{" "}
            {range.end ? fmt(range.end) : "?"}
          </span>
        );
      }

      case "single_select": {
        const options = getSelectOptions(definition);
        const selected = options.find((o) => o.value === value);
        if (selected) {
          return <PropertyTag label={selected.label} color={selected.color} />;
        }
        return <span>{String(value)}</span>;
      }

      case "multi_select":
      case "tags": {
        const options = getSelectOptions(definition);
        const values = Array.isArray(value) ? value : [value];
        return (
          <span className="inline-flex flex-wrap gap-0.5">
            {values.map((v, i) => {
              const opt = options.find((o) => o.value === v);
              return (
                <PropertyTag
                  key={String(v) + i}
                  label={opt?.label ?? String(v)}
                  color={opt?.color}
                />
              );
            })}
          </span>
        );
      }

      case "person": {
        const ids = Array.isArray(value) ? value : [value];
        return (
          <span className="inline-flex items-center gap-0.5">
            {ids.slice(0, 3).map((id) => (
              <UserAvatar
                key={String(id)}
                userId={String(id)}
                className="w-4 h-4"
                fallbackClassName="text-[8px]"
              />
            ))}
            {ids.length > 3 && (
              <span className="text-muted-foreground">+{ids.length - 3}</span>
            )}
          </span>
        );
      }

      case "url": {
        const urlStr = String(value);
        return (
          <a
            href={urlStr}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-info hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {truncateUrl(urlStr)}
            <ExternalLink size={10} />
          </a>
        );
      }

      case "message_ref":
      case "file":
      case "image":
      case "recurring":
        return (
          <span>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        );

      default:
        return (
          <span>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        );
    }
  }, [definition, value]);

  if (rendered === null) return null;

  // For tags/multi_select, render inline without wrapper badge
  if (
    definition.valueType === "tags" ||
    definition.valueType === "multi_select"
  ) {
    return rendered;
  }

  // For single_select already rendered as PropertyTag
  if (definition.valueType === "single_select") {
    return rendered;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs",
        className,
      )}
    >
      <span className="text-muted-foreground">{displayLabel}:</span>
      {rendered}
    </span>
  );
}
