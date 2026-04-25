/**
 * End-to-end integration test against a *real* folder9 instance.
 *
 * Scope
 * -----
 * This suite verifies the gateway ↔ folder9 HTTP contract for the four flows
 * that matter for the Wiki feature:
 *
 *   F1  createWiki → folder9 folder actually exists (verified by a direct
 *       `getFolder` call on the same client used by the service).
 *   F2  commitPage (auto mode) → getPage returns the committed content with
 *       frontmatter split out.
 *   F3  commitPage (review mode) → proposal created → listProposals returns
 *       the pending proposal → approveProposal → getPage reflects the change.
 *   F4  folder9 webhook signature verification round-trip (unit-style; uses
 *       WEBHOOK_SECRET to sign a payload and asserts the controller accepts
 *       it). Run inline here so the integration suite is a single
 *       self-contained file.
 *
 * Trade-offs
 * ----------
 * - The Team9 database is **mocked** via the same chain-mock pattern used in
 *   `wikis.service.spec.ts`. folder9 is **real**. This gives us the real
 *   signal on the external integration boundary without needing a second
 *   real postgres for the gateway.
 * - The service invariant still holds: every operation goes through
 *   `WikisService`, never directly through `Folder9ClientService`. The only
 *   exception is F1's assertion step, which reads the folder back via the
 *   client to independently verify the service actually created it.
 *
 * Opt-in gate
 * -----------
 * Skipped unless `INTEGRATION=1` is set so normal `pnpm --filter @team9/gateway
 * test` keeps passing on any machine that hasn't started folder9. Run with:
 *
 *     docker compose -f src/wikis/__tests__/integration/docker-compose.yml up -d
 *     INTEGRATION=1 pnpm --filter @team9/gateway test -- wiki-folder9.integration
 *
 * See ./README.md for full setup / cleanup instructions.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from '@jest/globals';
import { createHmac } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import {
  makeChainMock,
  waitForFolder9Health,
  type ChainMock,
} from './setup.js';

// Env vars are read by the service/controller layer via `env.FOLDER9_*`
// getters (see apps/server/libs/shared/src/env.ts). Those getters proxy to
// `process.env`, so setting them *before* importing the service is all we
// need — we do NOT have to jest.mock('@team9/shared').
const FOLDER9_BASE_URL =
  process.env.FOLDER9_INTEGRATION_URL ?? 'http://localhost:58080';
const FOLDER9_PSK = 'test-psk';
const FOLDER9_WEBHOOK_SECRET = 'test-secret';

process.env.FOLDER9_API_URL = FOLDER9_BASE_URL;
process.env.FOLDER9_PSK = FOLDER9_PSK;
process.env.FOLDER9_WEBHOOK_SECRET = FOLDER9_WEBHOOK_SECRET;

// Import *after* setting env so the shared `env` proxy reads our values the
// first time it's consulted. The imports themselves do not read env at module
// load today, but this ordering keeps the test robust to that changing.
const { WikisService } = await import('../../wikis.service.js');
const { Folder9ClientService } =
  await import('../../folder9-client.service.js');
const { Folder9WebhookController } =
  await import('../../folder9-webhook.controller.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-13T10:00:00.000Z');
const HUMAN_USER = { id: 'user-1', isAgent: false } as const;

/** Minimal workspace_wikis row shape required by the service layer. */
interface WikiRow {
  id: string;
  workspaceId: string;
  folder9FolderId: string;
  name: string;
  slug: string;
  approvalMode: 'auto' | 'review';
  humanPermission: 'read' | 'propose' | 'write';
  agentPermission: 'read' | 'propose' | 'write';
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

function makeWikiRow(overrides: Partial<WikiRow> = {}): WikiRow {
  return {
    id: 'wiki-1',
    workspaceId: 'ws-integration',
    folder9FolderId: 'placeholder',
    name: 'integration',
    slug: 'integration',
    approvalMode: 'auto',
    humanPermission: 'write',
    agentPermission: 'read',
    createdBy: HUMAN_USER.id,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Stack the two DB calls the commit path makes, in order:
 *   1. `getWikiOrThrow` → returns the wiki row
 *   2. `loadUserProfile` → returns the user's display name + email
 *
 * Any additional terminal-`.limit()` calls after these two will fall through
 * to the default `[]` resolution set by makeChainMock().
 */
function primeCommitPath(db: ChainMock, wiki: WikiRow) {
  db.limit
    .mockResolvedValueOnce([wiki])
    .mockResolvedValueOnce([
      { displayName: 'Integration Alice', email: 'alice@example.com' },
    ]);
}

function primeReadPath(db: ChainMock, wiki: WikiRow) {
  db.limit.mockResolvedValueOnce([wiki]);
}

// ---------------------------------------------------------------------------
// Integration gate
// ---------------------------------------------------------------------------

const INTEGRATION_ENABLED = process.env.INTEGRATION === '1';
// Inferred type is `describe | typeof describe.skip`; avoid the explicit
// `jest.Describe` namespace reference because ESM mode (`--experimental-vm-modules`)
// doesn't register @types/jest globals, so the type annotation would emit a
// runtime `jest` reference and fail before the first assertion.
const maybeDescribe = INTEGRATION_ENABLED ? describe : describe.skip;

maybeDescribe('WikisModule integration — real folder9', () => {
  let svc: InstanceType<typeof WikisService>;
  let f9: InstanceType<typeof Folder9ClientService>;
  let db: ChainMock;

  // Resources created during the run; tracked so afterAll() can clean up.
  const createdFolders: string[] = [];

  beforeAll(async () => {
    await waitForFolder9Health(FOLDER9_BASE_URL);
  }, 90_000);

  beforeEach(() => {
    db = makeChainMock();
    f9 = new Folder9ClientService();
    // Integration test doesn't exercise WebSocket broadcasting; a stub that
    // resolves to `undefined` keeps the WikisService constructor happy while
    // leaving broadcast failures invisible to the suite.
    const wsStub = {
      broadcastToWorkspace: async () => undefined,
    };
    svc = new WikisService(db as never, f9, wsStub);
  });

  afterAll(async () => {
    // Best-effort: delete every folder we created so repeated runs don't leak
    // state in the shared postgres volume. A single stale folder isn't fatal
    // (folder ids are unique per workspace) but the cleanup keeps the test
    // DB tidy for inspection.
    const cleanupClient = new Folder9ClientService();
    for (const folderId of createdFolders) {
      try {
        await cleanupClient.deleteFolder('ws-integration', folderId);
      } catch {
        // swallow — the folder may have been removed already, or the
        // container may already be shutting down.
      }
    }
  });

  // -----------------------------------------------------------------------
  // F1: create Wiki → folder9 folder exists
  // -----------------------------------------------------------------------
  it('F1: createWiki provisions a real folder9 folder', async () => {
    // Slug-uniqueness lookup: empty result (first wiki with this slug).
    db.limit.mockResolvedValueOnce([]);
    // Insert .returning() echoes back a row we mint from the folder9 id.
    let insertedWiki: WikiRow | null = null;
    db.returning.mockImplementationOnce(async () => {
      // The service passes folder9FolderId, name, slug into .values() — grab
      // them from the mock so our returned row mirrors what was actually
      // persisted. (Using a fresh `Date.now()` here would race with the
      // caller's own `Date.now()` below by a few ms and break the equality
      // check on dto.name.)
      const valuesCall = db.values.mock.calls.at(-1)?.[0] as
        | { folder9FolderId?: string; name?: string; slug?: string }
        | undefined;
      insertedWiki = makeWikiRow({
        folder9FolderId: valuesCall?.folder9FolderId ?? 'unknown',
        name: valuesCall?.name ?? 'unknown',
        slug: valuesCall?.slug ?? 'unknown',
      });
      return [insertedWiki];
    });

    const uniqueName = `f1-${Date.now()}`;
    const dto = await svc.createWiki('ws-integration', HUMAN_USER, {
      name: uniqueName,
      slug: uniqueName.toLowerCase(),
    });
    expect(dto.name).toBe(uniqueName);
    expect(insertedWiki).not.toBeNull();
    expect(insertedWiki!.folder9FolderId).toMatch(/\S/);

    // Independent verification: folder9's single-folder GET endpoint sits
    // behind TokenMiddleware (not PSK), so we mint a read-scoped token and
    // use it to fetch the tree — a successful tree call proves the folder
    // exists and is reachable. The folder ID alone (a real UUID echoed back
    // from folder9's POST response) is already strong evidence the service
    // hit the remote.
    expect(insertedWiki!.folder9FolderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const verifyToken = await f9.createToken({
      folder_id: insertedWiki!.folder9FolderId,
      permission: 'read',
      created_by: 'integration-test',
    });
    const tree = await f9.getTree(
      'ws-integration',
      insertedWiki!.folder9FolderId,
      verifyToken.token,
    );
    expect(Array.isArray(tree)).toBe(true);

    createdFolders.push(insertedWiki!.folder9FolderId);
  }, 60_000);

  // -----------------------------------------------------------------------
  // F2: commit in auto mode → getPage returns the committed content
  // -----------------------------------------------------------------------
  it('F2: commitPage (auto) → getPage returns the content', async () => {
    // Pre-provision a folder9 folder directly so we can isolate the
    // commit + read flow from the createWiki flow.
    const folder = await f9.createFolder('ws-integration', {
      name: `f2-${Date.now()}`,
      type: 'managed',
      owner_type: 'workspace',
      owner_id: 'ws-integration',
      approval_mode: 'auto',
    });
    createdFolders.push(folder.id);

    const wiki = makeWikiRow({
      id: 'wiki-f2',
      folder9FolderId: folder.id,
      approvalMode: 'auto',
      humanPermission: 'write',
    });

    // --- commit -----------------------------------------------------------
    primeCommitPath(db, wiki);
    const commitBody = [
      '---',
      'title: Hello',
      'tags: [alpha, beta]',
      '---',
      '',
      '# Hello, folder9!',
      '',
      'Body paragraph.',
    ].join('\n');

    const commitResult = await svc.commitPage(
      'ws-integration',
      wiki.id,
      HUMAN_USER,
      {
        message: 'F2: add page',
        files: [
          { path: 'hello.md', content: commitBody, action: 'create' as const },
        ],
      },
    );
    expect(commitResult.commit.sha).toMatch(/^[0-9a-f]+$/);
    expect(commitResult.proposal).toBeNull();

    // --- read back --------------------------------------------------------
    primeReadPath(db, wiki);
    const page = await svc.getPage(
      'ws-integration',
      wiki.id,
      HUMAN_USER,
      'hello.md',
    );
    expect(page.path).toBe('hello.md');
    expect(page.content).toContain('# Hello, folder9!');
    expect(page.content).toContain('Body paragraph.');
    expect(page.frontmatter).toEqual({
      title: 'Hello',
      tags: ['alpha', 'beta'],
    });
  }, 60_000);

  // -----------------------------------------------------------------------
  // F3: review mode → proposal flow
  // -----------------------------------------------------------------------
  it('F3: commitPage (review) → proposal → approve → content reflects', async () => {
    const folder = await f9.createFolder('ws-integration', {
      name: `f3-${Date.now()}`,
      type: 'managed',
      owner_type: 'workspace',
      owner_id: 'ws-integration',
      approval_mode: 'review',
    });
    createdFolders.push(folder.id);

    const wiki = makeWikiRow({
      id: 'wiki-f3',
      folder9FolderId: folder.id,
      approvalMode: 'review',
      humanPermission: 'write',
    });

    // Seed an initial page on `main` with a direct commit (bypass review) so
    // the proposal has something to diff against. The seed itself goes
    // through the service so we stay behind the invariant: nothing talks to
    // folder9 except via WikisService.
    //
    // Trick: we can't bypass review through the service (by design). Instead,
    // make the first commit also go through the proposal path and pre-approve
    // it. This mirrors how a reviewer would bootstrap a review-mode wiki.
    primeCommitPath(db, wiki);
    const seed = await svc.commitPage('ws-integration', wiki.id, HUMAN_USER, {
      message: 'F3: seed',
      files: [
        { path: 'doc.md', content: 'v1 content\n', action: 'create' as const },
      ],
    });
    expect(seed.proposal).not.toBeNull();

    // Approve the seed proposal so doc.md exists on main.
    primeCommitPath(db, wiki);
    await svc.approveProposal(
      'ws-integration',
      wiki.id,
      HUMAN_USER,
      seed.proposal!.id,
    );

    // --- Now the real F3 flow: propose an update --------------------------
    primeCommitPath(db, wiki);
    const result = await svc.commitPage('ws-integration', wiki.id, HUMAN_USER, {
      message: 'F3: update',
      files: [
        { path: 'doc.md', content: 'v2 content\n', action: 'update' as const },
      ],
    });
    expect(result.proposal).not.toBeNull();
    const proposalId = result.proposal!.id;

    // listProposals returns our pending proposal.
    primeReadPath(db, wiki);
    const pending = await svc.listProposals(
      'ws-integration',
      wiki.id,
      HUMAN_USER,
    );
    expect(pending.map((p) => p.id)).toContain(proposalId);
    const match = pending.find((p) => p.id === proposalId)!;
    expect(match.status).toBe('pending');

    // approveProposal merges the branch.
    primeCommitPath(db, wiki);
    await svc.approveProposal(
      'ws-integration',
      wiki.id,
      HUMAN_USER,
      proposalId,
    );

    // Confirm main now reflects v2.
    primeReadPath(db, wiki);
    const finalPage = await svc.getPage(
      'ws-integration',
      wiki.id,
      HUMAN_USER,
      'doc.md',
    );
    expect(finalPage.content.trim()).toBe('v2 content');
  }, 90_000);

  // -----------------------------------------------------------------------
  // F4: webhook signature round-trip
  // -----------------------------------------------------------------------
  it('F4: folder9 webhook signature is accepted end-to-end', async () => {
    const workspaceId = 'ws-integration';
    const wikiId = 'wiki-f4';
    const folderId = '00000000-0000-0000-0000-000000000042';
    const proposalId = 'prop-f4';

    // Mock the db → allow-list lookup to return a matching wiki row.
    const webhookDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest
        .fn()
        .mockResolvedValue([
          { id: wikiId, workspaceId, folder9FolderId: folderId },
        ]),
    };

    const broadcasts: Array<{ ws: string; event: string; data: unknown }> = [];
    const gateway = {
      broadcastToWorkspace: jest
        .fn()
        .mockImplementation(
          async (ws: string, event: string, data: unknown) => {
            broadcasts.push({ ws, event, data });
          },
        ),
    };

    const controller = new Folder9WebhookController(
      webhookDb as never,
      gateway as never,
    );

    const payload = {
      event: 'proposal.approved',
      folder_id: folderId,
      workspace_id: 'folder9-ws',
      data: { proposal_id: proposalId },
      timestamp: new Date().toISOString(),
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature =
      'sha256=' +
      createHmac('sha256', FOLDER9_WEBHOOK_SECRET).update(raw).digest('hex');
    const req = { rawBody: raw } as RawBodyRequest<Request>;

    await expect(controller.receive(req, signature)).resolves.toBeUndefined();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      ws: workspaceId,
      event: 'wiki_proposal_approved',
      data: { wikiId, proposalId },
    });
  });
});

// Preserve the skip-without-INTEGRATION contract even for test runners that
// don't surface `describe.skip` output: emit a top-level `it.skip` so a
// reader of the Jest summary sees why nothing ran.
if (!INTEGRATION_ENABLED) {
  describe('WikisModule integration — real folder9', () => {
    it.skip('skipped unless INTEGRATION=1 is set (see README.md)', () => {
      // intentionally empty
    });
  });
}
