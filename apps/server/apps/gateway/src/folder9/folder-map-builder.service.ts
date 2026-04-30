import { BadRequestException, Injectable } from '@nestjs/common';
import { FolderMountResolver } from './folder-mount-resolver.service.js';
import { parseSessionShape } from './parse-session-shape.js';

/**
 * Inputs required to assemble a session's folder map.
 *
 * `sessionId` is the canonical team9 sessionId (`team9/{tenantId}/{agentId}/{scope}/{scopeId}`)
 * which is parsed for tenant + scope detection. `agentId` is duplicated
 * here because not every consumer wants to re-parse the sessionId, and
 * the parser is a private detail of this builder.
 *
 * `routineId` is only meaningful when the session shape is `routine` —
 * passing it for a dm/channel session is treated as a programmer error
 * and surfaces as a 400.
 *
 * `userId` is only meaningful for dm sessions; ignored otherwise.
 */
export interface FolderMapBuildContext {
  sessionId: string;
  agentId: string;
  routineId?: string;
  userId?: string;
}

export interface FolderMapEntry {
  workspaceId: string;
  folderId: string;
  folderType: 'light' | 'managed';
  permission: 'read' | 'propose' | 'write' | 'admin';
}

export interface FolderMapResponse {
  folderMap: Record<string, FolderMapEntry>;
}

/**
 * Mount-inclusion matrix per the workspace-mount integration spec:
 *
 *   logicalKey          | always | dm | channel | routine | topic
 *   --------------------|--------|----|---------|---------|------
 *   session.{tmp,home}  |   *    | *  |    *    |    *    |   *
 *   agent.{tmp,home}    |   *    | *  |    *    |    *    |   *
 *   routine.{tmp,home}  |        |    |         |    *    |
 *   user.{tmp,home}     |        | *  |         |         |
 *
 * `routine.document` is intentionally absent — that mount is owned by
 * the routine creation flow (it embeds the document folder into the
 * routine record at creation time) and is not re-issued through this
 * builder.
 *
 * For v1 every entry carries `permission: 'write'` regardless of
 * blueprint variant (Common/Personal/Base Model staff): the spec
 * spells out that DM peers, routine collaborators, and the workspace
 * owner all need write access at this stage. Refinement to per-actor
 * read/propose tiers is deferred to the authz follow-up.
 */
@Injectable()
export class FolderMapBuilder {
  constructor(private readonly resolver: FolderMountResolver) {}

  async buildFolderMap(ctx: FolderMapBuildContext): Promise<FolderMapResponse> {
    const shape = parseSessionShape(ctx.sessionId);
    if (shape.kind === 'unknown') {
      // Unparseable sessionId is a 400, not a 500 — the caller passed
      // us garbage. The token-issuance authz layer (Task 5) likewise
      // rejects unparseable ids with the same exception class.
      throw new BadRequestException(`Unparseable sessionId: ${ctx.sessionId}`);
    }
    if (ctx.agentId !== shape.agentId) {
      throw new BadRequestException(
        `agentId "${ctx.agentId}" does not match sessionId agent "${shape.agentId}"`,
      );
    }
    if (ctx.routineId !== undefined && shape.kind !== 'routine') {
      // Defensive cross-check: if the caller supplies a routineId, the
      // sessionId must actually be a routine session. Mismatches
      // (e.g. DM sessionId + routineId) would otherwise silently emit
      // a routine.* mount tied to an unrelated session.
      throw new BadRequestException(
        `routineId provided but sessionId scope is "${shape.kind}", expected "routine"`,
      );
    }

    const tenantId = shape.tenantId;
    const result: Record<string, FolderMapEntry> = {};

    /**
     * Resolve a single (logicalKey, mount tuple) pair via the resolver
     * and stitch the response into the result map. Hoisted into a
     * helper so the per-mount cases below stay declarative — every
     * mount looks identical aside from `logicalKey` + the resolver
     * args.
     */
    const provisionInto = async (
      logicalKey: string,
      args: Parameters<FolderMountResolver['provisionFolderForMount']>[0],
    ): Promise<void> => {
      const r = await this.resolver.provisionFolderForMount(args);
      result[logicalKey] = {
        workspaceId: tenantId,
        folderId: r.folder9FolderId,
        folderType: args.folderType,
        permission: 'write',
      };
    };

    // session.* and agent.* are unconditional for every shape.
    for (const mountKey of ['tmp', 'home'] as const) {
      await provisionInto(`session.${mountKey}`, {
        workspaceId: tenantId,
        scope: 'session',
        scopeId: ctx.sessionId,
        mountKey,
        folderType: 'light',
        ownerType: 'workspace',
        ownerId: tenantId,
      });
      await provisionInto(`agent.${mountKey}`, {
        workspaceId: tenantId,
        scope: 'agent',
        scopeId: ctx.agentId,
        mountKey,
        folderType: 'light',
        ownerType: 'agent',
        ownerId: ctx.agentId,
      });
    }

    // routine.{tmp,home} only when the caller asked for a routine
    // session AND the session itself is a routine (mismatch already
    // rejected above). routine.document is intentionally NOT emitted.
    if (ctx.routineId !== undefined && shape.kind === 'routine') {
      for (const mountKey of ['tmp', 'home'] as const) {
        await provisionInto(`routine.${mountKey}`, {
          workspaceId: tenantId,
          scope: 'routine',
          scopeId: ctx.routineId,
          mountKey,
          folderType: 'light',
          ownerType: 'agent',
          ownerId: ctx.agentId,
        });
      }
    }

    // user.{tmp,home} only for DM sessions where the caller passed a
    // userId — the DM peer is the implicit "user" the agent is talking
    // to, and channel/routine/topic sessions don't have a 1:1 peer.
    if (shape.kind === 'dm' && ctx.userId !== undefined) {
      for (const mountKey of ['tmp', 'home'] as const) {
        await provisionInto(`user.${mountKey}`, {
          workspaceId: tenantId,
          scope: 'user',
          scopeId: ctx.userId,
          mountKey,
          folderType: 'light',
          ownerType: 'workspace',
          ownerId: tenantId,
        });
      }
    }

    return { folderMap: result };
  }
}
