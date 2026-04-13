import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PropertyDefinition } from "@/types/properties";

interface UrlEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

export function UrlEditor({ value, onChange, disabled }: UrlEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const strValue = typeof value === "string" ? value : "";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    if (strValue && !isValidUrl(strValue)) {
      setError("Please enter a valid URL");
    }
  }, [strValue]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="url"
          value={strValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="https://..."
          className={cn(error && "border-destructive")}
        />
        {strValue && isValidUrl(strValue) && (
          <a
            href={strValue}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
