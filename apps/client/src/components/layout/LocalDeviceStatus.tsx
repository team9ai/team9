import { useAHandStatus } from "../../hooks/useAHandStatus.js";

export function LocalDeviceStatus() {
  const status = useAHandStatus();
  if (status === "not-desktop") return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
      <span
        className={`h-2 w-2 rounded-full ${
          status === "connected"
            ? "bg-green-500"
            : "bg-yellow-500 animate-pulse"
        }`}
      />
      {status === "connected" ? "本地已连接" : "本地未连接"}
    </div>
  );
}
