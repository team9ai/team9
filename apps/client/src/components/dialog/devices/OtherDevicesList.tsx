import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatRelative } from "@/lib/date-format";
import {
  useAhandDevices,
  AHAND_DEVICES_QUERY_KEY,
} from "@/hooks/useAhandDevices";
import { useAhandStore, type UserAhandState } from "@/stores/useAhandStore";
import { useUser } from "@/stores/useAppStore";
import { ahandApi, type DeviceDto } from "@/services/ahand-api";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Check, X } from "lucide-react";

export function OtherDevicesList({ excludeLocal }: { excludeLocal: boolean }) {
  const { t } = useTranslation("ahand");
  const { data, isLoading } = useAhandDevices({ includeOffline: true });
  const currentUser = useUser();
  const localId = useAhandStore(
    (s: { usersEnabled: Record<string, UserAhandState> }) =>
      currentUser ? s.getDeviceIdForUser(currentUser.id) : null,
  );
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
          <DeviceRow key={d.id} device={d} onRemove={handleRemove} />
        ))}
      </ul>
    </section>
  );
}

function DeviceRow({
  device,
  onRemove,
}: {
  device: DeviceDto;
  onRemove: (d: DeviceDto) => Promise<void>;
}) {
  const { t } = useTranslation("ahand");
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.nickname);
  const [saving, setSaving] = useState(false);

  async function handleSaveNickname() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === device.nickname) {
      setEditing(false);
      setDraft(device.nickname);
      return;
    }
    setSaving(true);
    // Optimistic update across all cache variants (includeOffline: true and false)
    const patchCache = (nickname: string) =>
      qc.setQueriesData<DeviceDto[]>(
        { queryKey: AHAND_DEVICES_QUERY_KEY },
        (old) => old?.map((d) => (d.id === device.id ? { ...d, nickname } : d)),
      );
    patchCache(trimmed);
    try {
      await ahandApi.patch(device.id, { nickname: trimmed });
      setEditing(false);
    } catch (e: unknown) {
      // Rollback all cache variants
      patchCache(device.nickname);
      setDraft(device.nickname);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("error.nicknameSaveFailed", { msg }));
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    setEditing(false);
    setDraft(device.nickname);
  }

  return (
    <li className="flex items-center justify-between p-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div
          className={`shrink-0 w-2.5 h-2.5 rounded-full ${device.isOnline ? "bg-green-500" : "bg-muted-foreground"}`}
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveNickname();
                  if (e.key === "Escape") handleCancelEdit();
                }}
                className="h-6 text-sm py-0 px-1"
                disabled={saving}
                autoFocus
              />
              <button
                onClick={() => void handleSaveNickname()}
                disabled={saving}
                className="text-green-600 hover:text-green-700 disabled:opacity-50"
                aria-label="Save"
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group">
              <span className="text-sm font-medium truncate">
                {device.nickname}
              </span>
              <button
                onClick={() => {
                  setDraft(device.nickname);
                  setEditing(true);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                aria-label="Edit nickname"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {device.platform} ·{" "}
            {device.lastSeenAt
              ? t("lastSeen", {
                  when: formatRelative(new Date(device.lastSeenAt)),
                })
              : t("neverSeen")}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void onRemove(device)}
        className="shrink-0 ml-2"
      >
        {t("remove")}
      </Button>
    </li>
  );
}
