import { useState } from "react";
import { useAHandStatus } from "../../hooks/useAHandStatus.js";
import { useAHandRetry } from "../../hooks/useAHandAutoConnect.js";
import { useBrowserInitStatus } from "../../hooks/useBrowserInit.js";
import { BrowserInitDialog } from "../dialog/BrowserInitDialog.js";

export function LocalDeviceStatus() {
  const status = useAHandStatus();
  const { retryState, retry } = useAHandRetry();
  const browserStatus = useBrowserInitStatus();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (status === "not-desktop") return null;

  const showRetry = retryState === "timeout" && status !== "connected";
  const browserReady = browserStatus === "ready";
  const showBrowserInstall =
    browserStatus === "not-installed" || browserStatus === "failed";

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
    <>
      <div className="flex flex-col gap-0.5 px-3 py-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
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
        {status === "connected" && (
          <div className="flex items-center gap-1.5 pl-3.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${browserReady ? "bg-green-500" : "bg-yellow-500"}`}
            />
            {browserReady ? (
              "浏览器就绪"
            ) : showBrowserInstall ? (
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="text-xs text-primary hover:underline"
              >
                安装浏览器组件
              </button>
            ) : browserStatus === "installing" ? (
              "浏览器安装中…"
            ) : null}
          </div>
        )}
      </div>
      <BrowserInitDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
