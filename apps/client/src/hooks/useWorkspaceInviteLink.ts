import { useMemo } from "react";
import {
  useWorkspaceInvitations,
  useCreateInvitation,
} from "@/hooks/useWorkspace";
import { useEffectOncePerKey } from "@/hooks/useEffectOncePerKey";
import type { WorkspaceInvitation } from "@/types/workspace";

const DEFAULT_INVITATION_OPTIONS = {
  role: "member" as const,
  maxUses: 1000,
  expiresInDays: 100,
};

function isInvitationUsable(inv: WorkspaceInvitation): boolean {
  if (!inv.isActive) return false;
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) return false;
  if (inv.maxUses && inv.usedCount >= inv.maxUses) return false;
  return true;
}

interface UseWorkspaceInviteLinkResult {
  /** Shareable invite URL, or undefined while loading/creating. */
  url: string | undefined;
  /** True while fetching existing invitations or creating the default one. */
  isLoading: boolean;
}

/**
 * Resolves a usable workspace invite link, lazily creating a default
 * invitation when none exists yet. Shared by the workspace invite dialog
 * and the channel "add members" dialog.
 *
 * @param enabled - when false, no fetch/auto-create is performed (e.g. dialog closed)
 */
export function useWorkspaceInviteLink(
  workspaceId: string | undefined,
  enabled = true,
): UseWorkspaceInviteLinkResult {
  const { data: invitations = [], isLoading: isLoadingInvitations } =
    useWorkspaceInvitations(enabled ? workspaceId : undefined);
  const createInvitation = useCreateInvitation(workspaceId);

  const validInvitation = useMemo(
    () => invitations.find(isInvitationUsable),
    [invitations],
  );

  useEffectOncePerKey(
    workspaceId,
    Boolean(enabled && workspaceId) &&
      !isLoadingInvitations &&
      !validInvitation,
    () => {
      createInvitation.mutate({ ...DEFAULT_INVITATION_OPTIONS });
    },
  );

  return {
    url: validInvitation?.url,
    isLoading: isLoadingInvitations || createInvitation.isPending,
  };
}
