import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Copy, X, ExternalLink, Download } from "lucide-react";

interface ImagePreviewDialogProps {
  src: string;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImagePreviewDialog({
  src,
  alt,
  open,
  onOpenChange,
}: ImagePreviewDialogProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const handleCopyImage = useCallback(async () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      toast.error(t("imagePreview.copyFailed"));
      return;
    }

    setIsCopying(true);
    try {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();
      const type = blob.type || "image/png";
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);

      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("imagePreview.copyFailed"));
    } finally {
      setIsCopying(false);
    }
  }, [src, t]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none">
          <DialogPrimitive.Title className="sr-only">
            {alt || "Image preview"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {alt || "Image preview"}
          </DialogPrimitive.Description>

          {/* Top bar with actions */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 z-10">
            <span className="text-white/80 text-sm truncate max-w-[60%]">
              {alt}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyImage}
                disabled={isCopying}
                className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                title={copied ? t("copied") : t("copy")}
                aria-label={t("copy")}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <a
                href={src}
                download
                className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title={t("imagePreview.download")}
                aria-label={t("imagePreview.download")}
              >
                <Download size={18} />
              </a>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title={t("imagePreview.openInNewTab")}
                aria-label={t("imagePreview.openInNewTab")}
              >
                <ExternalLink size={18} />
              </a>
              <DialogPrimitive.Close
                className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={t("close")}
              >
                <X size={18} />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Image - click outside to close */}
          <img
            src={src}
            alt={alt || ""}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg select-none"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Click backdrop to close */}
          <div
            className="absolute inset-0 -z-10"
            onClick={() => onOpenChange(false)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
