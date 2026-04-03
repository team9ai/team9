import { CommonStaffHandler } from './common-staff.handler.js';

describe('CommonStaffHandler', () => {
  let handler: CommonStaffHandler;

  beforeEach(() => {
    handler = new CommonStaffHandler();
  });

  it('should have applicationId "common-staff"', () => {
    expect(handler.applicationId).toBe('common-staff');
  });

  it('should return empty config on install', async () => {
    const context = {
      installedApplication: { id: 'test-id' } as any,
      tenantId: 'tenant-1',
      installedBy: 'user-1',
    };
    const result = await handler.onInstall(context);
    expect(result).toEqual({});
  });
});
