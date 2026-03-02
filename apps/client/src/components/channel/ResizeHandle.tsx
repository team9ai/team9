import { useResizeHandle } from "@/hooks/useResizeHandle";

interface ResizeHandleProps {
  width: number;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

export function ResizeHandle({
  width,
  onWidthChange,
  minWidth,
  maxWidth,
}: ResizeHandleProps) {
  const { handleMouseDown, isDragging } = useResizeHandle({
    width,
    onWidthChange,
    minWidth,
    maxWidth,
    direction: "left",
  });

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`absolute left-0 top-0 bottom-0 w-1 -translate-x-1/2 cursor-col-resize z-10 hover:bg-primary/30 transition-colors duration-150 ${isDragging ? "bg-primary/50" : ""}`}
    />
  );
}
