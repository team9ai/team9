import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { validate } from 'class-validator';
import { RedisService } from '@team9/redis';

type MockFn = jest.Mock<(...args: any[]) => any>;

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  kind: 'eq',
  field,
  value,
}));
const mockAnd = jest.fn((...conditions: unknown[]) => ({
  kind: 'and',
  conditions,
}));
const mockOr = jest.fn((...conditions: unknown[]) => ({
  kind: 'or',
  conditions,
}));
const mockLike = jest.fn((field: unknown, value: unknown) => ({
  kind: 'like',
  field,
  value,
}));
const mockSql = jest.fn();
const mockInArray = jest.fn((field: unknown, values: unknown[]) => ({
  kind: 'inArray',
  field,
  values,
}));
const mockIsNull = jest.fn((field: unknown) => ({
  kind: 'isNull',
  field,
}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  or: mockOr,
  like: mockLike,
  sql: mockSql,
  inArray: mockInArray,
  isNull: mockIsNull,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  users: {
    id: 'users.id',
    email: 'users.email',
    username: 'users.username',
    displayName: 'users.displayName',
    avatarUrl: 'users.avatarUrl',
    status: 'users.status',
    lastSeenAt: 'users.lastSeenAt',
    userType: 'users.userType',
    updatedAt: 'users.updatedAt',
  },
  files: {
    id: 'files.id',
    visibility: 'files.visibility',
    uploaderId: 'files.uploaderId',
  },
  tenantMembers: {
    userId: 'tenantMembers.userId',
    tenantId: 'tenantMembers.tenantId',
    leftAt: 'tenantMembers.leftAt',
  },
}));

const { UsersService } = await import('./users.service.js');
const { DATABASE_CONNECTION } = await import('@team9/database');
const schema = await import('@team9/database/schemas');
const { UpdateUserDto } = await import('./dto/update-user.dto.js');

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'update',
    'set',
    'returning',
  ];
  for (const method of methods) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

describe('UsersService', () => {
  let service: UsersService;
  let db: ReturnType<typeof mockDb>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.API_URL = 'https://api.team9.test';
    db = mockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DATABASE_CONNECTION, useValue: db },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn<any>().mockResolvedValue(null),
            set: jest.fn<any>().mockResolvedValue(undefined),
            del: jest.fn<any>().mockResolvedValue(undefined),
            hget: jest.fn<any>().mockResolvedValue(null),
            hset: jest.fn<any>().mockResolvedValue(undefined),
            hdel: jest.fn<any>().mockResolvedValue(undefined),
            hgetall: jest.fn<any>().mockResolvedValue({}),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn<any>() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('update', () => {
    it('should update the current user username when it is unique', async () => {
      const returnedUser = {
        id: 'user-uuid',
        email: 'alice@test.com',
        username: 'new-user-name',
        displayName: 'Alice',
        avatarUrl: null,
        status: 'offline',
        lastSeenAt: null,
        userType: 'human',
      };

      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([returnedUser]);

      const result = await service.update('user-uuid', {
        username: 'new-user-name',
      } as any);

      expect(db.select).toHaveBeenCalledWith({ id: schema.users.id });
      expect(db.update).toHaveBeenCalledWith(schema.users);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'new-user-name',
          updatedAt: expect.any(Date),
        }),
      );
      expect(result).toEqual(returnedUser);
    });

    it('should reject a username that is already taken by another user', async () => {
      db.limit.mockResolvedValueOnce([{ id: 'other-user' }]);

      await expect(
        service.update('user-uuid', { username: 'taken-name' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should map a late unique violation to a conflict error', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockImplementationOnce(async () => {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint'),
          { code: '23505' },
        );
      });

      await expect(
        service.update('user-uuid', { username: 'race-name' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should accept a Team9 public file avatar URL owned by the current user', async () => {
      const fileId = '123e4567-e89b-12d3-a456-426614174000';
      const returnedUser = {
        id: 'user-uuid',
        email: 'alice@test.com',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: `https://api.team9.test/api/v1/files/public/file/${fileId}`,
        status: 'offline',
        lastSeenAt: null,
        userType: 'human',
      };

      db.limit.mockResolvedValueOnce([
        { id: fileId, visibility: 'public', uploaderId: 'user-uuid' },
      ]);
      db.returning.mockResolvedValueOnce([returnedUser]);

      await expect(
        service.update('user-uuid', {
          avatarUrl: `https://api.team9.test/api/v1/files/public/file/${fileId}`,
        } as any),
      ).resolves.toEqual(returnedUser);
    });

    it('should reject an arbitrary third-party avatar URL', async () => {
      await expect(
        service.update('user-uuid', {
          avatarUrl: 'https://tracker.example.com/pixel.png',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a public-file-shaped avatar URL from an untrusted origin', async () => {
      await expect(
        service.update('user-uuid', {
          avatarUrl:
            'https://evil.example/api/v1/files/public/file/123e4567-e89b-12d3-a456-426614174000',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a Team9 public file avatar URL not owned by the current user', async () => {
      const fileId = '123e4567-e89b-12d3-a456-426614174001';
      db.limit.mockResolvedValueOnce([
        { id: fileId, visibility: 'public', uploaderId: 'other-user' },
      ]);

      await expect(
        service.update('user-uuid', {
          avatarUrl: `https://api.team9.test/api/v1/files/public/file/${fileId}`,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('UpdateUserDto validation', () => {
    it('should accept usernames with underscores as well as lowercase letters, numbers, and hyphens', async () => {
      const dto = Object.assign(new UpdateUserDto(), {
        username: 'new_user-123',
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should reject usernames with invalid characters', async () => {
      const dto = Object.assign(new UpdateUserDto(), {
        username: 'Bad_User',
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'username')).toBe(true);
    });
  });
});
