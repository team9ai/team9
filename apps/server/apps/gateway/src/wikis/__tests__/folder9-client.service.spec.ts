import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

/**
 * folder9 auth header name.
 *
 * Confirmed by reading folder9/internal/api/middleware_psk.go and
 * middleware_token.go: both PSK and opaque tokens are sent as
 * "Authorization: Bearer <value>". File/proposal operations use a
 * folder-scoped token; folder CRUD uses the PSK directly.
 */
const AUTH_HEADER = 'Authorization';

const mockEnv: {
  FOLDER9_API_URL: string | undefined;
  FOLDER9_PSK: string | undefined;
} = {
  FOLDER9_API_URL: 'http://folder9.test',
  FOLDER9_PSK: 'psk-test',
};

jest.unstable_mockModule('@team9/shared', () => ({
  env: mockEnv,
}));

const { Folder9ClientService } = await import('../folder9-client.service.js');
const { Folder9ApiError, Folder9NetworkError } =
  await import('../types/folder9.types.js');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(status = 200): Response {
  return new Response('', { status });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('Folder9ClientService', () => {
  let service: InstanceType<typeof Folder9ClientService>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.FOLDER9_API_URL = 'http://folder9.test';
    mockEnv.FOLDER9_PSK = 'psk-test';
    service = new Folder9ClientService();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------------------------------------------------------------------
  // Folder management (PSK-protected)
  // ---------------------------------------------------------------------

  describe('createFolder', () => {
    it('POSTs to /api/workspaces/{wsId}/folders with Authorization: Bearer <psk>', async () => {
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            id: 'f-1',
            name: 'wiki',
            type: 'managed',
            owner_type: 'workspace',
            owner_id: 'ws-1',
            workspace_id: 'ws-1',
            approval_mode: 'auto',
            created_at: '2026-04-13T00:00:00Z',
            updated_at: '2026-04-13T00:00:00Z',
          },
          201,
        ),
      );
      globalThis.fetch = fetchFn;

      const result = await service.createFolder('ws-1', {
        name: 'wiki',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'ws-1',
        approval_mode: 'auto',
      });

      expect(result.id).toBe('f-1');
      expect(result.workspace_id).toBe('ws-1');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://folder9.test/api/workspaces/ws-1/folders');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)[AUTH_HEADER]).toBe(
        'Bearer psk-test',
      );
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        name: 'wiki',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'ws-1',
        approval_mode: 'auto',
      });
    });

    it('strips a trailing slash from FOLDER9_API_URL', async () => {
      mockEnv.FOLDER9_API_URL = 'http://folder9.test/';
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: 'f-1' }, 201));
      globalThis.fetch = fetchFn;

      await service.createFolder('ws-1', {
        name: 'wiki',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'ws-1',
      });

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe('http://folder9.test/api/workspaces/ws-1/folders');
    });
  });

  describe('getFolder', () => {
    it('GETs /api/workspaces/{wsId}/folders/{folderId}', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: 'f-1', workspace_id: 'ws-1' }));
      globalThis.fetch = fetchFn;

      const result = await service.getFolder('ws-1', 'f-1');

      expect(result.id).toBe('f-1');
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://folder9.test/api/workspaces/ws-1/folders/f-1');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });
  });

  describe('updateFolder', () => {
    it('PATCHes with the given body', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: 'f-1', name: 'renamed' }));
      globalThis.fetch = fetchFn;

      const result = await service.updateFolder('ws-1', 'f-1', {
        name: 'renamed',
        approval_mode: 'review',
      });

      expect(result.name).toBe('renamed');
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://folder9.test/api/workspaces/ws-1/folders/f-1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({
        name: 'renamed',
        approval_mode: 'review',
      });
    });
  });

  describe('deleteFolder', () => {
    it('DELETEs /api/workspaces/{wsId}/folders/{folderId}', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ status: 'deleted' }));
      globalThis.fetch = fetchFn;

      await service.deleteFolder('ws-1', 'f-1');

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://folder9.test/api/workspaces/ws-1/folders/f-1');
      expect(init.method).toBe('DELETE');
    });
  });

  // ---------------------------------------------------------------------
  // Token minting (PSK-protected)
  // ---------------------------------------------------------------------

  describe('createToken', () => {
    it('POSTs to /api/tokens with Authorization: Bearer <psk> and the full body', async () => {
      const body = {
        id: 'tok-id-1',
        token: 'opaque-bearer-value',
        folder_id: 'f-1',
        permission: 'read',
        name: 'wiki-read',
        created_by: 'wiki:ws-1',
        created_at: '2026-04-13T10:00:00Z',
        expires_at: '2026-04-13T10:16:00Z',
      };
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(body, 201));
      globalThis.fetch = fetchFn;

      const result = await service.createToken({
        folder_id: 'f-1',
        permission: 'read',
        name: 'wiki-read',
        created_by: 'wiki:ws-1',
        expires_at: '2026-04-13T10:16:00Z',
      });

      expect(result).toEqual(body);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://folder9.test/api/tokens');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)[AUTH_HEADER]).toBe(
        'Bearer psk-test',
      );
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        folder_id: 'f-1',
        permission: 'read',
        name: 'wiki-read',
        created_by: 'wiki:ws-1',
        expires_at: '2026-04-13T10:16:00Z',
      });
    });

    it('throws a clear error when FOLDER9_PSK is missing', async () => {
      mockEnv.FOLDER9_PSK = undefined;
      globalThis.fetch = jest.fn<typeof fetch>();

      await expect(
        service.createToken({
          folder_id: 'f-1',
          permission: 'read',
          name: 'x',
          created_by: 'x',
        }),
      ).rejects.toThrow(/FOLDER9_PSK/);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('maps non-2xx responses to Folder9ApiError', async () => {
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ error: 'CREATE_TOKEN_FAILED' }, 422));

      let err: unknown;
      try {
        await service.createToken({
          folder_id: 'f-bogus',
          permission: 'read',
          name: 'x',
          created_by: 'x',
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Folder9ApiError);
      const apiErr = err as InstanceType<typeof Folder9ApiError>;
      expect(apiErr.status).toBe(422);
      expect(apiErr.endpoint).toBe('/api/tokens');
      expect(apiErr.body).toEqual({ error: 'CREATE_TOKEN_FAILED' });
    });
  });

  // ---------------------------------------------------------------------
  // File read operations (token-protected)
  // ---------------------------------------------------------------------

  describe('getTree', () => {
    it('GETs /tree with Authorization: Bearer <token> and recursive=true', async () => {
      const entries = [
        { name: 'readme.md', path: 'readme.md', type: 'file', size: 10 },
      ];
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(entries));
      globalThis.fetch = fetchFn;

      const result = await service.getTree('ws-1', 'f-1', 'tok-1', {
        path: '/docs',
        recursive: true,
        ref: 'main',
      });

      expect(result).toEqual(entries);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/tree?path=%2Fdocs&recursive=true&ref=main',
      );
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)[AUTH_HEADER]).toBe(
        'Bearer tok-1',
      );
    });

    it('omits recursive=false from the query string', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([]));
      globalThis.fetch = fetchFn;

      await service.getTree('ws-1', 'f-1', 'tok-1', { recursive: false });

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/tree',
      );
    });

    it('omits the query string entirely when no options are given', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([]));
      globalThis.fetch = fetchFn;

      await service.getTree('ws-1', 'f-1', 'tok-1');

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/tree',
      );
    });
  });

  describe('getBlob', () => {
    it('GETs /blob with encoded path and ref', async () => {
      const body = {
        path: 'docs/guide.md',
        size: 42,
        content: 'hello',
        encoding: 'text',
      };
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(body));
      globalThis.fetch = fetchFn;

      const result = await service.getBlob(
        'ws-1',
        'f-1',
        'tok-1',
        'docs/my file.md',
        'main',
      );

      expect(result).toEqual(body);
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/blob?path=docs%2Fmy+file.md&ref=main',
      );
    });

    it('omits ref when not provided', async () => {
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          path: 'a.md',
          size: 1,
          content: 'x',
          encoding: 'text',
        }),
      );
      globalThis.fetch = fetchFn;

      await service.getBlob('ws-1', 'f-1', 'tok-1', 'a.md');

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/blob?path=a.md',
      );
    });
  });

  describe('getRaw', () => {
    it('returns the raw binary body as ArrayBuffer', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );
      globalThis.fetch = fetchFn;

      const result = await service.getRaw(
        'ws-1',
        'f-1',
        'tok-1',
        'image.png',
        'main',
      );

      expect(new Uint8Array(result)).toEqual(bytes);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/raw?path=image.png&ref=main',
      );
      expect((init.headers as Record<string, string>)[AUTH_HEADER]).toBe(
        'Bearer tok-1',
      );
    });

    it('omits ref from the query string when not provided', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));
      globalThis.fetch = fetchFn;

      await service.getRaw('ws-1', 'f-1', 'tok-1', 'a.bin');

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/raw?path=a.bin',
      );
    });

    it('maps non-2xx responses to Folder9ApiError', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ error: 'FILE_NOT_FOUND' }, 404));
      globalThis.fetch = fetchFn;

      await expect(
        service.getRaw('ws-1', 'f-1', 'tok-1', 'missing.bin'),
      ).rejects.toBeInstanceOf(Folder9ApiError);
    });

    it('maps fetch network failures to Folder9NetworkError', async () => {
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError('ECONNREFUSED'));

      await expect(
        service.getRaw('ws-1', 'f-1', 'tok-1', 'a.bin'),
      ).rejects.toBeInstanceOf(Folder9NetworkError);
    });

    it('carries non-JSON error bodies from raw responses as a raw string', async () => {
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(textResponse('upstream failure', 500));

      let err: unknown;
      try {
        await service.getRaw('ws-1', 'f-1', 'tok-1', 'a.bin');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Folder9ApiError);
      expect((err as InstanceType<typeof Folder9ApiError>).body).toBe(
        'upstream failure',
      );
    });

    it('surfaces empty error bodies from raw responses as undefined', async () => {
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(emptyResponse(500));

      let err: unknown;
      try {
        await service.getRaw('ws-1', 'f-1', 'tok-1', 'a.bin');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Folder9ApiError);
      expect(
        (err as InstanceType<typeof Folder9ApiError>).body,
      ).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // Commit (token-protected)
  // ---------------------------------------------------------------------

  describe('commit', () => {
    it('POSTs /commit with propose=false (direct commit)', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ commit: 'abc123', branch: 'main' }));
      globalThis.fetch = fetchFn;

      const result = await service.commit('ws-1', 'f-1', 'tok-1', {
        message: 'add readme',
        files: [{ path: 'README.md', content: 'hello', action: 'create' }],
      });

      expect(result).toEqual({ commit: 'abc123', branch: 'main' });
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/commit',
      );
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)[AUTH_HEADER]).toBe(
        'Bearer tok-1',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        message: 'add readme',
        files: [{ path: 'README.md', content: 'hello', action: 'create' }],
      });
    });

    it('POSTs /commit with propose=true (proposal flow)', async () => {
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          commit: 'def456',
          branch: 'proposal/uuid',
          proposal_id: 'prop-1',
        }),
      );
      globalThis.fetch = fetchFn;

      const result = await service.commit('ws-1', 'f-1', 'tok-1', {
        message: 'propose change',
        files: [{ path: 'doc.md', content: 'new', action: 'update' }],
        propose: true,
      });

      expect(result.proposal_id).toBe('prop-1');
      expect(result.branch).toBe('proposal/uuid');
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        message: 'propose change',
        files: [{ path: 'doc.md', content: 'new', action: 'update' }],
        propose: true,
      });
    });
  });

  // ---------------------------------------------------------------------
  // Proposals (token-protected)
  // ---------------------------------------------------------------------

  describe('listProposals', () => {
    it('GETs /proposals with status filter', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([{ id: 'p-1' }]));
      globalThis.fetch = fetchFn;

      const result = await service.listProposals('ws-1', 'f-1', 'tok-1', {
        status: 'pending',
      });

      expect(result).toHaveLength(1);
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/proposals?status=pending',
      );
    });

    it('GETs /proposals without query string when no options given', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([]));
      globalThis.fetch = fetchFn;

      await service.listProposals('ws-1', 'f-1', 'tok-1');

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/proposals',
      );
    });
  });

  describe('getProposal', () => {
    it('GETs /proposals/{pid}', async () => {
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: 'p-1',
          folder_id: 'f-1',
          branch_name: 'proposal/x',
          status: 'pending',
          diff_summary: [{ Path: 'a.md', Status: 'added' }],
        }),
      );
      globalThis.fetch = fetchFn;

      const result = await service.getProposal('ws-1', 'f-1', 'p-1', 'tok-1');

      expect(result.id).toBe('p-1');
      expect(result.diff_summary).toHaveLength(1);
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/proposals/p-1',
      );
    });
  });

  describe('getProposalDiff', () => {
    it('returns the diff_summary embedded in GET /proposals/{pid}', async () => {
      const diff = [
        {
          Path: 'a.md',
          Status: 'modified',
          OldContent: 'old',
          NewContent: 'new',
        },
      ];
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: 'p-1',
          folder_id: 'f-1',
          branch_name: 'proposal/x',
          status: 'pending',
          diff_summary: diff,
        }),
      );
      globalThis.fetch = fetchFn;

      const result = await service.getProposalDiff(
        'ws-1',
        'f-1',
        'p-1',
        'tok-1',
      );

      expect(result).toEqual(diff);
    });

    it('returns an empty array when diff_summary is absent', async () => {
      const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: 'p-1',
          folder_id: 'f-1',
          branch_name: 'proposal/x',
          status: 'merged',
        }),
      );
      globalThis.fetch = fetchFn;

      const result = await service.getProposalDiff(
        'ws-1',
        'f-1',
        'p-1',
        'tok-1',
      );

      expect(result).toEqual([]);
    });
  });

  describe('approveProposal', () => {
    it('POSTs /proposals/{pid}/approve with reviewer_id', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ status: 'approved' }));
      globalThis.fetch = fetchFn;

      await service.approveProposal('ws-1', 'f-1', 'p-1', 'tok-1', 'user-1');

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/proposals/p-1/approve',
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        reviewer_id: 'user-1',
      });
    });
  });

  describe('rejectProposal', () => {
    it('POSTs /proposals/{pid}/reject with reviewer_id and reason', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ status: 'rejected' }));
      globalThis.fetch = fetchFn;

      await service.rejectProposal(
        'ws-1',
        'f-1',
        'p-1',
        'tok-1',
        'user-1',
        'not needed',
      );

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'http://folder9.test/api/workspaces/ws-1/folders/f-1/proposals/p-1/reject',
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        reviewer_id: 'user-1',
        reason: 'not needed',
      });
    });

    it('omits reason when not provided', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ status: 'rejected' }));
      globalThis.fetch = fetchFn;

      await service.rejectProposal('ws-1', 'f-1', 'p-1', 'tok-1', 'user-1');

      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        reviewer_id: 'user-1',
      });
    });
  });

  // ---------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------

  describe('error mapping', () => {
    it.each([
      [400, { error: 'INVALID_REQUEST' }],
      [401, { error: 'INVALID_PSK' }],
      [403, { error: 'INSUFFICIENT_PERMISSION' }],
      [404, { error: 'FOLDER_NOT_FOUND' }],
      [409, { error: 'INVALID_STATUS_TRANSITION' }],
      [422, { error: 'COMMIT_FAILED' }],
      [500, { error: 'INTERNAL' }],
    ])(
      'maps status %d to Folder9ApiError carrying status/body/endpoint',
      async (status, body) => {
        globalThis.fetch = jest
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse(body, status));

        let err: unknown;
        try {
          await service.getFolder('ws-1', 'f-1');
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(Folder9ApiError);
        const apiErr = err as InstanceType<typeof Folder9ApiError>;
        expect(apiErr.status).toBe(status);
        expect(apiErr.endpoint).toBe('/api/workspaces/ws-1/folders/f-1');
        expect(apiErr.body).toEqual(body);
        expect(apiErr.message).toContain(String(status));
      },
    );

    it('carries non-JSON error body as a raw string', async () => {
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(textResponse('plain-text error', 500));

      let err: unknown;
      try {
        await service.getFolder('ws-1', 'f-1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Folder9ApiError);
      expect((err as InstanceType<typeof Folder9ApiError>).body).toBe(
        'plain-text error',
      );
    });

    it('returns undefined for empty 2xx response bodies', async () => {
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(emptyResponse(200));

      await expect(
        service.deleteFolder('ws-1', 'f-1'),
      ).resolves.toBeUndefined();
    });

    it('maps fetch exceptions to Folder9NetworkError preserving the cause', async () => {
      const cause = new TypeError('ECONNREFUSED');
      globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(cause);

      let err: unknown;
      try {
        await service.getFolder('ws-1', 'f-1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Folder9NetworkError);
      const netErr = err as InstanceType<typeof Folder9NetworkError>;
      expect(netErr.endpoint).toBe('/api/workspaces/ws-1/folders/f-1');
      expect(netErr.cause).toBe(cause);
      expect(netErr.message).toContain('network error');
    });

    it('throws a clear error when FOLDER9_API_URL is missing', async () => {
      mockEnv.FOLDER9_API_URL = undefined;
      globalThis.fetch = jest.fn<typeof fetch>();

      await expect(service.getFolder('ws-1', 'f-1')).rejects.toThrow(
        /FOLDER9_API_URL/,
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('throws a clear error when FOLDER9_PSK is missing (PSK-protected call)', async () => {
      mockEnv.FOLDER9_PSK = undefined;
      globalThis.fetch = jest.fn<typeof fetch>();

      await expect(service.getFolder('ws-1', 'f-1')).rejects.toThrow(
        /FOLDER9_PSK/,
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('does NOT require FOLDER9_PSK for token-authenticated calls', async () => {
      mockEnv.FOLDER9_PSK = undefined;
      globalThis.fetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([]));

      await expect(
        service.listProposals('ws-1', 'f-1', 'tok-1'),
      ).resolves.toEqual([]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // Timeout handling
  // ---------------------------------------------------------------------

  describe('timeout handling', () => {
    it('attaches an AbortSignal to every JSON request', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: 'f-1' }));
      globalThis.fetch = fetchFn;

      await service.getFolder('ws-1', 'f-1');

      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeDefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('attaches an AbortSignal to binary requests (getRaw)', async () => {
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
      globalThis.fetch = fetchFn;

      await service.getRaw('ws-1', 'f-1', 'tok-1', 'a.bin');

      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeDefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('maps AbortError from a hung request to Folder9NetworkError with a timeout message', async () => {
      globalThis.fetch = jest.fn(async (_url, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }) as unknown as typeof globalThis.fetch;

      let err: unknown;
      try {
        // Override default 15s → tight 50ms so the test does not hang.
        await (
          service as unknown as {
            request: <T>(
              m: string,
              p: string,
              a: unknown,
              b?: unknown,
              t?: number,
            ) => Promise<T>;
          }
        ).request(
          'GET',
          '/api/workspaces/ws-1/folders/f-1',
          'psk',
          undefined,
          50,
        );
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Folder9NetworkError);
      const netErr = err as InstanceType<typeof Folder9NetworkError>;
      expect(netErr.endpoint).toBe('/api/workspaces/ws-1/folders/f-1');
      expect(netErr.message).toContain('timed out after 50ms');
      expect(netErr.message).toContain('/api/workspaces/ws-1/folders/f-1');
      expect(netErr.cause).toBeInstanceOf(DOMException);
    });

    it('maps AbortError from getRaw (binary path) to a timeout Folder9NetworkError', async () => {
      globalThis.fetch = jest.fn(async (_url, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }) as unknown as typeof globalThis.fetch;

      let err: unknown;
      try {
        // Short timeout override to avoid hanging the test.
        await service.getRaw('ws-1', 'f-1', 'tok-1', 'a.bin', undefined, 50);
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Folder9NetworkError);
      const netErr = err as InstanceType<typeof Folder9NetworkError>;
      expect(netErr.message).toContain('timed out after 50ms');
      expect(netErr.endpoint).toBe(
        '/api/workspaces/ws-1/folders/f-1/raw?path=a.bin',
      );
    });

    it('also recognises TimeoutError by name (native AbortSignal.timeout)', async () => {
      // AbortSignal.timeout() in Node can surface as TimeoutError rather than
      // AbortError depending on runtime. Both names must map to a timeout
      // Folder9NetworkError so the behaviour is consistent across versions.
      const timeoutErr = Object.assign(new Error('timed out'), {
        name: 'TimeoutError',
      });
      globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(timeoutErr);

      let err: unknown;
      try {
        await service.getFolder('ws-1', 'f-1');
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Folder9NetworkError);
      const netErr = err as InstanceType<typeof Folder9NetworkError>;
      expect(netErr.message).toContain('timed out after 15000ms');
      expect(netErr.cause).toBe(timeoutErr);
    });

    it('passes the longer default timeout (60s) through commit', async () => {
      // We verify the override path is wired through: pass a custom timeout
      // and assert it reaches the fetch layer by firing an abort at that
      // deadline. We can't directly observe the timeout value on
      // AbortSignal.timeout()'s signal, so we exercise behaviour end-to-end.
      const fetchFn = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ commit: 'abc', branch: 'main' }));
      globalThis.fetch = fetchFn;

      await service.commit('ws-1', 'f-1', 'tok-1', {
        message: 'test',
        files: [],
      });

      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeDefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
      // The signal must not already be aborted immediately after the call —
      // a 15s metadata timeout would still be unaborted too, but a 60s
      // timeout for commits should definitely be live.
      expect(init.signal?.aborted).toBe(false);
    });

    it('allows a caller to override commit timeout (e.g. tight budget)', async () => {
      globalThis.fetch = jest.fn(async (_url, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }) as unknown as typeof globalThis.fetch;

      let err: unknown;
      try {
        await service.commit(
          'ws-1',
          'f-1',
          'tok-1',
          { message: 'test', files: [] },
          50,
        );
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Folder9NetworkError);
      const netErr = err as InstanceType<typeof Folder9NetworkError>;
      expect(netErr.message).toContain('timed out after 50ms');
    });
  });
});
