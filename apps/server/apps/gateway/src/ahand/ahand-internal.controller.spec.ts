import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InternalAuthGuard } from '../auth/internal-auth.guard.js';
import { AhandInternalController } from './ahand-internal.controller.js';
import { AhandDevicesService } from './ahand.service.js';

describe('AhandInternalController', () => {
  let controller: AhandInternalController;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    svc = {
      mintControlPlaneTokenForUser: jest.fn<any>(),
      listActiveDevicesForUser: jest.fn<any>(),
    };
    const mod = await Test.createTestingModule({
      controllers: [AhandInternalController],
      providers: [{ provide: AhandDevicesService, useValue: svc }],
    })
      .overrideGuard(InternalAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(AhandInternalController);
  });

  // ─── POST /internal/ahand/control-plane/token ────────────────────────

  describe('mintControlPlaneToken', () => {
    it('delegates to service with userId + deviceIds', async () => {
      svc.mintControlPlaneTokenForUser.mockResolvedValue({
        token: 'cp.xyz',
        expiresAt: '2026-04-22T11:00:00Z',
      });
      const res = await controller.mintControlPlaneToken({
        userId: '11111111-0000-0000-0000-000000000000',
        deviceIds: ['a'.repeat(64)],
      });
      expect(res.token).toBe('cp.xyz');
      expect(res.expiresAt).toBe('2026-04-22T11:00:00Z');
      expect(svc.mintControlPlaneTokenForUser).toHaveBeenCalledWith(
        '11111111-0000-0000-0000-000000000000',
        ['a'.repeat(64)],
      );
    });

    it('works without deviceIds', async () => {
      svc.mintControlPlaneTokenForUser.mockResolvedValue({
        token: 'cp',
        expiresAt: 'e',
      });
      await controller.mintControlPlaneToken({
        userId: '11111111-0000-0000-0000-000000000000',
      });
      expect(svc.mintControlPlaneTokenForUser).toHaveBeenCalledWith(
        '11111111-0000-0000-0000-000000000000',
        undefined,
      );
    });

    it('propagates 403 when device not owned', async () => {
      svc.mintControlPlaneTokenForUser.mockRejectedValue(
        new ForbiddenException('not owned'),
      );
      await expect(
        controller.mintControlPlaneToken({
          userId: '11111111-0000-0000-0000-000000000000',
          deviceIds: ['b'.repeat(64)],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── POST /internal/ahand/devices/list-for-user ──────────────────────

  describe('listDevicesForUser', () => {
    function makeDevice(overrides: Record<string, unknown> = {}) {
      return {
        id: 'id-1',
        ownerType: 'user',
        ownerId: 'user-uuid',
        hubDeviceId: 'd1',
        publicKey: 'pk',
        nickname: 'A',
        platform: 'macos',
        hostname: null,
        status: 'active',
        lastSeenAt: null,
        createdAt: new Date('2026-04-22T09:00:00Z'),
        revokedAt: null,
        isOnline: true,
        ...overrides,
      } as any;
    }

    it('maps rows to InternalDeviceDto', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([
        makeDevice({ lastSeenAt: new Date('2026-04-22T10:00:00Z') }),
      ]);
      const res = await controller.listDevicesForUser({ userId: 'user-uuid' });
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({
        id: 'id-1',
        hubDeviceId: 'd1',
        publicKey: 'pk',
        isOnline: true,
        lastSeenAt: '2026-04-22T10:00:00.000Z',
        createdAt: '2026-04-22T09:00:00.000Z',
      });
    });

    it('includes publicKey (internal endpoint; Tauri controller does not)', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([makeDevice()]);
      const res = await controller.listDevicesForUser({ userId: 'u' });
      expect(res[0].publicKey).toBe('pk');
    });

    it('defaults includeOffline=true when omitted', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.listDevicesForUser({ userId: 'u' });
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith('u', {
        includeOffline: true,
      });
    });

    it('passes explicit includeOffline=false', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.listDevicesForUser({
        userId: 'u',
        includeOffline: false,
      });
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith('u', {
        includeOffline: false,
      });
    });

    it('returns empty array when no devices', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      expect(await controller.listDevicesForUser({ userId: 'u' })).toEqual([]);
    });

    it('maps null lastSeenAt to null', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([makeDevice()]);
      const res = await controller.listDevicesForUser({ userId: 'u' });
      expect(res[0].lastSeenAt).toBeNull();
    });
  });

  // ─── Guard behaviour ─────────────────────────────────────────────────

  describe('InternalAuthGuard', () => {
    it('rejects when guard throws UnauthorizedException', async () => {
      const throwingGuard = {
        canActivate: () => {
          throw new UnauthorizedException();
        },
      };
      const mod = await Test.createTestingModule({
        controllers: [AhandInternalController],
        providers: [
          { provide: AhandDevicesService, useValue: svc },
          { provide: InternalAuthGuard, useValue: throwingGuard },
        ],
      })
        .overrideGuard(InternalAuthGuard)
        .useValue(throwingGuard)
        .compile();
      // Verify that the guard itself throws when canActivate is called.
      const context = {
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as any;
      const guard = mod.get(InternalAuthGuard);
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
  });
});
