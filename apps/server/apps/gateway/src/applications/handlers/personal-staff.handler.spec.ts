import { PersonalStaffHandler } from './personal-staff.handler.js';

describe('PersonalStaffHandler', () => {
  let handler: PersonalStaffHandler;

  beforeEach(() => {
    handler = new PersonalStaffHandler();
  });

  it('should have applicationId "personal-staff"', () => {
    expect(handler.applicationId).toBe('personal-staff');
  });

  it('should return empty config on install (no-op)', async () => {
    const context = {
      installedApplication: { id: 'test-id' } as any,
      tenantId: 'tenant-1',
      installedBy: 'user-1',
    };
    const result = await handler.onInstall(context);
    expect(result).toEqual({});
  });
});
