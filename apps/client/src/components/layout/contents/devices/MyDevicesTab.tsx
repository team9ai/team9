import { useTranslation } from "react-i18next";
import { isTauriApp } from "@/lib/tauri";
import { OtherDevicesList } from "@/components/dialog/devices/OtherDevicesList";
import { ThisMacSection } from "@/components/dialog/devices/ThisMacSection";

export function MyDevicesTab() {
  const { t } = useTranslation("ahand");
  const tauri = isTauriApp();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.myDevicesDescription")}
      </p>
      {tauri && <ThisMacSection />}
      <OtherDevicesList excludeLocal={tauri} />
    </div>
  );
}
