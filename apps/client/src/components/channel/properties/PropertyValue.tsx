import { useMemo } from "react";
import { Check, X as XIcon, ExternalLink } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useChannelMembers } from "@/hooks/useChannels";
import { PropertyTag } from "./PropertyTag";
import { cn } from "@/lib/utils";
import type { PropertyDefinition, SelectOption } from "@/types/properties";

export interface PropertyValueProps {
  definition: PropertyDefinition;
  value: unknown;
  channelId?: string;
  className?: string;
  /**
   * For `person` properties: whether to render the property key as a prefix
   * inside the pill (e.g. `Assignee:`). Defaults to false — callers should
   * set it true only when disambiguation is needed (e.g. schema has multiple
   * person-type definitions and the definition is custom, non-native).
   */
  showKeyPrefix?: boolean;
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
  channelId,
  className,
  showKeyPrefix = false,
}: PropertyValueProps) {
  const { data: members } = useChannelMembers(
    definition.valueType === "person" ? channelId : undefined,
  );
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
        const rawIds = Array.isArray(value) ? value : [value];
        const ids = rawIds
          .map((id) => (id == null ? "" : String(id)))
          .filter((id) => id.length > 0);
        if (ids.length === 0) return null;

        if (ids.length === 1) {
          const id = ids[0];
          const member = members?.find((m) => m.userId === id);
          const user = member?.user;
          const name = user?.displayName || user?.username || "Unknown User";
          return (
            <span className="inline-flex items-center gap-1">
              <UserAvatar
                userId={id}
                name={user?.displayName}
                username={user?.username}
                avatarUrl={user?.avatarUrl}
                isBot={user?.userType === "bot"}
                className="w-4 h-4"
                fallbackClassName="text-[8px]"
              />
              <span className="truncate max-w-[120px]">{name}</span>
            </span>
          );
        }

        return (
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center -space-x-1.5">
              {ids.slice(0, 5).map((id) => {
                const member = members?.find((m) => m.userId === id);
                const user = member?.user;
                return (
                  <UserAvatar
                    key={id}
                    userId={id}
                    name={user?.displayName}
                    username={user?.username}
                    avatarUrl={user?.avatarUrl}
                    isBot={user?.userType === "bot"}
                    className="w-5 h-5 ring-2 ring-background"
                    fallbackClassName="text-[8px]"
                  />
                );
              })}
            </span>
            {ids.length > 5 && (
              <span className="text-muted-foreground">+{ids.length - 5}</span>
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
  }, [definition, value, members]);

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

  // Person shares the default pill wrapper, but the key prefix is opt-in via
  // `showKeyPrefix` (callers decide based on schema disambiguation rules).
  const hideLabel = definition.valueType === "person" && !showKeyPrefix;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs",
        className,
      )}
    >
      {!hideLabel && (
        <span className="text-muted-foreground">{displayLabel}:</span>
      )}
      {rendered}
    </span>
  );
}
