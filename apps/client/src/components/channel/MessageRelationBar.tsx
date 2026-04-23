import { useState } from "react";
import { useMessageRelations } from "@/hooks/useMessageRelations";
import { MessageRefChip } from "./properties/MessageRefChip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

export interface MessageRelationBarProps {
  messageId: string;
  onNavigate?: (messageId: string) => void;
}

export function MessageRelationBar({
  messageId,
  onNavigate,
}: MessageRelationBarProps) {
  const { data } = useMessageRelations(messageId, 1);
  if (!data) return null;

  const empty =
    data.outgoing.parent.length === 0 &&
    data.outgoing.related.length === 0 &&
    data.incoming.children.length === 0 &&
    data.incoming.relatedBy.length === 0;

  if (empty) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
      {data.outgoing.parent.length > 0 && (
        <RelationRow
          label="↑ 父"
          items={data.outgoing.parent}
          showThreadBadge
          onNavigate={onNavigate}
        />
      )}
      {data.incoming.children.length > 0 && (
        <RelationRow
          label="↓ 子"
          items={data.incoming.children}
          onNavigate={onNavigate}
        />
      )}
      {data.outgoing.related.length > 0 && (
        <RelationRow
          label="↔ 关联"
          items={data.outgoing.related}
          onNavigate={onNavigate}
        />
      )}
      {data.incoming.relatedBy.length > 0 && (
        <RelationRow
          label="← 被关联"
          items={data.incoming.relatedBy}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

interface RelationRowItem {
  messageId: string;
  parentSource?: "relation" | "thread";
}

interface RelationRowProps {
  label: string;
  items: RelationRowItem[];
  showThreadBadge?: boolean;
  onNavigate?: (id: string) => void;
}

const MAX_INLINE = 3;

function RelationRow({
  label,
  items,
  showThreadBadge,
  onNavigate,
}: RelationRowProps) {
  const visible = items.slice(0, MAX_INLINE);
  const overflow = items.slice(MAX_INLINE);

  return (
    <span className="inline-flex items-center gap-1">
      <span className="opacity-70">{label}:</span>
      {visible.map((it) => (
        <MessageRefChip
          key={it.messageId}
          target={{ id: it.messageId }}
          parentSource={showThreadBadge ? (it.parentSource ?? null) : null}
          onNavigate={onNavigate}
        />
      ))}
      {overflow.length > 0 && (
        <OverflowPopover
          items={overflow}
          showThreadBadge={showThreadBadge}
          onNavigate={onNavigate}
        />
      )}
    </span>
  );
}

interface OverflowPopoverProps {
  items: RelationRowItem[];
  showThreadBadge?: boolean;
  onNavigate?: (id: string) => void;
}

function OverflowPopover({
  items,
  showThreadBadge,
  onNavigate,
}: OverflowPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full border px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
          aria-expanded={open}
        >
          +{items.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-xs p-2"
        align="start"
        side="bottom"
      >
        <div className="flex flex-wrap gap-1">
          {items.map((it) => (
            <MessageRefChip
              key={it.messageId}
              target={{ id: it.messageId }}
              parentSource={showThreadBadge ? (it.parentSource ?? null) : null}
              onNavigate={(id) => {
                setOpen(false);
                onNavigate?.(id);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
