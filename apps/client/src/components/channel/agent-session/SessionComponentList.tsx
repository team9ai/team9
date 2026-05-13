import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SafeSessionComponentsResponse } from "@/types/im";
import { SessionComponentRow } from "./SessionComponentRow";

function SessionIdRow({ sessionId }: { sessionId: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!sessionId) return null;

  const handleCopy = () => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;

    void writeText.call(navigator.clipboard, sessionId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
        Session ID
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          {sessionId}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label="复制 session id"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </div>
    </div>
  );
}

export function SessionComponentList({
  components,
  sessionId,
}: {
  components: SafeSessionComponentsResponse | undefined;
  sessionId?: string | null;
}) {
  const rows = components?.components ?? [];
  if (rows.length === 0) {
    return (
      <>
        <SessionIdRow sessionId={sessionId} />
        <p className="p-3 text-xs text-muted-foreground">No component data</p>
      </>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <SessionIdRow sessionId={sessionId} />
      <div className="px-3">
        {rows.map((component) => (
          <SessionComponentRow key={component.id} component={component} />
        ))}
      </div>
    </div>
  );
}
