import { useEffect } from "react";
import { useUser } from "@/stores/useAppStore";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { useTeam9PostHog } from "./provider";

let lastIdentifiedUserId: string | null = null;
let lastGroupedWorkspaceId: string | null = null;

function clearIdentitySyncState() {
  lastIdentifiedUserId = null;
  lastGroupedWorkspaceId = null;
}

export function Team9PostHogIdentitySync() {
  const { client, enabled, ready } = useTeam9PostHog();
  const user = useUser();
  const workspaceId = useSelectedWorkspaceId();

  useEffect(() => {
    if (!enabled || !ready || !client) {
      return;
    }

    const hasAuthToken =
      typeof window !== "undefined" &&
      Boolean(window.localStorage.getItem("auth_token"));

    if (!hasAuthToken || !user) {
      if (lastIdentifiedUserId !== null || lastGroupedWorkspaceId !== null) {
        client.reset();
        clearIdentitySyncState();
      }
      return;
    }

    if (lastIdentifiedUserId === user.id) {
      return;
    }

    client.identify(user.id, {
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });

    lastIdentifiedUserId = user.id;
    lastGroupedWorkspaceId = null;
  }, [
    client,
    enabled,
    ready,
    user?.avatarUrl,
    user?.createdAt,
    user?.email,
    user?.id,
    user?.name,
    user,
  ]);

  useEffect(() => {
    if (!enabled || !ready || !client) {
      return;
    }

    const hasAuthToken =
      typeof window !== "undefined" &&
      Boolean(window.localStorage.getItem("auth_token"));

    if (!hasAuthToken || !user) {
      lastGroupedWorkspaceId = null;
      return;
    }

    if (!workspaceId) {
      lastGroupedWorkspaceId = null;
      return;
    }

    if (lastGroupedWorkspaceId === workspaceId) {
      return;
    }

    client.group("workspace", workspaceId);
    lastGroupedWorkspaceId = workspaceId;
  }, [client, enabled, ready, user, workspaceId]);

  return null;
}
