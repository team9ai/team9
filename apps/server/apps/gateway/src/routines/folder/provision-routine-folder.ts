/**
 * Shared folder9 provisioning helper for routine → SKILL.md folders.
 *
 * Used by atomic routine creation (A.4), lazy provision (A.3), and the
 * Layer 1 batch migration script (A.9). Composes a deterministic SKILL.md
 * with frontmatter from a routine row and pushes it as the initial commit
 * of a freshly-created managed folder9 folder.
 *
 * # Design notes
 *
 * - **Pure function, no NestJS DI.** Callers (which ARE NestJS services)
 *   pass dependencies via the `deps` argument so this helper stays trivially
 *   testable and re-usable from a CLI batch script.
 *
 * - **Folder9 client signature drift from plan pseudocode.** The plan's
 *   pseudocode shows `commit(wsId, folderId, body, psk)`. The real
 *   {@link import('../../wikis/folder9-client.service.js').Folder9ClientService}
 *   `commit` requires a folder-scoped opaque token (NOT the PSK) — the PSK
 *   is only valid on folder-management endpoints (createFolder/createToken).
 *   So this helper:
 *     1. Calls `createFolder` (PSK auth, handled internally by the client).
 *     2. Mints a one-shot write token via `createToken` (PSK auth, internal).
 *     3. Calls `commit` with the minted token.
 *   The `psk` field on {@link ProvisionRoutineFolderDeps} is retained as part
 *   of the public contract spelled out in the design doc but is currently
 *   unused — the underlying folder9 client reads `FOLDER9_PSK` from the
 *   process env. We keep the field so consumers compile-check against a
 *   stable shape if/when the client ever takes an explicit PSK.
 *
 * - **Failure mode.** Any folder9 step (createFolder / createToken / commit)
 *   that throws bubbles unchanged. Callers decide rollback semantics:
 *     - Atomic create (A.4) rolls back the routine DB transaction.
 *     - Lazy provision (A.3) re-raises as 503.
 *     - Batch migration (A.9) records a per-row warning and continues.
 *
 * - **Slug.** `slugifyUuid("7f3a2b1c-1111-2222-3333-444455556666")` →
 *   `"7f3a2b1c-1111"`. Matches the §"Cross-repo slug consistency" rule in
 *   the design doc — readable in folder names without leaking the full UUID
 *   while keeping enough entropy to avoid trivial collisions.
 */

import type { Folder9ClientService } from '../../wikis/folder9-client.service.js';

/**
 * Structural shape of a routine row passed to the provisioner.
 *
 * `documentContent` is a VIRTUAL field (assembled in-memory by
 * routine-bot.service.ts, NOT a column on the routines table). We accept it
 * here so legacy migrations and in-memory creation flows can both feed the
 * same helper. After A.9 sunsets the virtual field, callers should pass `null`.
 */
export interface RoutineLike {
  id: string;
  title: string;
  description: string | null;
  documentContent: string | null;
}

/**
 * Subset of {@link Folder9ClientService} this helper relies on. Defining the
 * dep as a `Pick<>` (rather than a hand-rolled interface) means any signature
 * change in the real client surfaces here at compile time.
 */
export type ProvisionRoutineFolder9Client = Pick<
  Folder9ClientService,
  'createFolder' | 'createToken' | 'commit'
>;

export interface ProvisionRoutineFolderDeps {
  folder9Client: ProvisionRoutineFolder9Client;
  workspaceId: string;
  /**
   * Pre-shared key for folder9 management endpoints. Currently unused: the
   * underlying {@link Folder9ClientService} reads `FOLDER9_PSK` from the
   * process env. Field is kept for forward-compatibility with the design
   * doc's deps contract — see file header.
   */
  psk: string;
}

/**
 * Take the first two segments of a UUID for a human-readable slug.
 *
 * Example: `slugifyUuid("7f3a2b1c-1111-2222-3333-444455556666")` →
 * `"7f3a2b1c-1111"`.
 *
 * Exported so downstream consumers (e.g. `validateSkillMd` in A.5) can
 * derive the same expected `routine-<slug>` value without redefining the
 * algorithm. Keeping a single source of truth means a slug-format change
 * (should we ever decide to widen it) only has to be made here.
 */
export function slugifyUuid(id: string): string {
  return id.split('-').slice(0, 2).join('-');
}

/**
 * Normalize a frontmatter description value: collapse newlines into spaces
 * (frontmatter values must be a single line) and trim surrounding whitespace.
 * No further escaping — descriptions are not user-controlled enough to need
 * YAML-quoted output, and existing folder9 SKILL.md frontmatter conventions
 * use plain unquoted scalars.
 */
function normalizeDescription(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

/**
 * Build the SKILL.md text. Hand-constructed (no `gray-matter` dep) — the
 * shape is fixed and the values are normalized upstream.
 */
function composeSkillMd(args: {
  routineId: string;
  description: string;
  body: string;
}): string {
  const slug = slugifyUuid(args.routineId);
  return [
    '---',
    `name: routine-${slug}`,
    `description: ${args.description}`,
    '---',
    '',
    args.body,
  ].join('\n');
}

/**
 * Provision a folder9 managed folder for a routine and seed it with SKILL.md.
 *
 * @returns the new folder's id. Caller is responsible for persisting it onto
 * `routines.folder_id`.
 *
 * @throws whatever the underlying folder9 client throws — typically
 * `Folder9ApiError` (non-2xx) or `Folder9NetworkError` (timeout/DNS).
 */
export async function provisionFolder9SkillFolder(
  routine: RoutineLike,
  deps: ProvisionRoutineFolderDeps,
): Promise<{ folderId: string }> {
  const { folder9Client, workspaceId } = deps;
  const slug = slugifyUuid(routine.id);

  // Step 1 — create the managed folder. PSK auth is handled inside the
  // folder9 client (it reads FOLDER9_PSK from env).
  const folder = await folder9Client.createFolder(workspaceId, {
    name: `routine-${slug}`,
    type: 'managed',
    owner_type: 'workspace',
    owner_id: workspaceId,
    approval_mode: 'auto',
  });

  // Step 2 — mint a short-lived write token for the just-created folder.
  // folder9 requires a folder-scoped token for /commit (PSK is rejected on
  // file/proposal endpoints, see folder9-client.service.ts header).
  //
  // `created_by` follows the wiki pattern (`wiki:<folderId>`) but namespaced
  // for routines so observability/audit trails can tell the two apart. The
  // routine id (full UUID, not slug) is embedded so a leaked token entry can
  // be traced back to the originating routine.
  // 15-minute TTL — the token is consumed by the immediately-following commit
  // call, so a tight expiry caps the leak window if commit fails partway.
  const tokenResp = await folder9Client.createToken({
    folder_id: folder.id,
    permission: 'write',
    name: 'routine-provision',
    created_by: `routine:${routine.id}`,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });

  // Step 3 — compose SKILL.md and commit it as the seed of the folder.
  // Fallback fires whenever the description is null OR whitespace-only after
  // newlines collapse — both cases produce no useful frontmatter content.
  //
  // Fallback policy: use a dash-separated form (no `: `) so the YAML
  // parser at validation time treats the value as a plain unquoted
  // scalar. A colon followed by space inside an unquoted scalar
  // triggers `Nested mappings are not allowed in compact mappings`,
  // which would fail validateSkillMd before the agent can even read
  // the file. routines.service.ts#completeCreation uses the same
  // string when computing `expectedDescription` for the
  // mismatch-comparison — keep both call sites in sync if you ever
  // change this format.
  const normalized = normalizeDescription(routine.description ?? '');
  const description = normalized
    ? normalized
    : normalizeDescription(`Generated from routine - ${routine.title}`);

  const body = routine.documentContent ?? '';
  const skillMd = composeSkillMd({
    routineId: routine.id,
    description,
    body,
  });

  const message = body.trim()
    ? `Migrate routine ${slug} documentContent to SKILL.md`
    : `Initial scaffold for routine ${slug}`;

  await folder9Client.commit(workspaceId, folder.id, tokenResp.token, {
    message,
    files: [
      {
        path: 'SKILL.md',
        action: 'create',
        content: skillMd,
        encoding: 'text',
      },
    ],
  });

  return { folderId: folder.id };
}
