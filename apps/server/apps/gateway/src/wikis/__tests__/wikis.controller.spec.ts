import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  StreamableFile,
} from '@nestjs/common';
import {
  PATH_METADATA,
  METHOD_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants.js';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { AuthGuard } from '@team9/auth';

// Load the controller before tests run so Nest's class metadata decorators
// execute during the same module import we introspect below.
import { WikisController } from '../wikis.controller.js';
import { WorkspaceGuard } from '../../workspace/guards/workspace.guard.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

const WS_ID = 'ws-1';
const USER_ID = 'user-1';
const WIKI_ID = 'wiki-1';
const PROPOSAL_ID = 'p-1';

describe('WikisController', () => {
  let controller: WikisController;
  let wikis: Record<string, MockFn>;
  let bots: { isBot: MockFn };

  beforeEach(() => {
    wikis = {
      listWikis: jest.fn<any>().mockResolvedValue([{ id: WIKI_ID }]),
      createWiki: jest.fn<any>().mockResolvedValue({ id: WIKI_ID }),
      getWiki: jest.fn<any>().mockResolvedValue({ id: WIKI_ID }),
      updateWikiSettings: jest.fn<any>().mockResolvedValue({ id: WIKI_ID }),
      archiveWiki: jest.fn<any>().mockResolvedValue(undefined),
      getTree: jest.fn<any>().mockResolvedValue([]),
      getPage: jest.fn<any>().mockResolvedValue({
        path: 'a.md',
        content: '',
        frontmatter: {},
        lastCommit: null,
      }),
      getRaw: jest
        .fn<any>()
        .mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
      commitPage: jest
        .fn<any>()
        .mockResolvedValue({ commit: { sha: 'abc' }, proposal: null }),
      listProposals: jest.fn<any>().mockResolvedValue([]),
      getProposalDiff: jest.fn<any>().mockResolvedValue([]),
      approveProposal: jest.fn<any>().mockResolvedValue(undefined),
      rejectProposal: jest.fn<any>().mockResolvedValue(undefined),
    };

    bots = {
      isBot: jest.fn<any>().mockResolvedValue(false),
    };

    controller = new WikisController(wikis as never, bots as never);
  });

  // ── Routing metadata ────────────────────────────────────────────────

  describe('controller metadata', () => {
    it('declares version 1 under /wikis', () => {
      const path = Reflect.getMetadata(PATH_METADATA, WikisController);
      expect(path).toBe('wikis');
    });

    it('applies AuthGuard and WorkspaceGuard at the class level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, WikisController);
      expect(guards).toHaveLength(2);
      expect(guards).toEqual(
        expect.arrayContaining([AuthGuard, WorkspaceGuard]),
      );
    });

    it('marks DELETE /wikis/:wikiId and approve as 204 No Content', () => {
      const archiveCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        controller.archive,
      );
      const approveCode = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        controller.approve,
      );
      expect(archiveCode).toBe(204);
      expect(approveCode).toBe(204);
    });

    it('registers the expected REST method per endpoint', () => {
      const methods: Array<[keyof WikisController, RequestMethod]> = [
        ['list', RequestMethod.GET],
        ['create', RequestMethod.POST],
        ['get', RequestMethod.GET],
        ['update', RequestMethod.PATCH],
        ['archive', RequestMethod.DELETE],
        ['getTree', RequestMethod.GET],
        ['getPage', RequestMethod.GET],
        ['getRaw', RequestMethod.GET],
        ['commit', RequestMethod.POST],
        ['listProposals', RequestMethod.GET],
        ['approve', RequestMethod.POST],
        ['reject', RequestMethod.POST],
        ['getProposalDiff', RequestMethod.GET],
      ];

      for (const [method, expected] of methods) {
        const fn = controller[method] as unknown as (
          ...args: unknown[]
        ) => unknown;
        const actual = Reflect.getMetadata(METHOD_METADATA, fn);
        expect(actual).toBe(expected);
      }
    });

    it('registers the expected path per endpoint', () => {
      const paths: Array<[keyof WikisController, string]> = [
        ['list', '/'],
        ['create', '/'],
        ['get', ':wikiId'],
        ['update', ':wikiId'],
        ['archive', ':wikiId'],
        ['getTree', ':wikiId/tree'],
        ['getPage', ':wikiId/pages'],
        ['getRaw', ':wikiId/raw'],
        ['commit', ':wikiId/commit'],
        ['listProposals', ':wikiId/proposals'],
        ['approve', ':wikiId/proposals/:proposalId/approve'],
        ['reject', ':wikiId/proposals/:proposalId/reject'],
        ['getProposalDiff', ':wikiId/proposals/:proposalId/diff'],
      ];

      for (const [method, expectedPath] of paths) {
        const fn = controller[method] as unknown as (
          ...args: unknown[]
        ) => unknown;
        const actual = Reflect.getMetadata(PATH_METADATA, fn);
        expect(actual).toBe(expectedPath);
      }
    });
  });

  // ── Workspace resolution ────────────────────────────────────────────

  describe('workspace resolution', () => {
    it('throws ForbiddenException when workspace context is missing', async () => {
      await expect(controller.list(undefined)).rejects.toThrow(
        ForbiddenException,
      );
      expect(wikis.listWikis).not.toHaveBeenCalled();
    });

    it('threads tenantId through to the service layer', async () => {
      await controller.list(WS_ID);
      expect(wikis.listWikis).toHaveBeenCalledWith(WS_ID);
    });
  });

  // ── isAgent derivation ──────────────────────────────────────────────

  describe('ActingUser derivation', () => {
    it('marks bot users with isAgent=true for every call', async () => {
      bots.isBot.mockResolvedValueOnce(true);
      await controller.get(WS_ID, USER_ID, WIKI_ID);
      expect(bots.isBot).toHaveBeenCalledWith(USER_ID);
      expect(wikis.getWiki).toHaveBeenCalledWith(WS_ID, WIKI_ID, {
        id: USER_ID,
        isAgent: true,
      });
    });

    it('marks human users with isAgent=false', async () => {
      bots.isBot.mockResolvedValueOnce(false);
      await controller.get(WS_ID, USER_ID, WIKI_ID);
      expect(wikis.getWiki).toHaveBeenCalledWith(WS_ID, WIKI_ID, {
        id: USER_ID,
        isAgent: false,
      });
    });
  });

  // ── CRUD forwarding ────────────────────────────────────────────────

  describe('list', () => {
    it('forwards the workspace id only', async () => {
      const result = await controller.list(WS_ID);
      expect(wikis.listWikis).toHaveBeenCalledWith(WS_ID);
      expect(bots.isBot).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: WIKI_ID }]);
    });
  });

  describe('create', () => {
    it('forwards workspace, acting user, and DTO', async () => {
      const dto = { name: 'public' } as never;
      const result = await controller.create(WS_ID, USER_ID, dto);
      expect(wikis.createWiki).toHaveBeenCalledWith(
        WS_ID,
        { id: USER_ID, isAgent: false },
        dto,
      );
      expect(result).toEqual({ id: WIKI_ID });
    });
  });

  describe('get', () => {
    it('forwards workspace, wiki id, and acting user', async () => {
      const result = await controller.get(WS_ID, USER_ID, WIKI_ID);
      expect(wikis.getWiki).toHaveBeenCalledWith(WS_ID, WIKI_ID, {
        id: USER_ID,
        isAgent: false,
      });
      expect(result).toEqual({ id: WIKI_ID });
    });
  });

  describe('update', () => {
    it('forwards workspace, wiki id, user, and DTO', async () => {
      const dto = { name: 'renamed' } as never;
      const result = await controller.update(WS_ID, USER_ID, WIKI_ID, dto);
      expect(wikis.updateWikiSettings).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        dto,
      );
      expect(result).toEqual({ id: WIKI_ID });
    });
  });

  describe('archive', () => {
    it('returns void after forwarding to archiveWiki', async () => {
      const result = await controller.archive(WS_ID, USER_ID, WIKI_ID);
      expect(wikis.archiveWiki).toHaveBeenCalledWith(WS_ID, WIKI_ID, {
        id: USER_ID,
        isAgent: false,
      });
      expect(result).toBeUndefined();
    });
  });

  // ── Content ─────────────────────────────────────────────────────────

  describe('getTree', () => {
    it('coerces recursive="true" query string to boolean true', async () => {
      await controller.getTree(WS_ID, USER_ID, WIKI_ID, '/docs', 'true');
      expect(wikis.getTree).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        { path: '/docs', recursive: true },
      );
    });

    it('treats any other recursive value (including undefined) as false', async () => {
      await controller.getTree(WS_ID, USER_ID, WIKI_ID);
      expect(wikis.getTree).toHaveBeenLastCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        { path: undefined, recursive: false },
      );

      await controller.getTree(WS_ID, USER_ID, WIKI_ID, '/', '1');
      expect(wikis.getTree).toHaveBeenLastCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        { path: '/', recursive: false },
      );
    });
  });

  describe('getPage', () => {
    it('forwards the path query string straight through', async () => {
      const result = await controller.getPage(
        WS_ID,
        USER_ID,
        WIKI_ID,
        'guide.md',
      );
      expect(wikis.getPage).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        'guide.md',
      );
      expect(result).toEqual({
        path: 'a.md',
        content: '',
        frontmatter: {},
        lastCommit: null,
      });
    });

    it('throws BadRequestException when ?path= is omitted', async () => {
      await expect(
        controller.getPage(WS_ID, USER_ID, WIKI_ID, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(wikis.getPage).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when ?path= is whitespace only', async () => {
      await expect(
        controller.getPage(WS_ID, USER_ID, WIKI_ID, '   '),
      ).rejects.toThrow(BadRequestException);
      expect(wikis.getPage).not.toHaveBeenCalled();
    });
  });

  describe('getRaw', () => {
    it('throws BadRequestException when ?path= is omitted', async () => {
      await expect(
        controller.getRaw(WS_ID, USER_ID, WIKI_ID, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(wikis.getRaw).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when ?path= is whitespace only', async () => {
      await expect(
        controller.getRaw(WS_ID, USER_ID, WIKI_ID, '   '),
      ).rejects.toThrow(BadRequestException);
      expect(wikis.getRaw).not.toHaveBeenCalled();
    });

    it('wraps the raw bytes in a StreamableFile', async () => {
      const bytes = new Uint8Array([9, 8, 7]).buffer;
      wikis.getRaw.mockResolvedValueOnce(bytes);

      const result = await controller.getRaw(
        WS_ID,
        USER_ID,
        WIKI_ID,
        'cover.png',
      );

      expect(wikis.getRaw).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        'cover.png',
      );
      expect(result).toBeInstanceOf(StreamableFile);
      // Extract the underlying buffer — StreamableFile exposes a getStream()
      // but for our small Buffer input the raw bytes are available via the
      // internal `bufferOrReadStream` accessor in nestjs; we re-read by
      // collecting the stream.
      const chunks: Buffer[] = [];
      for await (const chunk of result.getStream() as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    });
  });

  describe('commit', () => {
    it('forwards workspace, wiki id, user, and DTO', async () => {
      const dto = {
        message: 'edit',
        files: [{ path: 'a.md', content: 'x', action: 'update' }],
      } as never;
      const result = await controller.commit(WS_ID, USER_ID, WIKI_ID, dto);
      expect(wikis.commitPage).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        dto,
      );
      expect(result).toEqual({ commit: { sha: 'abc' }, proposal: null });
    });
  });

  // ── Proposals ──────────────────────────────────────────────────────

  describe('listProposals', () => {
    it('forwards the status query filter when present', async () => {
      await controller.listProposals(WS_ID, USER_ID, WIKI_ID, 'pending');
      expect(wikis.listProposals).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        { status: 'pending' },
      );
    });

    it('passes status=undefined when omitted', async () => {
      await controller.listProposals(WS_ID, USER_ID, WIKI_ID);
      expect(wikis.listProposals).toHaveBeenLastCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        { status: undefined },
      );
    });
  });

  describe('approve', () => {
    it('returns void after forwarding to approveProposal', async () => {
      const result = await controller.approve(
        WS_ID,
        USER_ID,
        WIKI_ID,
        PROPOSAL_ID,
      );
      expect(wikis.approveProposal).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        PROPOSAL_ID,
      );
      expect(result).toBeUndefined();
    });
  });

  describe('reject', () => {
    it('forwards the reason from the body', async () => {
      const result = await controller.reject(
        WS_ID,
        USER_ID,
        WIKI_ID,
        PROPOSAL_ID,
        { reason: 'scope creep' },
      );
      expect(wikis.rejectProposal).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        PROPOSAL_ID,
        'scope creep',
      );
      expect(result).toBeUndefined();
    });

    it('defaults the body to {} when absent and passes reason=undefined', async () => {
      await controller.reject(WS_ID, USER_ID, WIKI_ID, PROPOSAL_ID);
      expect(wikis.rejectProposal).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        PROPOSAL_ID,
        undefined,
      );
    });
  });

  describe('getProposalDiff', () => {
    it('forwards the proposal id to the service', async () => {
      await controller.getProposalDiff(WS_ID, USER_ID, WIKI_ID, PROPOSAL_ID);
      expect(wikis.getProposalDiff).toHaveBeenCalledWith(
        WS_ID,
        WIKI_ID,
        { id: USER_ID, isAgent: false },
        PROPOSAL_ID,
      );
    });
  });
});
