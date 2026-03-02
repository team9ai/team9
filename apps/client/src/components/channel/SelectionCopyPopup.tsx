import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Copy, Check } from "lucide-react";

interface SelectionCopyPopupProps {
  anchorRect: DOMRect;
  selectedText: string;
  onDismiss: () => void;
}

export function SelectionCopyPopup({
  anchorRect,
  selectedText,
  onDismiss,
}: SelectionCopyPopupProps) {
  const [copied, setCopied] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const top = anchorRect.top + window.scrollY - 40;
  const left = anchorRect.left + window.scrollX + anchorRect.width / 2;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(selectedText).then(() => {
      setCopied(true);
      setTimeout(() => {
        onDismiss();
      }, 1500);
    });
  }, [selectedText, onDismiss]);

  // Dismiss on mousedown outside popup
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Dismiss on scroll
    const handleScroll = () => onDismiss();

    document.addEventListener("mousedown", handleMouseDown);
    // Use capture to catch scroll on any scrollable ancestor
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      ref={popupRef}
      role="button"
      tabIndex={0}
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleCopy();
      }}
      className="fixed z-50 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md cursor-pointer select-none hover:bg-accent transition-colors animate-in fade-in-0 zoom-in-95"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      {copied ? (
        <>
          <Check size={14} className="text-green-500" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={14} />
          <span>Copy</span>
        </>
      )}
    </div>,
    document.body,
  );
}
