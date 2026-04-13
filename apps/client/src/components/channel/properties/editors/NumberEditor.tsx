import { useCallback } from "react";

import { Input } from "@/components/ui/input";
import type { PropertyDefinition } from "@/types/properties";

interface NumberEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function NumberEditor({
  definition,
  value,
  onChange,
  disabled,
}: NumberEditorProps) {
  const format = definition.config?.format as string | undefined;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === "") {
        onChange(null);
        return;
      }
      const num = parseFloat(raw);
      if (!isNaN(num)) {
        onChange(num);
      }
    },
    [onChange],
  );

  const displayValue =
    value !== null && value !== undefined ? String(value) : "";

  return (
    <div className="flex items-center gap-1.5">
      {format === "currency" && (
        <span className="text-sm text-muted-foreground">
          {(definition.config?.currencySymbol as string) || "$"}
        </span>
      )}
      <Input
        type="number"
        value={displayValue}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Enter number..."
        step={format === "percent" ? "0.01" : "any"}
      />
      {format === "percent" && (
        <span className="text-sm text-muted-foreground">%</span>
      )}
    </div>
  );
}
