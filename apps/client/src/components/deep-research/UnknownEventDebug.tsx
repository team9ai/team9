import { useState } from "react";

export interface UnknownEventDebugProps {
  count: number;
  samples: { event: string; data: string }[];
}

export function UnknownEventDebug({ count, samples }: UnknownEventDebugProps) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <details
      className="rounded border border-dashed border-zinc-400 p-2 text-xs"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-zinc-500">
        Unknown events: {count}
      </summary>
      <ul className="mt-1 space-y-1">
        {samples.map((s, i) => (
          <li key={i}>
            <code className="text-[10px]">{s.event}</code> —{" "}
            <code className="text-[10px]">{s.data.slice(0, 200)}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
