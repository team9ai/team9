import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { WsAuthGuard } from '@team9/auth';
import { AhandEventsGateway } from './ahand-events.gateway.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

// Workspace service mock — exposes isWorkspaceMember.
function makeWorkspaceSvc() {
  return { isWorkspaceMember: jest.fn<any>().mockResolvedValue(true) };
}

function makeServer() {
  const emitFn = jest.fn<any>();
  const toFn = jest.fn<any>().mockReturnValue({ emit: emitFn });
  return { to: toFn, _emit: emitFn };
}

function makeClient(userId: string | null) {
  return {
    data: userId ? { user: { id: userId } } : {},
    join: jest.fn<any>().mockResolvedValue(undefined),
    leave: jest.fn<any>().mockResolvedValue(undefined),
  } as any;
}

describe('AhandEventsGateway', () => {
  let gateway: AhandEventsGateway;
  let workspaceSvc: ReturnType<typeof makeWorkspaceSvc>;

  beforeEach(async () => {
    workspaceSvc = makeWorkspaceSvc();
    const mod = await Test.createTestingModule({
      providers: [
        AhandEventsGateway,
        { provide: WorkspaceService, useValue: workspaceSvc },
      ],
    })
      .overrideGuard(WsAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    gateway = mod.get(AhandEventsGateway);
    // Inject fake server.
    const srv = makeServer();
    (gateway as unknown as { server: unknown }).server = srv;
  });

  // ─── emitToOwner ──────────────────────────────────────────────────────────

  describe('emitToOwner', () => {
    it('emits to user:{id}:ahand with ahand: prefixed event', () => {
      const srv = makeServer();
      (gateway as unknown as { server: unknown }).server = srv;
      gateway.emitToOwner('user', 'u1', 'device.online', { hubDeviceId: 'd1' });
      expect(srv.to).toHaveBeenCalledWith('user:u1:ahand');
      expect(srv._emit).toHaveBeenCalledWith('ahand:device.online', {
        hubDeviceId: 'd1',
      });
    });

    it('emits to workspace:{id}:ahand', () => {
      const srv = makeServer();
      (gateway as unknown as { server: unknown }).server = srv;
      gateway.emitToOwner('workspace', 'w1', 'device.revoked', {});
      expect(srv.to).toHaveBeenCalledWith('workspace:w1:ahand');
    });

    it('logs warning and does not throw when server is null', () => {
      (gateway as unknown as { server: unknown }).server = null as any;
      expect(() =>
        gateway.emitToOwner('user', 'u1', 'device.online', {}),
      ).not.toThrow();
    });
  });

  // ─── onJoinRoom ─────────────────────────────────────────────────────────

  describe('onJoinRoom', () => {
    it('allows user to join their own room', async () => {
      const client = makeClient('u1');
      const res = await gateway.onJoinRoom(client, { room: 'user:u1:ahand' });
      expect(res.ok).toBe(true);
      expect(client.join).toHaveBeenCalledWith('user:u1:ahand');
    });

    it("rejects user joining another user's room", async () => {
      const client = makeClient('u1');
      const res = await gateway.onJoinRoom(client, { room: 'user:u2:ahand' });
      expect(res.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('allows workspace member to join workspace room', async () => {
      workspaceSvc.isWorkspaceMember.mockResolvedValue(true);
      const client = makeClient('u1');
      const res = await gateway.onJoinRoom(client, {
        room: 'workspace:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:ahand',
      });
      expect(res.ok).toBe(true);
    });

    it('rejects non-member from workspace room', async () => {
      workspaceSvc.isWorkspaceMember.mockResolvedValue(false);
      const client = makeClient('u1');
      const res = await gateway.onJoinRoom(client, {
        room: 'workspace:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:ahand',
      });
      expect(res.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects malformed room string', async () => {
      const client = makeClient('u1');
      const res = await gateway.onJoinRoom(client, { room: 'garbage' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Invalid room format/);
    });

    it('rejects unauthenticated socket', async () => {
      const client = makeClient(null);
      const res = await gateway.onJoinRoom(client, { room: 'user:u1:ahand' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Unauthenticated/);
    });

    it('handles null/undefined body gracefully', async () => {
      const client = makeClient('u1');
      const res = await gateway.onJoinRoom(client, undefined as any);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Invalid room format/);
    });
  });

  // ─── onLeaveRoom ────────────────────────────────────────────────────────

  describe('onLeaveRoom', () => {
    it('calls client.leave with room name', async () => {
      const client = makeClient('u1');
      const res = await gateway.onLeaveRoom(client, { room: 'user:u1:ahand' });
      expect(res.ok).toBe(true);
      expect(client.leave).toHaveBeenCalledWith('user:u1:ahand');
    });

    it('handles missing room in body gracefully', async () => {
      const client = makeClient('u1');
      const res = await gateway.onLeaveRoom(client, undefined as any);
      expect(res.ok).toBe(true);
      expect(client.leave).toHaveBeenCalledWith('');
    });
  });
});
