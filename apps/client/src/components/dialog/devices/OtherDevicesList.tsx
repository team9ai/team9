import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatRelative } from "@/lib/date-format";
import {
  useAhandDevices,
  AHAND_DEVICES_QUERY_KEY,
} from "@/hooks/useAhandDevices";
import { useAhandStore } from "@/stores/useAhandStore";
import { useUser } from "@/stores/useAppStore";
import { ahandApi, type DeviceDto } from "@/services/ahand-api";
import { useQueryClient } from "@tanstack/react-query";

export function OtherDevicesList({ excludeLocal }: { excludeLocal: boolean }) {
  const { t } = useTranslation("ahand");
  const { data, isLoading } = useAhandDevices({ includeOffline: true });
  const currentUser = useUser();
  const localId = currentUser
    ? useAhandStore.getState().getDeviceIdForUser(currentUser.id)
    : null;
  const qc = useQueryClient();

  if (isLoading) {
    return (
      <section>
        <Skeleton className="h-16" />
      </section>
    );
  }

  const devices = (data ?? []).filter((d) =>
    excludeLocal ? d.hubDeviceId !== localId : true,
  );

  if (devices.length === 0) return null;

  async function handleRemove(device: DeviceDto): Promise<void> {
    if (!window.confirm(t("confirmRemove", { name: device.nickname }))) return;
    try {
      await ahandApi.remove(device.id);
      qc.invalidateQueries({ queryKey: AHAND_DEVICES_QUERY_KEY });
      toast.success(t("removed", { name: device.nickname }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("error.removeFailed", { msg }));
    }
  }

  return (
    <section>
      <h3 className="text-sm font-medium mb-2">
        {t("otherDevices", { count: devices.length })}
      </h3>
      <ul className="border rounded-lg divide-y">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-2.5 h-2.5 rounded-full ${d.isOnline ? "bg-green-500" : "bg-muted-foreground"}`}
              />
              <div>
                <div className="text-sm font-medium">{d.nickname}</div>
                <div className="text-xs text-muted-foreground">
                  {d.platform} ·{" "}
                  {d.lastSeenAt
                    ? t("lastSeen", {
                        when: formatRelative(new Date(d.lastSeenAt)),
                      })
                    : t("neverSeen")}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => handleRemove(d)}>
              {t("remove")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
