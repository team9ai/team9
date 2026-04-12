import { useCallback } from "react";

import { Input } from "@/components/ui/input";
import type { PropertyDefinition } from "@/types/properties";

interface TextEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function TextEditor({ value, onChange, disabled }: TextEditorProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <Input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={handleChange}
      disabled={disabled}
      placeholder="Enter text..."
    />
  );
}
