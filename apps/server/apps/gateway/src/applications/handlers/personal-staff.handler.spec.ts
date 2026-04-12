import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { PersonalStaffHandler } from './personal-staff.handler.js';
import type { InstallContext } from './application-handler.interface.js';

describe('PersonalStaffHandler', () => {
  let handler: PersonalStaffHandler;

  // Mocks
  const mockDb = {
    select: jest.fn<any>(),
  };
  const mockModuleRef = {
    get: jest.fn<any>(),
  };
  const mockPersonalStaffService = {
    createStaff: jest.fn<any>(),
  };

  // Helpers
  function buildSelectChain(rows: unknown[]) {
    const chain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(rows),
    };
    mockDb.select.mockReturnValue(chain);
    return chain;
  }

  const baseContext: InstallContext = {
    installedApplication: { id: 'installed-app-1' } as any,
    tenantId: 'tenant-1',
    installedBy: 'user-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockModuleRef.get.mockReturnValue(mockPersonalStaffService);
    handler = new PersonalStaffHandler(mockDb as any, mockModuleRef as any);
  });

  it('should have applicationId "personal-staff"', () => {
    expect(handler.applicationId).toBe('personal-staff');
  });

  it('should return empty result when no human members exist', async () => {
    buildSelectChain([]);

    const result = await handler.onInstall(baseContext);

    expect(result).toEqual({});
    expect(mockPersonalStaffService.createStaff).not.toHaveBeenCalled();
  });

  it('should skip bot-type members', async () => {
    buildSelectChain([
      { userId: 'bot-user-1', userType: 'bot' },
      { userId: 'system-user-1', userType: 'system' },
    ]);

    const result = await handler.onInstall(baseContext);

    expect(result).toEqual({});
    expect(mockPersonalStaffService.createStaff).not.toHaveBeenCalled();
  });

  it('should create personal staff for each human member', async () => {
    buildSelectChain([
      { userId: 'human-1', userType: 'human' },
      { userId: 'human-2', userType: 'human' },
      { userId: 'bot-1', userType: 'bot' },
    ]);

    const result = await handler.onInstall(baseContext);

    expect(result).toEqual({});
    expect(mockPersonalStaffService.createStaff).toHaveBeenCalledTimes(2);
    expect(mockPersonalStaffService.createStaff).toHaveBeenCalledWith(
      'installed-app-1',
      'tenant-1',
      'human-1',
      {
        model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.6' },
        agenticBootstrap: false,
      },
    );
    expect(mockPersonalStaffService.createStaff).toHaveBeenCalledWith(
      'installed-app-1',
      'tenant-1',
      'human-2',
      {
        model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.6' },
        agenticBootstrap: false,
      },
    );
  });

  it('should skip members that already have personal staff (ConflictException)', async () => {
    buildSelectChain([
      { userId: 'human-1', userType: 'human' },
      { userId: 'human-2', userType: 'human' },
    ]);

    mockPersonalStaffService.createStaff
      .mockResolvedValueOnce({}) // human-1 succeeds
      .mockRejectedValueOnce(new ConflictException('already exists')); // human-2 already has one

    const result = await handler.onInstall(baseContext);

    expect(result).toEqual({});
    expect(mockPersonalStaffService.createStaff).toHaveBeenCalledTimes(2);
  });

  it('should continue creating for remaining members when one fails', async () => {
    buildSelectChain([
      { userId: 'human-1', userType: 'human' },
      { userId: 'human-2', userType: 'human' },
      { userId: 'human-3', userType: 'human' },
    ]);

    mockPersonalStaffService.createStaff
      .mockResolvedValueOnce({}) // human-1 succeeds
      .mockRejectedValueOnce(new Error('claw-hive unreachable')) // human-2 fails
      .mockResolvedValueOnce({}); // human-3 succeeds

    const result = await handler.onInstall(baseContext);

    expect(result).toEqual({});
    expect(mockPersonalStaffService.createStaff).toHaveBeenCalledTimes(3);
  });
});
