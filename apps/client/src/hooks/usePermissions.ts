import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import permissionsApi, {
  type DecidePermissionInput,
  type PermissionGrant,
  type PermissionRequest,
  type GrantsQuery,
} from "@/services/api/permissions";

export type { PermissionRequest, PermissionGrant };

// ── Query Keys ───────────────────────────────────────────────────────────────

export const permissionKeys = {
  all: ["permissions"] as const,
  requests: (params?: Record<string, string>) =>
    params
      ? (["permissions", "requests", params] as const)
      : (["permissions", "requests"] as const),
  grants: (params?: GrantsQuery) =>
    params
      ? (["permissions", "grants", params] as const)
      : (["permissions", "grants"] as const),
};

// ── Pending permission requests (admin / owner view) ─────────────────────────

/**
 * Fetches the caller's pending permission requests
 * (requests addressed to the current workspace owner / admin).
 */
export function usePendingPermissionRequests() {
  return useQuery<PermissionRequest[]>({
    queryKey: permissionKeys.requests({ status: "pending", scope: "mine" }),
    queryFn: () =>
      permissionsApi.listRequests({ status: "pending", scope: "mine" }),
  });
}

// ── Decide on a permission request ───────────────────────────────────────────

export function useDecidePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DecidePermissionInput) =>
      permissionsApi.decideRequest(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: permissionKeys.requests() });
      qc.invalidateQueries({ queryKey: permissionKeys.grants() });
    },
  });
}

// ── Grants ────────────────────────────────────────────────────────────────────

/**
 * Fetches active grants for a given subject (e.g. an agent or session).
 */
export function useGrants(input: GrantsQuery) {
  return useQuery<PermissionGrant[]>({
    queryKey: permissionKeys.grants(input),
    queryFn: () => permissionsApi.listGrants(input),
  });
}

export function useCreateGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      body: Omit<PermissionGrant, "id" | "revokedAt" | "createdAt">,
    ) => permissionsApi.createGrant(body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: permissionKeys.grants() }),
  });
}

export function useRevokeGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => permissionsApi.revokeGrant(grantId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: permissionKeys.grants() }),
  });
}
