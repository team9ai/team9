/**
 * Lazy-provision invariant for `routines.folder_id` (task-worker side).
 *
 * Mirror of the gateway helper in
 * `apps/server/apps/gateway/src/routines/folder/ensure-routine-folder.ts`.
 * The task-worker keeps its own copy because it's a separate deploy unit
 * and intentionally does not depend on the gateway package.
 *
 * # Invariant
 *
 * After this function returns successfully, the routine row's `folder_id`
 * is non-null. Callers can treat `routine.folderId` as non-nullable.
 *
 * # Concurrency model
 *
 * Two callers racing on the same routine MUST not double-provision. The
 * function opens a DB transaction and issues `SELECT ... FOR UPDATE` on the
 * routine row, serializing the critical section.
 *
 * # Failure modes
 *
 * - **Routine not found** → throws `Error("routine <id> not found")`.
 *   The transaction rolls back; nothing is persisted.
 * - **Provision throws** → re-thrown as-is. The transaction rolls back so
 *   `folder_id` stays NULL and the next call self-heals on retry. The
 *   caller (executor.service) catches and marks the execution as failed.
 *
 * Unlike the gateway helper, this version does NOT rewrite errors to
 * `ServiceUnavailableException` — task-worker has no HTTP response surface,
 * so the executor handles the error directly.
 */

import { Logger } from '@nestjs/common';
import { eq, type PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';

import {
  provisionFolder9SkillFolder,
  type ProvisionRoutineFolderDeps,
} from './provision-routine-folder.js';

const logger = new Logger('ensureRoutineFolder');

export type RoutineRow = typeof schema.routines.$inferSelect;

export interface EnsureRoutineFolderDeps {
  db: PostgresJsDatabase<typeof schema>;
  provisionDeps: ProvisionRoutineFolderDeps;
  /**
   * Override for the provision function. Tests pass a spy here; production
   * callers omit it (defaults to {@link provisionFolder9SkillFolder}).
   */
  provision?: typeof provisionFolder9SkillFolder;
}

/**
 * Ensure the routine has a non-null `folder_id`, provisioning lazily if
 * needed. Returns the routine row with `folderId` guaranteed non-null.
 */
export async function ensureRoutineFolder(
  routineId: string,
  deps: EnsureRoutineFolderDeps,
): Promise<RoutineRow> {
  const provisionFn = deps.provision ?? provisionFolder9SkillFolder;

  return await deps.db.transaction(async (tx) => {
    const [row] = (await tx
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .for('update')) as RoutineRow[];

    if (!row) {
      throw new Error(`routine ${routineId} not found`);
    }

    // Fast path — already provisioned.
    if (row.folderId) {
      return row;
    }

    // Slow path — first access. The routines table no longer carries
    // `documentContent`, so we pass `null` — the helper falls back to its
    // initial-scaffold commit message and an empty SKILL.md body.
    let provisioned: { folderId: string };
    try {
      provisioned = await provisionFn(
        {
          id: row.id,
          title: row.title,
          description: row.description,
          documentContent: null,
        },
        deps.provisionDeps,
      );
    } catch (err) {
      logger.warn(
        `provision failed for routine ${routineId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Re-throw as-is. Caller marks the execution as failed.
      throw err;
    }

    await tx
      .update(schema.routines)
      .set({ folderId: provisioned.folderId, updatedAt: new Date() })
      .where(eq(schema.routines.id, routineId));

    return { ...row, folderId: provisioned.folderId };
  });
}
