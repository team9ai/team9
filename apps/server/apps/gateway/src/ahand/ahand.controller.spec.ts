import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@team9/auth';
import { AhandController } from './ahand.controller.js';
import { AhandDevicesService } from './ahand.service.js';

const testUser = { id: 'u1', email: 'u@t.co' } as any;

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    ownerType: 'user',
    ownerId: 'u1',
    hubDeviceId: 'd1',
    publicKey: 'pk',
    nickname: 'A',
    platform: 'macos',
    hostname: null,
    status: 'active',
    lastSeenAt: null,
    createdAt: new Date('2026-04-22T09:00:00Z'),
    revokedAt: null,
    isOnline: false,
    ...overrides,
  } as any;
}

describe('AhandController', () => {
  let controller: AhandController;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    svc = {
      registerDeviceForUser: jest.fn<any>(),
      listActiveDevicesForUser: jest.fn<any>(),
      refreshDeviceToken: jest.fn<any>(),
      patchDevice: jest.fn<any>(),
      revokeDevice: jest.fn<any>(),
    };
    const mod = await Test.createTestingModule({
      controllers: [AhandController],
      providers: [{ provide: AhandDevicesService, useValue: svc }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(AhandController);
  });

  // ─── POST /devices ──────────────────────────────────────────────────

  describe('register', () => {
    it('propagates ConflictException from service', async () => {
      svc.registerDeviceForUser.mockRejectedValue(
        new ConflictException('Device already registered'),
      );
      await expect(
        controller.register(testUser, {
          hubDeviceId: 'a'.repeat(64),
          publicKey: 'pk',
          nickname: 'A',
          platform: 'macos',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 201 shape with device + JWT', async () => {
      const row = makeRow({ hubDeviceId: 'a'.repeat(64), nickname: 'MyMac' });
      svc.registerDeviceForUser.mockResolvedValue({
        device: row,
        deviceJwt: 'jwt.x',
        hubUrl: 'https://hub',
        jwtExpiresAt: '2026-04-29T10:00:00Z',
      });
      const res = await controller.register(testUser, {
        hubDeviceId: 'a'.repeat(64),
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });
      expect(res.deviceJwt).toBe('jwt.x');
      expect(res.device.hubDeviceId).toBe('a'.repeat(64));
      expect(res.device.status).toBe('active');
      expect(res.device.isOnline).toBe(false);
      expect(svc.registerDeviceForUser).toHaveBeenCalledWith('u1', {
        hubDeviceId: 'a'.repeat(64),
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });
    });

    it('uses lastSeenAt ISO string when present', async () => {
      const row = makeRow({ lastSeenAt: new Date('2026-04-22T10:00:00Z') });
      svc.registerDeviceForUser.mockResolvedValue({
        device: row,
        deviceJwt: 'jwt',
        hubUrl: 'h',
        jwtExpiresAt: 'e',
      });
      const res = await controller.register(testUser, {
        hubDeviceId: 'a'.repeat(64),
        publicKey: 'pk',
        nickname: 'A',
        platform: 'macos',
      });
      expect(res.device.lastSeenAt).toBe('2026-04-22T10:00:00.000Z');
    });
  });

  // ─── GET /devices ───────────────────────────────────────────────────

  describe('list', () => {
    it('defaults includeOffline=true when param omitted', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.list(testUser, undefined);
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith('u1', {
        includeOffline: true,
      });
    });

    it('passes includeOffline=false when "false" string', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.list(testUser, 'false');
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith('u1', {
        includeOffline: false,
      });
    });

    it('any value other than "false" → includeOffline=true', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      await controller.list(testUser, 'true');
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith('u1', {
        includeOffline: true,
      });
    });

    it('maps rows to DTOs including ISO timestamps', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([
        makeRow({
          lastSeenAt: new Date('2026-04-22T10:00:00Z'),
          isOnline: true,
          hostname: 'hA',
        }),
      ]);
      const dtos = await controller.list(testUser, 'true');
      expect(dtos).toHaveLength(1);
      expect(dtos[0]).toMatchObject({
        id: 'uuid-1',
        status: 'active',
        isOnline: true,
        hostname: 'hA',
        lastSeenAt: '2026-04-22T10:00:00.000Z',
        createdAt: '2026-04-22T09:00:00.000Z',
      });
    });

    it('returns empty array when service returns nothing', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);
      expect(await controller.list(testUser)).toEqual([]);
    });
  });

  // ─── POST /devices/:id/token/refresh ───────────────────────────────

  describe('refreshToken', () => {
    const uuid = '11111111-1111-1111-1111-111111111111';

    it('returns JWT pair', async () => {
      svc.refreshDeviceToken.mockResolvedValue({ token: 't', expiresAt: 'e' });
      const res = await controller.refreshToken(testUser, uuid);
      expect(res).toEqual({ deviceJwt: 't', jwtExpiresAt: 'e' });
    });

    it('404 from service propagates unchanged', async () => {
      svc.refreshDeviceToken.mockRejectedValue(
        new NotFoundException('Device not found'),
      );
      await expect(controller.refreshToken(testUser, uuid)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Conflict when device is revoked propagates', async () => {
      svc.refreshDeviceToken.mockRejectedValue(
        new ConflictException('Device has been revoked'),
      );
      await expect(
        controller.refreshToken(
          testUser,
          '11111111-1111-1111-1111-111111111111',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── PATCH /devices/:id ─────────────────────────────────────────────

  describe('patch', () => {
    const uuid = '11111111-1111-1111-1111-111111111111';

    it('returns updated DTO with isOnline=null', async () => {
      svc.patchDevice.mockResolvedValue(makeRow({ nickname: 'New' }));
      const res = await controller.patch(testUser, uuid, { nickname: 'New' });
      expect(res.nickname).toBe('New');
      expect(res.isOnline).toBeNull();
    });

    it('propagates NotFoundException from service', async () => {
      svc.patchDevice.mockRejectedValue(
        new NotFoundException('Device not found'),
      );
      await expect(
        controller.patch(testUser, '11111111-1111-1111-1111-111111111111', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates ConflictException from service', async () => {
      svc.patchDevice.mockRejectedValue(
        new ConflictException('Device has been revoked'),
      );
      await expect(
        controller.patch(testUser, '11111111-1111-1111-1111-111111111111', {}),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── DELETE /devices/:id ────────────────────────────────────────────

  describe('delete', () => {
    const uuid = '11111111-1111-1111-1111-111111111111';

    it('resolves to undefined (204)', async () => {
      svc.revokeDevice.mockResolvedValue(undefined);
      await expect(controller.delete(testUser, uuid)).resolves.toBeUndefined();
    });

    it('propagates ConflictException from service', async () => {
      svc.revokeDevice.mockRejectedValue(
        new ConflictException('already revoked'),
      );
      await expect(controller.delete(testUser, uuid)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── DTO validation ─────────────────────────────────────────────────

  describe('DTO validation via ValidationPipe', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it('RegisterDeviceDto rejects non-hex hubDeviceId', async () => {
      const { RegisterDeviceDto } =
        await import('./dto/register-device.dto.js');
      await expect(
        pipe.transform(
          {
            hubDeviceId: 'nothex',
            publicKey: 'p',
            nickname: 'A',
            platform: 'macos',
          },
          { type: 'body', metatype: RegisterDeviceDto },
        ),
      ).rejects.toThrow();
    });

    it('RegisterDeviceDto rejects unknown platform', async () => {
      const { RegisterDeviceDto } =
        await import('./dto/register-device.dto.js');
      await expect(
        pipe.transform(
          {
            hubDeviceId: 'a'.repeat(64),
            publicKey: 'p',
            nickname: 'A',
            platform: 'ios',
          },
          { type: 'body', metatype: RegisterDeviceDto },
        ),
      ).rejects.toThrow();
    });

    it('RegisterDeviceDto rejects unknown fields (forbidNonWhitelisted)', async () => {
      const { RegisterDeviceDto } =
        await import('./dto/register-device.dto.js');
      await expect(
        pipe.transform(
          {
            hubDeviceId: 'a'.repeat(64),
            publicKey: 'p',
            nickname: 'A',
            platform: 'macos',
            evil: 'payload',
          },
          { type: 'body', metatype: RegisterDeviceDto },
        ),
      ).rejects.toThrow();
    });

    it('PatchDeviceDto accepts empty patch', async () => {
      const { PatchDeviceDto } = await import('./dto/patch-device.dto.js');
      const result = await pipe.transform(
        {},
        { type: 'body', metatype: PatchDeviceDto },
      );
      expect(result).toEqual({});
    });

    it('PatchDeviceDto rejects nickname > 120 chars', async () => {
      const { PatchDeviceDto } = await import('./dto/patch-device.dto.js');
      await expect(
        pipe.transform(
          { nickname: 'x'.repeat(121) },
          { type: 'body', metatype: PatchDeviceDto },
        ),
      ).rejects.toThrow();
    });
  });
});
