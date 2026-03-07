import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBrowserInitStatus, runBrowserInit } from "@/hooks/useBrowserInit";

export function BrowserInitDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useBrowserInitStatus();
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setError(null);
    try {
      const ok = await runBrowserInit(status === "failed");
      if (!ok) {
        setError("安装完成但验证失败，请重试。");
      }
    } catch (err) {
      const msg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg || "安装失败，请检查网络连接后重试。");
    }
  };

  const isInstalling = status === "installing";
  const isReady = status === "ready";

  return (
    <Dialog open={open} onOpenChange={isInstalling ? undefined : onOpenChange}>
      <DialogContent
        className="max-w-sm"
        onInteractOutside={isInstalling ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>浏览器自动化组件</DialogTitle>
          <DialogDescription>
            {isReady
              ? "浏览器自动化组件已安装完成。"
              : "需要安装浏览器自动化组件才能让 AI 控制本地浏览器（自动点击、填写表单、截图等）。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-4">
          {isInstalling && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                正在安装，这可能需要几分钟...
              </p>
            </>
          )}
          {isReady && (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="text-sm text-muted-foreground">安装完成</p>
            </>
          )}
          {status === "failed" && (
            <>
              <XCircle className="h-8 w-8 text-red-500" />
              <p className="text-sm text-destructive">{error}</p>
            </>
          )}
        </div>

        <DialogFooter>
          {isReady ? (
            <Button onClick={() => onOpenChange(false)}>完成</Button>
          ) : (
            <>
              {!isInstalling && (
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  稍后再说
                </Button>
              )}
              <Button onClick={handleInstall} disabled={isInstalling}>
                {isInstalling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    安装中...
                  </>
                ) : status === "failed" ? (
                  "重试安装"
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    开始安装
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
