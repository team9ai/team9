import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  PATH_METADATA,
  METHOD_METADATA,
  HTTP_CODE_METADATA,
  GUARDS_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod, VERSION_NEUTRAL } from '@nestjs/common';

import { Folder9WebhookController } from '../folder9-webhook.controller.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

// ─── Helpers ────────────────────────────────────────────────────────────
const SECRET = 'whsec-test';
const FOLDER_ID = '00000000-0000-0000-0000-000000000001';
const WIKI_ID = 'wiki-1';
const WORKSPACE_ID = 'ws-1';
const PROPOSAL_ID = 'p-1';

function sign(raw: Buffer, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
}

function makeRawReq(body: Record<string, unknown>): {
  raw: Buffer;
  req: RawBodyRequest<Request>;
} {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const req = { rawBody: raw } as RawBodyRequest<Request>;
  return { raw, req };
}

// A thin drizzle select-chain mock — the controller calls
// `db.select().from(schema.workspaceWikis).where(eq(...)).limit(1)`.
function makeDbMock(wikiRow: unknown) {
  const limit = jest.fn<any>().mockResolvedValue(wikiRow ? [wikiRow] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return {
    // Exposed so tests can overwrite the terminal `.limit` mock.
    select,
    from,
    where,
    limit,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Folder9WebhookController', () => {
  const ORIGINAL_SECRET = process.env.FOLDER9_WEBHOOK_SECRET;
  let ws: { broadcastToWorkspace: MockFn };
  let db: ReturnType<typeof makeDbMock>;
  let controller: Folder9WebhookController;

  beforeEach(() => {
    process.env.FOLDER9_WEBHOOK_SECRET = SECRET;
    ws = { broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined) };
    db = makeDbMock({
      id: WIKI_ID,
      workspaceId: WORKSPACE_ID,
      folder9FolderId: FOLDER_ID,
    });
    controller = new Folder9WebhookController(db as never, ws as never);
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.FOLDER9_WEBHOOK_SECRET;
    } else {
      process.env.FOLDER9_WEBHOOK_SECRET = ORIGINAL_SECRET;
    }
    jest.restoreAllMocks();
  });

  // ── Routing metadata ──────────────────────────────────────────────────

  describe('controller metadata', () => {
    it('mounts at /folder9 with VERSION_NEUTRAL (full path /api/folder9)', () => {
      const path = Reflect.getMetadata(PATH_METADATA, Folder9WebhookController);
      expect(path).toBe('folder9');
      const version = Reflect.getMetadata(
        VERSION_METADATA,
        Folder9WebhookController,
      );
      expect(version).toBe(VERSION_NEUTRAL);
    });

    it('has no class-level UseGuards (folder9 is an external caller, not a JWT user)', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        Folder9WebhookController,
      );
      expect(guards ?? []).toHaveLength(0);
    });

    it('registers POST /webhook that responds 200 OK', () => {
      const handler = controller.receive as unknown as (
        ...args: unknown[]
      ) => unknown;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('webhook');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        RequestMethod.POST,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    });
  });

  // ── Configuration errors ──────────────────────────────────────────────

  describe('configuration', () => {
    it('throws 500 when FOLDER9_WEBHOOK_SECRET is not set', async () => {
      delete process.env.FOLDER9_WEBHOOK_SECRET;
      const { raw, req } = makeRawReq({
        event: 'proposal.created',
        folder_id: FOLDER_ID,
      });
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).rejects.toMatchObject({ status: 500 });
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  // ── Signature enforcement ─────────────────────────────────────────────

  describe('signature verification', () => {
    it('rejects with 401 when the signature header is missing', async () => {
      const { req } = makeRawReq({
        event: 'proposal.created',
        folder_id: FOLDER_ID,
      });
      await expect(controller.receive(req, undefined)).rejects.toMatchObject({
        status: 401,
      });
      expect(db.select).not.toHaveBeenCalled();
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the signature header is present but empty', async () => {
      const { req } = makeRawReq({
        event: 'proposal.created',
        folder_id: FOLDER_ID,
      });
      await expect(controller.receive(req, '')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('rejects with 401 when the signature is wrong', async () => {
      const { req } = makeRawReq({
        event: 'proposal.approved',
        folder_id: FOLDER_ID,
      });
      await expect(
        controller.receive(req, 'sha256=deadbeef'),
      ).rejects.toMatchObject({ status: 401 });
      expect(db.select).not.toHaveBeenCalled();
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the raw body has been tampered with after signing', async () => {
      // Signature computed against one payload...
      const { raw } = makeRawReq({
        event: 'proposal.approved',
        folder_id: FOLDER_ID,
        proposal_id: PROPOSAL_ID,
      });
      const goodSig = sign(raw, SECRET);
      // ...but a different body is delivered.
      const tampered = makeRawReq({
        event: 'proposal.approved',
        folder_id: FOLDER_ID,
        proposal_id: 'someone-else',
      });
      await expect(
        controller.receive(tampered.req, goodSig),
      ).rejects.toMatchObject({ status: 401 });
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the rawBody is missing from the request (parser misconfigured)', async () => {
      // A properly-shaped signature for SOME payload, but `rawBody` absent
      // from the request — we cannot verify without bytes, so we reject.
      const req = {} as RawBodyRequest<Request>;
      await expect(
        controller.receive(req, 'sha256=anything'),
      ).rejects.toMatchObject({ status: 401 });
      expect(db.select).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the signature has the wrong byte length (prevents timingSafeEqual from throwing)', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.created',
        folder_id: FOLDER_ID,
      });
      // Valid prefix + short hex → length mismatch path
      const shortSig = sign(raw, SECRET).slice(0, 20);
      await expect(controller.receive(req, shortSig)).rejects.toMatchObject({
        status: 401,
      });
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });
  });

  // ── Business logic: event dispatch ────────────────────────────────────

  describe('event dispatch', () => {
    it('broadcasts proposal.created → wiki_proposal_created', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.created',
        folder_id: FOLDER_ID,
        data: { proposal_id: PROPOSAL_ID, author_id: 'author-1' },
      });
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).resolves.toBeUndefined();
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_proposal_created',
        {
          wikiId: WIKI_ID,
          proposalId: PROPOSAL_ID,
          authorId: 'author-1',
        },
      );
    });

    it('broadcasts proposal.approved → wiki_proposal_approved', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.approved',
        folder_id: FOLDER_ID,
        data: { proposal_id: PROPOSAL_ID },
      });
      await controller.receive(req, sign(raw, SECRET));
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_proposal_approved',
        { wikiId: WIKI_ID, proposalId: PROPOSAL_ID },
      );
    });

    it('broadcasts proposal.rejected → wiki_proposal_rejected', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.rejected',
        folder_id: FOLDER_ID,
        data: { proposal_id: PROPOSAL_ID },
      });
      await controller.receive(req, sign(raw, SECRET));
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_proposal_rejected',
        { wikiId: WIKI_ID, proposalId: PROPOSAL_ID },
      );
    });

    it('broadcasts ref.updated → wiki_page_updated and forwards ref/sha when present', async () => {
      const { raw, req } = makeRawReq({
        event: 'ref.updated',
        folder_id: FOLDER_ID,
        data: { ref: 'main', sha: 'abc123' },
      });
      await controller.receive(req, sign(raw, SECRET));
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_page_updated',
        { wikiId: WIKI_ID, ref: 'main', sha: 'abc123' },
      );
    });

    it('accepts top-level proposal_id (flat payload) as fallback if `data` is absent', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.created',
        folder_id: FOLDER_ID,
        proposal_id: PROPOSAL_ID,
        author_id: 'author-1',
      });
      await controller.receive(req, sign(raw, SECRET));
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_proposal_created',
        expect.objectContaining({
          wikiId: WIKI_ID,
          proposalId: PROPOSAL_ID,
          authorId: 'author-1',
        }),
      );
    });

    it('ignores unknown events with a debug log and no broadcast (200 OK)', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.changes_requested',
        folder_id: FOLDER_ID,
      });
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).resolves.toBeUndefined();
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('ignores webhooks whose folder_id is not a known wiki (200 OK + warn log)', async () => {
      db = makeDbMock(null);
      controller = new Folder9WebhookController(db as never, ws as never);
      const { raw, req } = makeRawReq({
        event: 'ref.updated',
        folder_id: '00000000-0000-0000-0000-0000000000ff',
        data: { ref: 'main', sha: 'abc' },
      });
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).resolves.toBeUndefined();
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects a webhook missing folder_id with 400 (malformed payload — signature valid but schema violated)', async () => {
      const { raw, req } = makeRawReq({
        event: 'proposal.approved',
        // no folder_id
      });
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).rejects.toMatchObject({ status: 400 });
      expect(db.select).not.toHaveBeenCalled();
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects non-JSON raw bodies with 400 (signature valid but payload unreadable)', async () => {
      const raw = Buffer.from('not-json', 'utf8');
      const req = { rawBody: raw } as RawBodyRequest<Request>;
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('broadcasts ref.updated with undefined ref/sha when those fields are absent from the payload', async () => {
      // Exercises the `pick` fallthrough (`return undefined`) when neither
      // `data.ref`/`data.sha` nor the top-level keys are present.
      const { raw, req } = makeRawReq({
        event: 'ref.updated',
        folder_id: FOLDER_ID,
      });
      await controller.receive(req, sign(raw, SECRET));
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_page_updated',
        { wikiId: WIKI_ID, ref: undefined, sha: undefined },
      );
    });

    it('ignores payloads whose `event` field is not a string (treats it as unknown, 200 OK)', async () => {
      const { raw, req } = makeRawReq({
        event: 42 as unknown as string, // non-string event — rare defensive path
        folder_id: FOLDER_ID,
      });
      await expect(
        controller.receive(req, sign(raw, SECRET)),
      ).resolves.toBeUndefined();
      expect(ws.broadcastToWorkspace).not.toHaveBeenCalled();
    });

    it('treats a non-object payload.data as empty (exercises the data-type guard)', async () => {
      // `data: null` is explicitly not truthy → falls through to the `{}`
      // branch and the top-level lookup inside `pick` wins.
      const { raw, req } = makeRawReq({
        event: 'proposal.approved',
        folder_id: FOLDER_ID,
        data: null,
        proposal_id: PROPOSAL_ID,
      });
      await controller.receive(req, sign(raw, SECRET));
      expect(ws.broadcastToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'wiki_proposal_approved',
        { wikiId: WIKI_ID, proposalId: PROPOSAL_ID },
      );
    });
  });
});
