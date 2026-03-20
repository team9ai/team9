import type { DebugEvent } from "@/lib/types";
import { getEventCategory } from "@/lib/events";
import { MessageRenderer } from "./MessageRenderer";
import { StreamingRenderer } from "./StreamingRenderer";
import { PresenceRenderer } from "./PresenceRenderer";
import { GenericRenderer } from "./GenericRenderer";

export function renderEventPreview(event: DebugEvent) {
  const category = getEventCategory(event.eventName);

  switch (category) {
    case "message":
      return <MessageRenderer event={event} />;
    case "streaming":
      return <StreamingRenderer event={event} />;
    case "presence":
    case "typing":
      return <PresenceRenderer event={event} />;
    default:
      return <GenericRenderer event={event} />;
  }
}
