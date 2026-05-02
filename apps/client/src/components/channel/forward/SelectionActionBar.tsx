import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useForwardSelectionStore } from "@/stores/useForwardSelectionStore";

interface Props {
  onForward: () => void;
}

export function SelectionActionBar({ onForward }: Props) {
  const { t } = useTranslation("channel");
  const active = useForwardSelectionStore((s) => s.active);
  const selectedSize = useForwardSelectionStore((s) => s.selectedIds.size);
  const exit = useForwardSelectionStore((s) => s.exit);

  if (!active) return null;

  return (
    <div
      role="region"
      aria-label="Selection actions"
      className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-background p-3 shadow"
    >
      <span className="text-sm">
        {t("forward.selection.bar", { count: selectedSize })}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" onClick={exit}>
          {t("forward.selection.cancel")}
        </Button>
        <Button disabled={selectedSize === 0} onClick={onForward}>
          {t("forward.toolbar.forward")}
        </Button>
      </div>
    </div>
  );
}
