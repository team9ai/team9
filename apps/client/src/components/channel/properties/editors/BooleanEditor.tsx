import { useCallback } from "react";

import { Switch } from "@/components/ui/switch";
import type { PropertyDefinition } from "@/types/properties";

interface BooleanEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function BooleanEditor({
  value,
  onChange,
  disabled,
}: BooleanEditorProps) {
  const handleChange = useCallback(
    (checked: boolean) => {
      onChange(checked);
    },
    [onChange],
  );

  return (
    <Switch
      checked={value === true}
      onCheckedChange={handleChange}
      disabled={disabled}
    />
  );
}
