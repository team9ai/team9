import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  appActions,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  useFontScales,
} from "@/stores";

interface FontSizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RegionRowProps {
  label: string;
  description: string;
  previewLabel: string;
  previewText: string;
  value: number;
  onChange: (next: number) => void;
}

function RegionRow({
  label,
  description,
  previewLabel,
  previewText,
  value,
  onChange,
}: RegionRowProps) {
  const previewStyle = { "--font-scale": value } as CSSProperties;
  const percent = Math.round(value * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
          {percent}%
        </span>
      </div>

      <Slider
        min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
        step={FONT_SCALE_STEP}
        value={[value]}
        onValueChange={(values) => {
          const next = values[0];
          if (typeof next === "number") onChange(next);
        }}
        aria-label={label}
      />

      <div
        className="font-scope rounded-lg border bg-muted/30 p-3"
        style={previewStyle}
      >
        <p className="text-xs text-muted-foreground mb-1">{previewLabel}</p>
        <p className="text-sm text-foreground">{previewText}</p>
      </div>
    </div>
  );
}

export function FontSizeDialog({ open, onOpenChange }: FontSizeDialogProps) {
  const { t } = useTranslation("settings");
  const committed = useFontScales();

  // Draft is the in-flight, preview-only state. It only flushes to the store
  // when the user clicks Confirm. Closing the dialog (Cancel / overlay click /
  // ESC) discards it. We re-seed from `committed` every time the dialog opens
  // so a previously cancelled session doesn't leak into the next.
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    if (open) setDraft(committed);
  }, [open, committed]);

  const isDirty =
    draft.sidebar !== committed.sidebar || draft.main !== committed.main;
  const isDefault =
    draft.sidebar === FONT_SCALE_DEFAULT && draft.main === FONT_SCALE_DEFAULT;

  const handleConfirm = () => {
    if (isDirty) {
      appActions.setFontScale("sidebar", draft.sidebar);
      appActions.setFontScale("main", draft.main);
    }
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleResetDraft = () => {
    setDraft({ sidebar: FONT_SCALE_DEFAULT, main: FONT_SCALE_DEFAULT });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg dark:bg-card">
        <DialogHeader>
          <DialogTitle className="dark:text-foreground">
            {t("fontSizeDialog.title", "Font size")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "fontSizeDialog.description",
              "Drag the sliders to preview the new size. Click Confirm to apply.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <RegionRow
            label={t("fontSizeDialog.sidebarLabel", "Sidebar")}
            description={t(
              "fontSizeDialog.sidebarDescription",
              "Channels, navigation, and the workspace switcher on the left.",
            )}
            previewLabel={t("fontSizeDialog.preview", "Preview")}
            previewText={t(
              "fontSizeDialog.previewText",
              "The quick brown fox jumps over the lazy dog.",
            )}
            value={draft.sidebar}
            onChange={(next) =>
              setDraft((prev) => ({ ...prev, sidebar: next }))
            }
          />

          <RegionRow
            label={t("fontSizeDialog.mainLabel", "Main content")}
            description={t(
              "fontSizeDialog.mainDescription",
              "Channel messages, wikis, and other primary content on the right.",
            )}
            previewLabel={t("fontSizeDialog.preview", "Preview")}
            previewText={t(
              "fontSizeDialog.previewText",
              "The quick brown fox jumps over the lazy dog.",
            )}
            value={draft.main}
            onChange={(next) => setDraft((prev) => ({ ...prev, main: next }))}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isDefault}
            onClick={handleResetDraft}
            className="mr-auto"
          >
            <RotateCcw className="mr-2 size-3.5" />
            {t("fontSizeDialog.reset", "Reset to default")}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t("fontSizeDialog.cancel", "Cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!isDirty}>
            {t("fontSizeDialog.confirm", "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
