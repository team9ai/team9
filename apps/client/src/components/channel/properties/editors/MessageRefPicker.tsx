import { useCallback } from "react";
import { MessageSquare } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { PropertyDefinition } from "@/types/properties";

interface MessageRefPickerProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function MessageRefPicker({
  value,
  onChange,
  disabled,
}: MessageRefPickerProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value || null);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-1.5">
      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Message ID..."
      />
    </div>
  );
}
