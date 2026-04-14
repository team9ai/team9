import { useMemo } from "react";
import { ChannelDetailsModal } from "./ChannelDetailsModal";
import { useChannelMembers } from "@/hooks/useChannels";
import { useUser, useChannelSettingsStore } from "@/stores";
import type { MemberRole } from "@/types/im";

/**
 * Global mount for ChannelDetailsModal driven by the channel settings store.
 * Allows any component anywhere in the tree to open the modal via
 * `useChannelSettingsStore.getState().openChannelSettings(channelId, tab)`
 * without plumbing callbacks through the component tree.
 */
export function ChannelSettingsMount() {
  const isOpen = useChannelSettingsStore((s) => s.isOpen);
  const channelId = useChannelSettingsStore((s) => s.channelId);
  const defaultTab = useChannelSettingsStore((s) => s.defaultTab);
  const closeChannelSettings = useChannelSettingsStore(
    (s) => s.closeChannelSettings,
  );

  const currentUser = useUser();
  const { data: members = [] } = useChannelMembers(
    isOpen && channelId ? channelId : undefined,
  );

  const currentUserRole = useMemo<MemberRole>(() => {
    if (!currentUser) return "member";
    const self = members.find((m) => m.userId === currentUser.id);
    return (self?.role as MemberRole | undefined) ?? "member";
  }, [members, currentUser]);

  if (!channelId) return null;

  return (
    <ChannelDetailsModal
      isOpen={isOpen}
      onClose={closeChannelSettings}
      channelId={channelId}
      currentUserRole={currentUserRole}
      defaultTab={defaultTab}
    />
  );
}
