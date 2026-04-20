import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  VERSION_NEUTRAL,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';

/**
 * Shape of the folder9 webhook payload (see
 * `/Users/winrey/Projects/weightwave/folder9/internal/webhook/events.go`).
 *
 *   {
 *     "event":        "proposal.approved",
 *     "folder_id":    "<uuid>",
 *     "workspace_id": "<folder9 workspace id>",
 *     "data":         { ...event-specific fields... },
 *     "timestamp":    "2026-04-13T...Z"
 *   }
 *
 * The folder9 `workspace_id` is NOT the team9 workspace — we look up the
 * team9 workspace via the `workspace_wikis` allow-list keyed on `folder_id`.
 *
 * For resilience against minor payload variations the controller also
 * accepts event-specific fields (e.g. `proposal_id`, `ref`, `sha`) at the
 * top level — folder9's `data` shape is not strictly typed on the sender
 * side and the surface is small enough to handle both flat and nested.
 */
interface Folder9WebhookPayload {
  event?: unknown;
  folder_id?: unknown;
  workspace_id?: unknown;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Narrow contract the controller needs from the websocket gateway — keeps
 * this file decoupled from the full {@link WebsocketGateway} surface and
 * allows the Symbol-based provider injection to use a plain mock in tests.
 */
interface BroadcastingGateway {
  broadcastToWorkspace(
    workspaceId: string,
    event: string,
    data: unknown,
  ): Promise<void>;
}

// Event names sent by folder9 (source of truth:
// folder9/internal/webhook/events.go). Kept as a literal Set for O(1) lookup
// and to let the compiler discriminate between known and unknown events.
const PROPOSAL_CREATED = 'proposal.created';
const PROPOSAL_APPROVED = 'proposal.approved';
const PROPOSAL_REJECTED = 'proposal.rejected';
const REF_UPDATED = 'ref.updated';

/**
 * Receives HMAC-signed webhook events from folder9 and re-broadcasts the
 * relevant ones on the team9 WebSocket gateway, scoped to the wiki's
 * workspace room.
 *
 * Security model:
 *   * verifies `X-Folder9-Signature: sha256=<hex>` over the *raw* request
 *     bytes — we cannot trust a JSON.stringify round-trip since Go's and
 *     Node's serializers differ on key order, whitespace, and unicode
 *     escaping;
 *   * uses `timingSafeEqual` after length-matching to avoid short-circuit
 *     timing leaks;
 *   * performs the signature check *before* any DB lookup or business
 *     logic, so an attacker cannot probe the allow-list without a secret.
 *
 * The endpoint is deliberately public (no `@UseGuards`) because folder9
 * authenticates with the HMAC signature, not a team9 JWT.
 *
 * Important invariant: not every folder9 folder is a Wiki. Webhooks whose
 * `folder_id` has no matching row in `workspace_wikis` are logged at `warn`
 * and acknowledged with 200 OK — the event may belong to a folder9 folder
 * used for a different purpose. Returning 4xx would make folder9 retry or
 * disable the subscription.
 */
@Controller({ path: 'folder9', version: VERSION_NEUTRAL })
export class Folder9WebhookController {
  private readonly logger = new Logger(Folder9WebhookController.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly ws: BroadcastingGateway,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-folder9-signature') signature: string | undefined,
  ): Promise<void> {
    const secret = env.FOLDER9_WEBHOOK_SECRET;
    if (!secret) {
      // Misconfiguration — refuse to accept webhooks we can't verify,
      // otherwise an unauthenticated attacker could drive broadcasts.
      throw new HttpException(
        'FOLDER9_WEBHOOK_SECRET is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 1. Verify signature over the raw request bytes.
    if (!signature) {
      throw new HttpException(
        'missing X-Folder9-Signature',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      // rawBody is undefined when the body parser stripped it — either the
      // gateway was started without `rawBody: true` or the request had no
      // body. In either case we can't verify, so reject.
      throw new HttpException(
        'missing raw request body',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const expected =
      'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      provided.length !== expectedBuf.length ||
      !timingSafeEqual(provided, expectedBuf)
    ) {
      throw new HttpException(
        'invalid X-Folder9-Signature',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 2. Parse the body ourselves from the verified raw bytes — we do NOT
    //    use `@Body()` because that would force a second JSON parse and
    //    obscure the raw-vs-parsed boundary.
    let payload: Folder9WebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Folder9WebhookPayload;
    } catch {
      throw new HttpException('malformed JSON body', HttpStatus.BAD_REQUEST);
    }

    const event = typeof payload.event === 'string' ? payload.event : undefined;
    const folderId =
      typeof payload.folder_id === 'string' ? payload.folder_id : undefined;
    if (!folderId) {
      throw new HttpException(
        'missing folder_id in payload',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Short-circuit unknown event types *before* touching the database.
    if (
      event !== PROPOSAL_CREATED &&
      event !== PROPOSAL_APPROVED &&
      event !== PROPOSAL_REJECTED &&
      event !== REF_UPDATED
    ) {
      this.logger.debug(`ignored folder9 event ${String(event)}`);
      return;
    }

    // 4. Resolve the team9 wiki from the allow-list. Not every folder9
    //    folder is a Wiki — unknown folder_ids are logged and 200'd.
    const [wiki] = await this.db
      .select({
        id: schema.workspaceWikis.id,
        workspaceId: schema.workspaceWikis.workspaceId,
      })
      .from(schema.workspaceWikis)
      .where(eq(schema.workspaceWikis.folder9FolderId, folderId))
      .limit(1);

    if (!wiki) {
      this.logger.warn(
        `webhook for unknown folder9 folder ${folderId} (event=${event}) — ignoring`,
      );
      return;
    }

    // 5. Extract event-specific fields. Prefer the nested `data` object
    //    (the shape folder9 currently sends) but fall back to top-level
    //    keys so minor dispatcher changes don't silently drop the payload.
    const data =
      payload.data && typeof payload.data === 'object' ? payload.data : {};
    const pick = (key: string): string | undefined => {
      const fromData = data[key];
      if (typeof fromData === 'string') return fromData;
      const fromTop = payload[key];
      if (typeof fromTop === 'string') return fromTop;
      return undefined;
    };

    switch (event) {
      case PROPOSAL_CREATED:
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          'wiki_proposal_created',
          {
            wikiId: wiki.id,
            proposalId: pick('proposal_id'),
            authorId: pick('author_id'),
          },
        );
        return;
      case PROPOSAL_APPROVED:
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          'wiki_proposal_approved',
          {
            wikiId: wiki.id,
            proposalId: pick('proposal_id'),
          },
        );
        return;
      case PROPOSAL_REJECTED:
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          'wiki_proposal_rejected',
          {
            wikiId: wiki.id,
            proposalId: pick('proposal_id'),
          },
        );
        return;
      case REF_UPDATED:
        await this.ws.broadcastToWorkspace(
          wiki.workspaceId,
          'wiki_page_updated',
          {
            wikiId: wiki.id,
            ref: pick('ref'),
            sha: pick('sha'),
          },
        );
        return;
    }
  }
}
