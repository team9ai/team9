import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ahandApi, type DeviceDto } from "@/services/ahand-api";
import wsService from "@/services/websocket";
import { useUser } from "@/stores/useAppStore";

export const AHAND_DEVICES_QUERY_KEY = ["ahand", "devices"] as const;

export function useAhandDevices(opts: { includeOffline?: boolean } = {}) {
  const currentUser = useUser();
  const qc = useQueryClient();
  const includeOffline = opts.includeOffline ?? true;

  const query = useQuery({
    queryKey: [...AHAND_DEVICES_QUERY_KEY, includeOffline],
    queryFn: () => ahandApi.list({ includeOffline }),
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!currentUser) return;

    const room = `user:${currentUser.id}:ahand`;
    wsService.joinAhandRoom(room);

    // Re-join the room after reconnect — Socket.io rooms don't survive
    // socket replacement (which happens on auth recovery and reconnects).
    const offConnectionChange = wsService.onConnectionChange((status) => {
      if (status === "connected") {
        wsService.joinAhandRoom(room);
      }
    });

    const onUpdate = (patch: Partial<DeviceDto> & { hubDeviceId: string }) => {
      qc.setQueryData<DeviceDto[]>(
        [...AHAND_DEVICES_QUERY_KEY, includeOffline],
        (old) =>
          old
            ? old.map((d) =>
                d.hubDeviceId === patch.hubDeviceId ? { ...d, ...patch } : d,
              )
            : old,
      );
    };

    const onRegistered = () =>
      qc.invalidateQueries({ queryKey: AHAND_DEVICES_QUERY_KEY });

    const onRevoked = (evt: { hubDeviceId: string }) => {
      qc.setQueryData<DeviceDto[]>(
        [...AHAND_DEVICES_QUERY_KEY, includeOffline],
        (old) => old?.filter((d) => d.hubDeviceId !== evt.hubDeviceId),
      );
    };

    const onOnline = (evt: { hubDeviceId: string }) =>
      onUpdate({ hubDeviceId: evt.hubDeviceId, isOnline: true });

    const onOffline = (evt: { hubDeviceId: string }) =>
      onUpdate({ hubDeviceId: evt.hubDeviceId, isOnline: false });

    const onReconnect = () =>
      qc.invalidateQueries({ queryKey: AHAND_DEVICES_QUERY_KEY });

    wsService.on("device.online", onOnline);
    wsService.on("device.offline", onOffline);
    wsService.on("device.revoked", onRevoked);
    wsService.on("device.registered", onRegistered);
    wsService.on("reconnect", onReconnect);

    return () => {
      offConnectionChange();
      wsService.leaveAhandRoom(room);
      wsService.off("device.online", onOnline);
      wsService.off("device.offline", onOffline);
      wsService.off("device.revoked", onRevoked);
      wsService.off("device.registered", onRegistered);
      wsService.off("reconnect", onReconnect);
    };
  }, [currentUser, qc, includeOffline]);

  return query;
}

export function invalidateAhandDevices(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: AHAND_DEVICES_QUERY_KEY });
}
