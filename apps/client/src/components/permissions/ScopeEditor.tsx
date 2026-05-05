import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type ScopeValue = Record<string, unknown>;

interface FieldDef {
  key: string;
  label: string;
  type: "array" | "string";
  options?: string[];
}

const SCHEMAS: Record<string, FieldDef[]> = {
  "messages:send": [
    { key: "channelIds", label: "Channel IDs", type: "array" },
    {
      key: "channelTypes",
      label: "Channel Types",
      type: "array",
      options: ["public", "private", "direct"],
    },
  ],
  "messages:read": [{ key: "channelIds", label: "Channel IDs", type: "array" }],
  "tools:invoke": [
    { key: "toolNames", label: "Tool Names", type: "array" },
    { key: "targets", label: "Targets", type: "array" },
  ],
  "wiki:read": [{ key: "wikiId", label: "Wiki ID", type: "string" }],
  "wiki:write": [{ key: "wikiId", label: "Wiki ID", type: "string" }],
  "routine:trigger": [
    { key: "routineId", label: "Routine ID", type: "string" },
  ],
  "files:read": [{ key: "paths", label: "Paths", type: "array" }],
  "files:write": [{ key: "paths", label: "Paths", type: "array" }],
};

export interface ScopeEditorProps {
  permissionKey: string;
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ScopeEditor({
  permissionKey,
  value,
  onChange,
}: ScopeEditorProps) {
  // Must call hooks unconditionally
  const { t: _t } = useTranslation("permissions");
  const fields = SCHEMAS[permissionKey];
  const json = useMemo(
    () => (!fields ? JSON.stringify(value, null, 2) : ""),
    [fields, value],
  );

  if (!fields) {
    return (
      <label className="block text-sm">
        <span>JSON</span>
        <textarea
          aria-label="JSON"
          rows={6}
          defaultValue={json}
          className="w-full font-mono text-xs"
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value || "{}"));
            } catch {
              /* ignore until valid */
            }
          }}
        />
      </label>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {fields.map((f) => {
        const id = `scope-${f.key}`;
        if (f.type === "array") {
          const current = (value[f.key] as string[] | undefined) ?? [];
          return (
            <label key={f.key} htmlFor={id} className="block">
              <span>{f.label}</span>
              <input
                id={id}
                aria-label={f.label}
                placeholder="comma-separated"
                defaultValue={current.join(", ")}
                onChange={(e) =>
                  onChange({ ...value, [f.key]: parseList(e.target.value) })
                }
                className="w-full"
              />
            </label>
          );
        }
        return (
          <label key={f.key} htmlFor={id} className="block">
            <span>{f.label}</span>
            <input
              id={id}
              aria-label={f.label}
              defaultValue={(value[f.key] as string | undefined) ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              className="w-full"
            />
          </label>
        );
      })}
    </div>
  );
}
