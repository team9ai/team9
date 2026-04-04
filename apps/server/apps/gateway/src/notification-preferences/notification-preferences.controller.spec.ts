import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { NotificationPreferencesController } from './notification-preferences.controller.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { AuthGuard } from '@team9/auth';

// ── helpers ──────────────────────────────────────────────────────────

function mockPreferencesService() {
  return {
    getPreferences: jest.fn<any>(),
    upsertPreferences: jest.fn<any>(),
    shouldNotify: jest.fn<any>(),
  };
}

const DEFAULT_PREFS = {
  mentionsEnabled: true,
  repliesEnabled: true,
  dmsEnabled: true,
  systemEnabled: true,
  workspaceEnabled: true,
  desktopEnabled: true,
  soundEnabled: true,
  dndEnabled: false,
  dndStart: null,
  dndEnd: null,
  settings: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('NotificationPreferencesController (integration)', () => {
  let app: INestApplication;
  let preferencesService: ReturnType<typeof mockPreferencesService>;

  beforeEach(async () => {
    preferencesService = mockPreferencesService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationPreferencesController],
      providers: [
        {
          provide: NotificationPreferencesService,
          useValue: preferencesService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: 'user-uuid', email: 'alice@test.com' };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /v1/notification-preferences ──────────────────────────────

  describe('GET /api/v1/notification-preferences', () => {
    it('should return 200 with default preferences', async () => {
      preferencesService.getPreferences.mockResolvedValue(DEFAULT_PREFS);

      const res = await request(app.getHttpServer())
        .get('/api/v1/notification-preferences')
        .expect(200);

      expect(res.body.mentionsEnabled).toBe(true);
      expect(res.body.repliesEnabled).toBe(true);
      expect(res.body.dmsEnabled).toBe(true);
      expect(res.body.systemEnabled).toBe(true);
      expect(res.body.workspaceEnabled).toBe(true);
      expect(res.body.desktopEnabled).toBe(true);
      expect(res.body.soundEnabled).toBe(true);
      expect(res.body.dndEnabled).toBe(false);
      expect(res.body.dndStart).toBeNull();
      expect(res.body.dndEnd).toBeNull();
      expect(preferencesService.getPreferences).toHaveBeenCalledWith(
        'user-uuid',
      );
    });

    it('should return stored preferences with custom values', async () => {
      preferencesService.getPreferences.mockResolvedValue({
        ...DEFAULT_PREFS,
        mentionsEnabled: false,
        dndEnabled: true,
        dndStart: new Date('2025-01-01T22:00:00Z'),
        dndEnd: new Date('2025-01-02T07:00:00Z'),
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/notification-preferences')
        .expect(200);

      expect(res.body.mentionsEnabled).toBe(false);
      expect(res.body.dndEnabled).toBe(true);
      expect(res.body.dndStart).toBe('2025-01-01T22:00:00.000Z');
      expect(res.body.dndEnd).toBe('2025-01-02T07:00:00.000Z');
    });
  });

  // ── PATCH /v1/notification-preferences ────────────────────────────

  describe('PATCH /api/v1/notification-preferences', () => {
    it('should return 200 and updated preferences', async () => {
      const updatedPrefs = {
        ...DEFAULT_PREFS,
        mentionsEnabled: false,
      };
      preferencesService.upsertPreferences.mockResolvedValue(updatedPrefs);

      const res = await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ mentionsEnabled: false })
        .expect(200);

      expect(res.body.mentionsEnabled).toBe(false);
      expect(preferencesService.upsertPreferences).toHaveBeenCalledWith(
        'user-uuid',
        { mentionsEnabled: false },
      );
    });

    it('should accept multiple fields at once', async () => {
      const dto = {
        mentionsEnabled: false,
        repliesEnabled: false,
        dndEnabled: true,
        dndStart: '2025-01-01T22:00:00.000Z',
        dndEnd: '2025-01-02T07:00:00.000Z',
      };
      preferencesService.upsertPreferences.mockResolvedValue({
        ...DEFAULT_PREFS,
        ...dto,
        dndStart: new Date(dto.dndStart),
        dndEnd: new Date(dto.dndEnd),
      });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send(dto)
        .expect(200);

      expect(res.body.mentionsEnabled).toBe(false);
      expect(res.body.repliesEnabled).toBe(false);
      expect(res.body.dndEnabled).toBe(true);
      expect(preferencesService.upsertPreferences).toHaveBeenCalledWith(
        'user-uuid',
        dto,
      );
    });

    it('should accept empty body', async () => {
      preferencesService.upsertPreferences.mockResolvedValue(DEFAULT_PREFS);

      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({})
        .expect(200);

      expect(preferencesService.upsertPreferences).toHaveBeenCalledWith(
        'user-uuid',
        {},
      );
    });

    it('should reject non-boolean mentionsEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ mentionsEnabled: 'not-a-boolean' })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean repliesEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ repliesEnabled: 123 })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean dmsEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ dmsEnabled: 'yes' })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean systemEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ systemEnabled: 'yes' })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean workspaceEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ workspaceEnabled: 0 })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean desktopEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ desktopEnabled: 'true' })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean soundEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ soundEnabled: [] })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject non-boolean dndEnabled with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ dndEnabled: 'false' })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject invalid dndStart date string with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ dndStart: 'not-a-date' })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should reject invalid dndEnd date string with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ dndEnd: 12345 })
        .expect(400);

      expect(preferencesService.upsertPreferences).not.toHaveBeenCalled();
    });

    it('should strip unknown fields (whitelist)', async () => {
      preferencesService.upsertPreferences.mockResolvedValue(DEFAULT_PREFS);

      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({ mentionsEnabled: true, malicious: 'payload' })
        .expect(200);

      expect(preferencesService.upsertPreferences).toHaveBeenCalledWith(
        'user-uuid',
        { mentionsEnabled: true },
      );
    });

    it('should accept valid dndStart and dndEnd date strings', async () => {
      preferencesService.upsertPreferences.mockResolvedValue({
        ...DEFAULT_PREFS,
        dndStart: new Date('2025-06-15T22:00:00.000Z'),
        dndEnd: new Date('2025-06-16T07:00:00.000Z'),
      });

      await request(app.getHttpServer())
        .patch('/api/v1/notification-preferences')
        .send({
          dndStart: '2025-06-15T22:00:00.000Z',
          dndEnd: '2025-06-16T07:00:00.000Z',
        })
        .expect(200);

      expect(preferencesService.upsertPreferences).toHaveBeenCalledWith(
        'user-uuid',
        {
          dndStart: '2025-06-15T22:00:00.000Z',
          dndEnd: '2025-06-16T07:00:00.000Z',
        },
      );
    });
  });
});
