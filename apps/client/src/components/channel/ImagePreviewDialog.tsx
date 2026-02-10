import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, ExternalLink, Download } from "lucide-react";

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
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none">
          <DialogPrimitive.Title className="sr-only">
            {alt || "Image preview"}
          </DialogPrimitive.Title>

          {/* Top bar with actions */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 z-10">
            <span className="text-white/80 text-sm truncate max-w-[60%]">
              {alt}
            </span>
            <div className="flex items-center gap-1">
              <a
                href={src}
                download
                className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Download"
              >
                <Download size={18} />
              </a>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Open in new tab"
              >
                <ExternalLink size={18} />
              </a>
              <DialogPrimitive.Close className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors">
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
