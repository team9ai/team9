import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
          <DialogTitle>{t("myDevices")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {tauri ? <ThisMacSection /> : <WebCtaCard />}
          <OtherDevicesList excludeLocal={tauri} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
