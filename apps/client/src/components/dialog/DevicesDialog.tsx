import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { isTauriApp } from "@/lib/tauri";
import { ThisMacSection } from "./devices/ThisMacSection";
import { OtherDevicesList } from "./devices/OtherDevicesList";
import { WebCtaCard } from "./devices/WebCtaCard";

interface DevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DevicesDialog({ open, onOpenChange }: DevicesDialogProps) {
  const { t } = useTranslation("ahand");
  const tauri = isTauriApp();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {t("myDevices")}
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("myDevicesHelpAria")}
                    className="inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground cursor-help"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm">
                  <p className="text-xs leading-relaxed">
                    {t("myDevicesHelpIntro")}
                  </p>
                  <p className="text-xs leading-relaxed mt-2">
                    {t("myDevicesHelpAccess")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {tauri ? <ThisMacSection /> : <WebCtaCard />}
          <OtherDevicesList excludeLocal={tauri} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
