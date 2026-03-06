import { useAHandStatus } from "../../hooks/useAHandStatus.js";
import { useAHandRetry } from "../../hooks/useAHandAutoConnect.js";

export function LocalDeviceStatus() {
  const status = useAHandStatus();
  const { retryState, retry } = useAHandRetry();
  if (status === "not-desktop") return null;

  const showRetry = retryState === "timeout" && status !== "connected";

  const dot =
    status === "connected"
      ? "bg-green-500"
      : showRetry
        ? "bg-red-400"
        : status === "connecting"
          ? "bg-yellow-500 animate-pulse"
          : "bg-red-400";

  const label =
    status === "connected"
      ? "本地已连接"
      : retryState === "polling"
        ? "配对中…"
        : showRetry
          ? "连接超时"
          : status === "connecting"
            ? "连接中…"
            : "未启动";

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
      {showRetry && retry && (
        <button
          type="button"
          onClick={retry}
          className="ml-1 text-xs text-primary hover:underline"
        >
          重试
        </button>
      )}
    </div>
  );
}
