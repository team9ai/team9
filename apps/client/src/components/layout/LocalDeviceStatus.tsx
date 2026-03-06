import { useAHandStatus } from "../../hooks/useAHandStatus.js";

export function LocalDeviceStatus() {
  const status = useAHandStatus();
  if (status === "not-desktop") return null;

  const dot =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500 animate-pulse"
        : "bg-red-400";

  const label =
    status === "connected"
      ? "本地已连接"
      : status === "connecting"
        ? "连接中…"
        : "未启动";

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
