import { useCallback, useRef, useEffect, useState } from "react";

interface UseResizeHandleOptions {
  width: number;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  // 'left' means dragging the left edge — panel grows when dragged left
  direction?: "left" | "right";
}

interface UseResizeHandleReturn {
  handleMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
}

export function useResizeHandle({
  width,
  onWidthChange,
  minWidth = 320,
  maxWidth = 600,
  direction = "left",
}: UseResizeHandleOptions): UseResizeHandleReturn {
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta =
        direction === "left"
          ? startXRef.current - e.clientX
          : e.clientX - startXRef.current;
      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidthRef.current + delta),
      );
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, direction, minWidth, maxWidth, onWidthChange]);

  return { handleMouseDown, isDragging };
}
