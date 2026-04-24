import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isTauriApp } from "@/lib/tauri";
import { OverviewTab } from "./devices/OverviewTab";
import { BrowserConfigTab } from "./devices/BrowserConfigTab";
import { PermissionsTab } from "./devices/PermissionsTab";
import { MyDevicesTab } from "./devices/MyDevicesTab";
import { AuditLogTab } from "./devices/AuditLogTab";

type DeviceTab = "overview" | "browser" | "permissions" | "myDevices" | "audit";

export function DevicesContent() {
  const { t } = useTranslation("ahand");
  const tauri = isTauriApp();
  const [tab, setTab] = useState<DeviceTab>("overview");

  // Web shows only 3 tabs. Tauri sees the full set including per-device
  // browser setup and permission management, which are only meaningful on
  // a locally-installed device.
  const visibleTabs = useMemo<DeviceTab[]>(() => {
    if (tauri) {
      return ["overview", "browser", "permissions", "myDevices", "audit"];
    }
    return ["overview", "myDevices", "audit"];
  }, [tauri]);

  return (
    <main className="h-full flex flex-col overflow-hidden bg-background">
      <header className="px-6 pt-6 pb-4 border-b space-y-2 shrink-0">
        <h1 className="text-xl font-semibold">{t("myDevices")}</h1>
        <div className="space-y-2 text-sm text-muted-foreground max-w-3xl">
          <p>{t("myDevicesHelpIntro")}</p>
          <p>{t("myDevicesHelpAccess")}</p>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DeviceTab)}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="mx-6 mt-4 self-start shrink-0">
          {visibleTabs.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`devicesTabs.${key}` as const)}
            </TabsTrigger>
          ))}
        </TabsList>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-6 max-w-3xl">
            {visibleTabs.includes("overview") && (
              <TabsContent value="overview">
                <OverviewTab />
              </TabsContent>
            )}
            {visibleTabs.includes("browser") && (
              <TabsContent value="browser">
                <BrowserConfigTab />
              </TabsContent>
            )}
            {visibleTabs.includes("permissions") && (
              <TabsContent value="permissions">
                <PermissionsTab />
              </TabsContent>
            )}
            {visibleTabs.includes("myDevices") && (
              <TabsContent value="myDevices">
                <MyDevicesTab />
              </TabsContent>
            )}
            {visibleTabs.includes("audit") && (
              <TabsContent value="audit">
                <AuditLogTab />
              </TabsContent>
            )}
          </div>
        </ScrollArea>
      </Tabs>
    </main>
  );
}
