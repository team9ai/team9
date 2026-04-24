import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{t("myDevices")}</h1>
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
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DeviceTab)}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="mx-6 mt-4 self-start">
          {visibleTabs.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`devicesTabs.${key}` as const)}
            </TabsTrigger>
          ))}
        </TabsList>

        <ScrollArea className="flex-1">
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
    </div>
  );
}
