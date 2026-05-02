import type { Message } from "@/types/im";

const ALLOWED_TYPES: ReadonlySet<Message["type"]> = new Set([
  "text",
  "long_text",
  "file",
  "image",
  "forward",
]);

export function isForwardable(message: Message): boolean {
  if (message.isDeleted) return false;
  if (!ALLOWED_TYPES.has(message.type)) return false;
  const meta = message.metadata as Record<string, unknown> | undefined;
  if (meta?.streaming === true) return false;
  return true;
}

export function computeForwardableRange(
  visibleMessages: Message[],
  fromId: string,
  toId: string,
): string[] {
  const fromIdx = visibleMessages.findIndex((m) => m.id === fromId);
  const toIdx = visibleMessages.findIndex((m) => m.id === toId);
  if (fromIdx === -1 || toIdx === -1) return [];
  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  return visibleMessages
    .slice(lo, hi + 1)
    .filter(isForwardable)
    .map((m) => m.id);
}
