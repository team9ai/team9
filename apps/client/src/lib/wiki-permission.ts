import type { WikiDto, WikiPermissionLevel } from "@/types/wiki";

/**
 * The helper accepts any object and looks for either `userType` or `type`
 * at runtime. We deliberately keep the static type open (`object`) so the
 * auth-layer `User` DTO (which lacks `userType` today because login only
 * admits humans) can be passed in without a cast. The implementation
 * guards every field access with a type check before using it.
 *
 * `type` is the legacy shorthand used by the original plan snippet; we
 * accept both `type` and `userType` so callers don't have to translate.
 */
export type WikiPermissionUser = object;

function readStringField(
  user: WikiPermissionUser,
  field: "userType" | "type",
): string | undefined {
  const value = (user as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolve the editing permission the current user has against the given
 * wiki.
 *
 * - No user (not signed in) → always `"read"`. The fetch should have
 *   redirected to login by now, but the Wiki shell still renders previews
 *   for some flows (e.g. quick-look over a shared permalink), so we fall
 *   safely back to read-only.
 * - Agent / bot users → `wiki.agentPermission`. We lump `"bot"` together
 *   with `"agent"` because the server treats hive daemons and general bot
 *   accounts identically for review gating. `"system"` (auto-populated
 *   users like the audit author) is treated as an agent for the same
 *   reason — a system actor shouldn't get write through the human rule.
 * - Everything else (the common case — a signed-in human) →
 *   `wiki.humanPermission`.
 */
export function resolveClientPermission(
  wiki: WikiDto,
  user: WikiPermissionUser | null | undefined,
): WikiPermissionLevel {
  if (!user) return "read";
  const t = readStringField(user, "userType") ?? readStringField(user, "type");
  const isAgent = t === "agent" || t === "bot" || t === "system";
  return isAgent ? wiki.agentPermission : wiki.humanPermission;
}
