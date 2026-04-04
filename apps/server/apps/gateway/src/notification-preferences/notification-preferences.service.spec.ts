import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { DATABASE_CONNECTION } from '@team9/database';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'onConflictDoUpdate',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

const FULL_PREFS_ROW = {
  id: 'pref-uuid',
  userId: 'user-uuid',
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

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let db: ReturnType<typeof mockDb>;

  beforeEach(async () => {
    db = mockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get<NotificationPreferencesService>(
      NotificationPreferencesService,
    );
  });

  // ── getPreferences ──────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('should return default values when no preferences exist', async () => {
      db.limit.mockResolvedValue([]);

      const result = await service.getPreferences('user-uuid');

      expect(result.mentionsEnabled).toBe(true);
      expect(result.repliesEnabled).toBe(true);
      expect(result.dmsEnabled).toBe(true);
      expect(result.systemEnabled).toBe(true);
      expect(result.workspaceEnabled).toBe(true);
      expect(result.desktopEnabled).toBe(true);
      expect(result.soundEnabled).toBe(true);
      expect(result.dndEnabled).toBe(false);
      expect(result.dndStart).toBeNull();
      expect(result.dndEnd).toBeNull();
      expect(result.settings).toBeNull();
      expect(db.select).toHaveBeenCalled();
    });

    it('should return stored preferences when they exist', async () => {
      const storedRow = {
        ...FULL_PREFS_ROW,
        mentionsEnabled: false,
        dndEnabled: true,
      };
      db.limit.mockResolvedValue([storedRow]);

      const result = await service.getPreferences('user-uuid');

      expect(result.mentionsEnabled).toBe(false);
      expect(result.dndEnabled).toBe(true);
      expect(result.repliesEnabled).toBe(true);
    });

    it('should return settings from the stored row', async () => {
      const storedRow = {
        ...FULL_PREFS_ROW,
        settings: { customKey: 'customValue' },
      };
      db.limit.mockResolvedValue([storedRow]);

      const result = await service.getPreferences('user-uuid');

      expect(result.settings).toEqual({ customKey: 'customValue' });
    });
  });

  // ── upsertPreferences ──────────────────────────────────────────────

  describe('upsertPreferences', () => {
    it('should create preferences with provided fields', async () => {
      const returnedRow = {
        ...FULL_PREFS_ROW,
        mentionsEnabled: false,
      };
      db.returning.mockResolvedValue([returnedRow]);

      const result = await service.upsertPreferences('user-uuid', {
        mentionsEnabled: false,
      });

      expect(result.mentionsEnabled).toBe(false);
      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalled();
      expect(db.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('should only update fields present in the DTO', async () => {
      db.returning.mockResolvedValue([
        { ...FULL_PREFS_ROW, soundEnabled: false },
      ]);

      const result = await service.upsertPreferences('user-uuid', {
        soundEnabled: false,
      });

      expect(result.soundEnabled).toBe(false);
      // Verify onConflictDoUpdate was called with the right set fields
      const callArgs = db.onConflictDoUpdate.mock.calls[0][0] as any;
      expect(callArgs.set).toHaveProperty('soundEnabled', false);
      expect(callArgs.set).toHaveProperty('updatedAt');
      expect(callArgs.set).not.toHaveProperty('mentionsEnabled');
    });

    it('should handle DND time fields as Date objects', async () => {
      const dndStart = '2025-01-01T22:00:00.000Z';
      const dndEnd = '2025-01-02T07:00:00.000Z';
      db.returning.mockResolvedValue([
        {
          ...FULL_PREFS_ROW,
          dndEnabled: true,
          dndStart: new Date(dndStart),
          dndEnd: new Date(dndEnd),
        },
      ]);

      const result = await service.upsertPreferences('user-uuid', {
        dndEnabled: true,
        dndStart,
        dndEnd,
      });

      expect(result.dndEnabled).toBe(true);
      expect(result.dndStart).toEqual(new Date(dndStart));
      expect(result.dndEnd).toEqual(new Date(dndEnd));

      const callArgs = db.onConflictDoUpdate.mock.calls[0][0] as any;
      expect(callArgs.set.dndStart).toEqual(new Date(dndStart));
      expect(callArgs.set.dndEnd).toEqual(new Date(dndEnd));
    });

    it('should update all boolean fields when all are provided', async () => {
      const allFalse = {
        mentionsEnabled: false,
        repliesEnabled: false,
        dmsEnabled: false,
        systemEnabled: false,
        workspaceEnabled: false,
        desktopEnabled: false,
        soundEnabled: false,
        dndEnabled: true,
      };
      db.returning.mockResolvedValue([
        {
          ...FULL_PREFS_ROW,
          ...allFalse,
        },
      ]);

      const result = await service.upsertPreferences('user-uuid', allFalse);

      expect(result.mentionsEnabled).toBe(false);
      expect(result.repliesEnabled).toBe(false);
      expect(result.dmsEnabled).toBe(false);
      expect(result.systemEnabled).toBe(false);
      expect(result.workspaceEnabled).toBe(false);
      expect(result.desktopEnabled).toBe(false);
      expect(result.soundEnabled).toBe(false);
      expect(result.dndEnabled).toBe(true);
    });

    it('should handle empty DTO (only updatedAt changes)', async () => {
      db.returning.mockResolvedValue([FULL_PREFS_ROW]);

      await service.upsertPreferences('user-uuid', {});

      const callArgs = db.onConflictDoUpdate.mock.calls[0][0] as any;
      // Only updatedAt should be in the set clause
      expect(Object.keys(callArgs.set)).toEqual(['updatedAt']);
    });

    it('should handle null dndStart and dndEnd (clearing DND times)', async () => {
      db.returning.mockResolvedValue([
        {
          ...FULL_PREFS_ROW,
          dndStart: null,
          dndEnd: null,
        },
      ]);

      await service.upsertPreferences('user-uuid', {
        dndStart: null,
        dndEnd: null,
      });

      // Insert fields should have null, not epoch Date
      const insertCallArgs = db.values.mock.calls[0][0] as any;
      expect(insertCallArgs.dndStart).toBeNull();
      expect(insertCallArgs.dndEnd).toBeNull();

      // Update fields should also have null
      const updateCallArgs = db.onConflictDoUpdate.mock.calls[0][0] as any;
      expect(updateCallArgs.set.dndStart).toBeNull();
      expect(updateCallArgs.set.dndEnd).toBeNull();
    });
  });

  // ── shouldNotify ──────────────────────────────────────────────────

  describe('shouldNotify', () => {
    // Helper to set up mock preferences
    function setupPrefs(overrides: Partial<typeof FULL_PREFS_ROW> = {}) {
      db.limit.mockResolvedValue([{ ...FULL_PREFS_ROW, ...overrides }]);
    }

    // ── Mention types ─────────────────────────────────────────────

    describe('mention types', () => {
      it.each([
        'mention',
        'channel_mention',
        'everyone_mention',
        'here_mention',
      ])(
        'should return allowed=true for %s when mentionsEnabled is true',
        async (type) => {
          setupPrefs({ mentionsEnabled: true });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'message',
          );
          expect(result.allowed).toBe(true);
          expect(result.preferences).toBeDefined();
        },
      );

      it.each([
        'mention',
        'channel_mention',
        'everyone_mention',
        'here_mention',
      ])(
        'should return allowed=false for %s when mentionsEnabled is false',
        async (type) => {
          setupPrefs({ mentionsEnabled: false });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'message',
          );
          expect(result.allowed).toBe(false);
          expect(result.preferences).toBeDefined();
        },
      );
    });

    // ── Reply types ───────────────────────────────────────────────

    describe('reply types', () => {
      it.each(['reply', 'thread_reply'])(
        'should return allowed=true for %s when repliesEnabled is true',
        async (type) => {
          setupPrefs({ repliesEnabled: true });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'message',
          );
          expect(result.allowed).toBe(true);
        },
      );

      it.each(['reply', 'thread_reply'])(
        'should return allowed=false for %s when repliesEnabled is false',
        async (type) => {
          setupPrefs({ repliesEnabled: false });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'message',
          );
          expect(result.allowed).toBe(false);
        },
      );
    });

    // ── DM type ───────────────────────────────────────────────────

    describe('dm type', () => {
      it('should return allowed=true for dm_received when dmsEnabled is true', async () => {
        setupPrefs({ dmsEnabled: true });
        const result = await service.shouldNotify(
          'user-uuid',
          'dm_received',
          'message',
        );
        expect(result.allowed).toBe(true);
      });

      it('should return allowed=false for dm_received when dmsEnabled is false', async () => {
        setupPrefs({ dmsEnabled: false });
        const result = await service.shouldNotify(
          'user-uuid',
          'dm_received',
          'message',
        );
        expect(result.allowed).toBe(false);
      });
    });

    // ── System types ──────────────────────────────────────────────

    describe('system types', () => {
      it.each(['system_announcement', 'maintenance_notice', 'version_update'])(
        'should return allowed=true for %s when systemEnabled is true',
        async (type) => {
          setupPrefs({ systemEnabled: true });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'system',
          );
          expect(result.allowed).toBe(true);
        },
      );

      it.each(['system_announcement', 'maintenance_notice', 'version_update'])(
        'should return allowed=false for %s when systemEnabled is false',
        async (type) => {
          setupPrefs({ systemEnabled: false });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'system',
          );
          expect(result.allowed).toBe(false);
        },
      );
    });

    // ── Workspace types ───────────────────────────────────────────

    describe('workspace types', () => {
      it.each([
        'workspace_invitation',
        'role_changed',
        'member_joined',
        'member_left',
        'channel_invite',
      ])(
        'should return allowed=true for %s when workspaceEnabled is true',
        async (type) => {
          setupPrefs({ workspaceEnabled: true });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'workspace',
          );
          expect(result.allowed).toBe(true);
        },
      );

      it.each([
        'workspace_invitation',
        'role_changed',
        'member_joined',
        'member_left',
        'channel_invite',
      ])(
        'should return allowed=false for %s when workspaceEnabled is false',
        async (type) => {
          setupPrefs({ workspaceEnabled: false });
          const result = await service.shouldNotify(
            'user-uuid',
            type,
            'workspace',
          );
          expect(result.allowed).toBe(false);
        },
      );
    });

    // ── Unknown type ──────────────────────────────────────────────

    describe('unknown types', () => {
      it('should return allowed=true for unknown notification type', async () => {
        setupPrefs();
        const result = await service.shouldNotify(
          'user-uuid',
          'some_unknown_type',
          'unknown',
        );
        expect(result.allowed).toBe(true);
        expect(result.preferences).toBeDefined();
      });
    });

    // ── DND checks ────────────────────────────────────────────────

    describe('DND behavior', () => {
      it('should return allowed=false when in DND window (same-day range)', async () => {
        const now = new Date();
        const dndStart = new Date(now);
        dndStart.setUTCHours(now.getUTCHours() - 1);
        const dndEnd = new Date(now);
        dndEnd.setUTCHours(now.getUTCHours() + 1);

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(false);
        expect(result.preferences).toBeDefined();
      });

      it('should return allowed=true when outside DND window (same-day range)', async () => {
        const now = new Date();
        const dndStart = new Date(now);
        dndStart.setUTCHours(now.getUTCHours() + 2);
        const dndEnd = new Date(now);
        dndEnd.setUTCHours(now.getUTCHours() + 4);

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(true);
      });

      it('should return allowed=false when in overnight DND window (after start)', async () => {
        const now = new Date();
        // Set DND from 1 hour ago to (tomorrow) a time that wraps around
        const dndStart = new Date(now);
        dndStart.setUTCHours(now.getUTCHours() - 1);
        const dndEnd = new Date(now);
        // End is earlier in the day than start, simulating overnight
        dndEnd.setUTCHours(now.getUTCHours() - 2);

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(false);
      });

      it('should return allowed=false when in overnight DND window (before end, early morning)', async () => {
        const now = new Date();
        // DND end = 1h from now, DND start = 2h from now
        // Since end < start, it's overnight. now < end, so it should block.
        const dndEnd = new Date(now);
        dndEnd.setUTCHours(now.getUTCHours() + 1);
        const dndStart = new Date(now);
        dndStart.setUTCHours(now.getUTCHours() + 2);

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(false);
      });

      it('should return allowed=false when in overnight DND window (fixed UTC: 22:00-06:00, now 03:00)', async () => {
        // Use fake timers to pin "now" at 03:00 UTC for deterministic behavior
        const fakeNow = new Date('2026-04-04T03:00:00.000Z');
        jest.useFakeTimers({ now: fakeNow });

        const dndStart = new Date('2026-04-04T22:00:00.000Z');
        const dndEnd = new Date('2026-04-04T06:00:00.000Z');

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(false);
        expect(result.preferences.dndEnabled).toBe(true);

        jest.useRealTimers();
      });

      it('should return allowed=true when outside overnight DND window (fixed UTC: 22:00-06:00, now 12:00)', async () => {
        // Use fake timers to pin "now" at 12:00 UTC -- outside the overnight window
        const fakeNow = new Date('2026-04-04T12:00:00.000Z');
        jest.useFakeTimers({ now: fakeNow });

        const dndStart = new Date('2026-04-04T22:00:00.000Z');
        const dndEnd = new Date('2026-04-04T06:00:00.000Z');

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(true);

        jest.useRealTimers();
      });

      it('should return allowed=true when DND is disabled even if times match', async () => {
        const now = new Date();
        const dndStart = new Date(now);
        dndStart.setUTCHours(now.getUTCHours() - 1);
        const dndEnd = new Date(now);
        dndEnd.setUTCHours(now.getUTCHours() + 1);

        setupPrefs({
          dndEnabled: false,
          dndStart,
          dndEnd,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(true);
      });

      it('should return allowed=true when DND enabled but no start/end times', async () => {
        setupPrefs({
          dndEnabled: true,
          dndStart: null,
          dndEnd: null,
        });

        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(true);
      });

      it('should return allowed=true when no preferences exist (default)', async () => {
        db.limit.mockResolvedValue([]);
        const result = await service.shouldNotify(
          'user-uuid',
          'mention',
          'message',
        );
        expect(result.allowed).toBe(true);
      });

      it('should block all notification types during DND', async () => {
        const now = new Date();
        const dndStart = new Date(now);
        dndStart.setUTCHours(now.getUTCHours() - 1);
        const dndEnd = new Date(now);
        dndEnd.setUTCHours(now.getUTCHours() + 1);

        setupPrefs({
          dndEnabled: true,
          dndStart,
          dndEnd,
        });

        const types = [
          'mention',
          'reply',
          'dm_received',
          'system_announcement',
          'workspace_invitation',
        ];
        for (const type of types) {
          // Reset mock for each call since getPreferences is called each time
          db.limit.mockResolvedValue([
            {
              ...FULL_PREFS_ROW,
              dndEnabled: true,
              dndStart,
              dndEnd,
            },
          ]);
          const result = await service.shouldNotify('user-uuid', type, 'any');
          expect(result.allowed).toBe(false);
        }
      });
    });
  });
});
