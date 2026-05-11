import type { SafeSessionComponentsResponse } from "@/types/im";
import { SessionComponentRow } from "./SessionComponentRow";

export function SessionComponentList({
  components,
}: {
  components: SafeSessionComponentsResponse | undefined;
}) {
  const rows = components?.components ?? [];
  if (rows.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground">No component data</p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3">
      {rows.map((component) => (
        <SessionComponentRow key={component.id} component={component} />
      ))}
    </div>
  );
}
