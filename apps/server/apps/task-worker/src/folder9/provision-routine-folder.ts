/**
 * Routine folder9 provisioning helper for the task-worker.
 *
 * Mirror of the gateway helper in
 * `apps/server/apps/gateway/src/routines/folder/provision-routine-folder.ts`.
 * The task-worker keeps its own copy because it's a separate deploy unit
 * and intentionally does not depend on the gateway package. Behaviour MUST
 * stay aligned: both call sites share the same SKILL.md scaffold contract.
 *
 * Composes a deterministic SKILL.md with frontmatter from a routine row and
 * pushes it as the initial commit of a freshly-created managed folder.
 */

import type { Folder9Client } from './folder9.client.js';

/** Subset of the routines table the helper reads. */
export interface RoutineLike {
  id: string;
  title: string;
  description: string | null;
  documentContent: string | null;
}

export type ProvisionRoutineFolder9Client = Pick<
  Folder9Client,
  'createFolder' | 'createToken' | 'commit'
>;

export interface ProvisionRoutineFolderDeps {
  folder9Client: ProvisionRoutineFolder9Client;
  workspaceId: string;
  /**
   * PSK is currently unused — the underlying {@link Folder9Client} reads
   * `FOLDER9_PSK` from process.env directly. Field is kept to mirror the
   * gateway helper signature.
   */
  psk: string;
}

/**
 * First two segments of a UUID, used as the human-readable folder name slug.
 * Example: `slugifyUuid("7f3a2b1c-1111-2222-3333-444455556666")` →
 * `"7f3a2b1c-1111"`.
 */
export function slugifyUuid(id: string): string {
  return id.split('-').slice(0, 2).join('-');
}

function normalizeDescription(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

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
 * @returns the new folder's id. Caller persists it onto `routines.folder_id`.
 */
export async function provisionFolder9SkillFolder(
  routine: RoutineLike,
  deps: ProvisionRoutineFolderDeps,
): Promise<{ folderId: string }> {
  const { folder9Client, workspaceId } = deps;
  const slug = slugifyUuid(routine.id);

  // Step 1 — create the managed folder. PSK auth handled inside the client.
  const folder = await folder9Client.createFolder(workspaceId, {
    name: `routine-${slug}`,
    type: 'managed',
    owner_type: 'workspace',
    owner_id: workspaceId,
    approval_mode: 'auto',
  });

  // Step 2 — mint a short-lived write token for /commit (PSK is rejected on
  // file/proposal endpoints). 15-minute TTL caps the leak window if commit
  // fails partway.
  const tokenResp = await folder9Client.createToken({
    folder_id: folder.id,
    permission: 'write',
    name: 'routine-provision',
    created_by: `routine:${routine.id}`,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });

  // Step 3 — compose SKILL.md and commit it as the seed of the folder.
  const normalized = normalizeDescription(routine.description ?? '');
  const description = normalized
    ? normalized
    : normalizeDescription(`Generated from routine: ${routine.title}`);

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
