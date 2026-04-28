import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

import { Folder9Client } from './folder9.client.js';
import { Folder9ApiError, Folder9NetworkError } from './folder9.types.js';

const ORIGINAL_API_URL = process.env.FOLDER9_API_URL;
const ORIGINAL_PSK = process.env.FOLDER9_PSK;

const mockFetch = jest.fn<typeof globalThis.fetch>();

describe('Folder9Client', () => {
  let client: Folder9Client;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FOLDER9_API_URL = 'https://folder9.example.com';
    process.env.FOLDER9_PSK = 'test-psk';
    globalThis.fetch = mockFetch as any;
    mockFetch.mockReset();
    client = new Folder9Client();
  });

  afterEach(() => {
    if (ORIGINAL_API_URL === undefined) delete process.env.FOLDER9_API_URL;
    else process.env.FOLDER9_API_URL = ORIGINAL_API_URL;
    if (ORIGINAL_PSK === undefined) delete process.env.FOLDER9_PSK;
    else process.env.FOLDER9_PSK = ORIGINAL_PSK;
  });

  describe('configuration errors', () => {
    it('throws when FOLDER9_API_URL is missing', async () => {
      delete process.env.FOLDER9_API_URL;
      await expect(
        client.createFolder('ws-1', {
          name: 'r',
          type: 'managed',
          owner_type: 'workspace',
          owner_id: 'ws-1',
        }),
      ).rejects.toThrow(/FOLDER9_API_URL/);
    });

    it('throws when FOLDER9_PSK is missing', async () => {
      delete process.env.FOLDER9_PSK;
      await expect(
        client.createFolder('ws-1', {
          name: 'r',
          type: 'managed',
          owner_type: 'workspace',
          owner_id: 'ws-1',
        }),
      ).rejects.toThrow(/FOLDER9_PSK/);
    });

    it('strips trailing slash from FOLDER9_API_URL', async () => {
      process.env.FOLDER9_API_URL = 'https://folder9.example.com/';
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'f-1' }), { status: 200 }),
      );

      await client.createFolder('ws-1', {
        name: 'r',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'ws-1',
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe(
        'https://folder9.example.com/api/workspaces/ws-1/folders',
      );
    });
  });

  describe('createFolder', () => {
    it('POSTs to /api/workspaces/{wsId}/folders with PSK auth', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'f-1',
            name: 'r',
            type: 'managed',
            owner_type: 'workspace',
            owner_id: 'ws-1',
            workspace_id: 'ws-1',
            approval_mode: 'auto',
            created_at: 'now',
            updated_at: 'now',
          }),
          { status: 200 },
        ),
      );

      const folder = await client.createFolder('ws-1', {
        name: 'r',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'ws-1',
        approval_mode: 'auto',
      });

      expect(folder.id).toBe('f-1');
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer test-psk',
      );
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
    });
  });

  describe('createToken', () => {
    it('POSTs to /api/tokens with PSK auth', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 't-1',
            token: 'opaque',
            folder_id: 'f-1',
            permission: 'read',
            name: 'x',
            created_by: 'routine:r',
            created_at: 'now',
          }),
          { status: 200 },
        ),
      );

      const result = await client.createToken({
        folder_id: 'f-1',
        permission: 'read',
        name: 'x',
        created_by: 'routine:r',
      });

      expect(result.token).toBe('opaque');
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://folder9.example.com/api/tokens');
    });
  });

  describe('commit', () => {
    it('POSTs to /commit with bearer token (not PSK)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ commit: 'sha', branch: 'main' }), {
          status: 200,
        }),
      );

      await client.commit('ws-1', 'f-1', 'opaque-token', {
        message: 'hi',
        files: [{ path: 'SKILL.md', action: 'create', content: '...' }],
      });

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer opaque-token',
      );
    });
  });

  describe('error mapping', () => {
    it('throws Folder9ApiError on non-2xx', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"error":"nope"}', { status: 503 }),
      );

      await expect(
        client.createToken({
          folder_id: 'f',
          permission: 'read',
          name: 'x',
          created_by: 'y',
        }),
      ).rejects.toBeInstanceOf(Folder9ApiError);
    });

    it('parses non-JSON error bodies as text', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('plain text error', { status: 500 }),
      );

      await expect(
        client.createToken({
          folder_id: 'f',
          permission: 'read',
          name: 'x',
          created_by: 'y',
        }),
      ).rejects.toMatchObject({
        name: 'Folder9ApiError',
        status: 500,
        body: 'plain text error',
      });
    });

    it('returns parsed undefined on empty 2xx body', async () => {
      // Use 200 with empty body — Response constructor rejects 204 with body.
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const result = await client.createToken({
        folder_id: 'f',
        permission: 'read',
        name: 'x',
        created_by: 'y',
      });

      expect(result).toBeUndefined();
    });

    it('throws Folder9NetworkError on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        client.createToken({
          folder_id: 'f',
          permission: 'read',
          name: 'x',
          created_by: 'y',
        }),
      ).rejects.toBeInstanceOf(Folder9NetworkError);
    });

    it('maps AbortError (timeout) to Folder9NetworkError with timeout message', async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(err);

      await expect(
        client.createToken({
          folder_id: 'f',
          permission: 'read',
          name: 'x',
          created_by: 'y',
        }),
      ).rejects.toMatchObject({
        name: 'Folder9NetworkError',
        message: expect.stringContaining('timed out'),
      });
    });
  });
});
