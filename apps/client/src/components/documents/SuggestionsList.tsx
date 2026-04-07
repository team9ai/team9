import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentSuggestions } from "@/hooks/useDocuments";
import type { SuggestionResponse } from "@/types/document";

interface SuggestionsListProps {
  documentId: string;
  onViewSuggestion: (suggestion: SuggestionResponse) => void;
}

export function SuggestionsList({
  documentId,
  onViewSuggestion,
}: SuggestionsListProps) {
  const { t } = useTranslation("routines");
  const [expanded, setExpanded] = useState(false);

  const { data: suggestions } = useDocumentSuggestions(documentId, "pending");

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium hover:text-foreground/80"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Sparkles size={14} className="text-amber-500" />
        {t("detail.document.suggestions.count", {
          count: suggestions.length,
        })}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2"
            >
              <p className="text-xs text-muted-foreground line-clamp-1 flex-1">
                {suggestion.summary || t("detail.document.suggestions.title")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs shrink-0"
                onClick={() => onViewSuggestion(suggestion)}
              >
                {t("detail.document.suggestions.view")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
