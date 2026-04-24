import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockSharedEnv = {
  AHAND_HUB_URL: 'https://hub.test',
  GATEWAY_INTERNAL_URL: 'https://gw.test',
  INTERNAL_AUTH_VALIDATION_TOKEN: 'internal-token',
};
jest.unstable_mockModule('@team9/shared', () => ({ env: mockSharedEnv }));

const { AhandBlueprintExtender } =
  await import('./ahand-blueprint.extender.js');
const { AhandControlPlaneClient: _AhandControlPlaneClient } =
  await import('./ahand-control-plane.client.js');
type AhandControlPlaneClientType = InstanceType<
  typeof _AhandControlPlaneClient
>;

type Extender = InstanceType<typeof AhandBlueprintExtender>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'id-1',
    hubDeviceId: 'd1',
    publicKey: 'pk',
    nickname: 'MacBook',
    platform: 'macos' as const,
    hostname: null,
    status: 'active' as const,
    isOnline: true,
    lastSeenAt: null,
    createdAt: '2026-04-22T10:00:00Z',
    ...overrides,
  };
}

const baseBlueprint = {
  components: [
    { typeKey: 'system-prompt', config: {} },
    { typeKey: 'host', config: {} },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AhandBlueprintExtender', () => {
  let extender: Extender;
  let control: { listDevicesForUser: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSharedEnv.AHAND_HUB_URL = 'https://hub.test';
    mockSharedEnv.GATEWAY_INTERNAL_URL = 'https://gw.test';
    mockSharedEnv.INTERNAL_AUTH_VALIDATION_TOKEN = 'internal-token';
    control = {
      listDevicesForUser: jest.fn<any>(),
    };
    extender = new AhandBlueprintExtender(
      control as unknown as AhandControlPlaneClientType,
    );
  });

  // ─── happy path ────────────────────────────────────────────────────────────

  describe('happy paths', () => {
    it('injects one ahand-host per online device + one ahand-context-provider', async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: 'd1', isOnline: true }),
        makeDevice({ hubDeviceId: 'd2', isOnline: true, nickname: 'Linux' }),
        makeDevice({ hubDeviceId: 'd3', isOnline: false, nickname: 'Offline' }),
      ]);

      const { blueprint, ahandTrackingState } = await extender.extend(
        baseBlueprint,
        { callingUserId: 'u1', clientContext: null },
      );

      const hosts = blueprint.components.filter(
        (c) => c.typeKey === 'ahand-host',
      );
      const providers = blueprint.components.filter(
        (c) => c.typeKey === 'ahand-context-provider',
      );
      expect(hosts).toHaveLength(2);
      expect(providers).toHaveLength(1);
      expect(hosts.map((c) => c.config.deviceId).sort()).toEqual(['d1', 'd2']);
      expect(ahandTrackingState.onlineDeviceIds.sort()).toEqual(['d1', 'd2']);
      expect(ahandTrackingState.userId).toBe('u1');
      expect(ahandTrackingState.sessionId).toBeNull();
    });

    it('ahand-host config carries all required fields', async () => {
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      const host = blueprint.components.find(
        (c) => c.typeKey === 'ahand-host',
      )!;
      expect(host.config).toMatchObject({
        deviceId: 'd1',
        deviceNickname: 'MacBook',
        devicePlatform: 'macos',
        callingUserId: 'u1',
        gatewayInternalUrl: 'https://gw.test',
        gatewayInternalAuthToken: 'internal-token',
        hubUrl: 'https://hub.test',
      });
    });

    it('zero devices → no ahand-host, still one ahand-context-provider', async () => {
      control.listDevicesForUser.mockResolvedValue([]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      expect(
        blueprint.components.filter((c) => c.typeKey === 'ahand-host'),
      ).toHaveLength(0);
      expect(
        blueprint.components.filter(
          (c) => c.typeKey === 'ahand-context-provider',
        ),
      ).toHaveLength(1);
    });

    it('original blueprint components are preserved', async () => {
      control.listDevicesForUser.mockResolvedValue([]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      expect(blueprint.components[0]).toEqual({
        typeKey: 'system-prompt',
        config: {},
      });
      expect(blueprint.components[1]).toEqual({ typeKey: 'host', config: {} });
    });

    it('revoked device with isOnline=true is not injected as ahand-host', async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ status: 'revoked', isOnline: true }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      expect(
        blueprint.components.filter((c) => c.typeKey === 'ahand-host'),
      ).toHaveLength(0);
    });
  });

  // ─── clientContext resolution ──────────────────────────────────────────────

  describe('clientContext resolution', () => {
    it('null clientContext → callingClient={kind:web}', async () => {
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(provider.config.callingClient).toEqual({ kind: 'web' });
    });

    it('{kind:web} clientContext → callingClient={kind:web}', async () => {
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: { kind: 'web' },
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(provider.config.callingClient).toEqual({ kind: 'web' });
    });

    it('macapp with owned+online device → isAhandEnabled=true', async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: 'dMac', nickname: 'My Mac', isOnline: true }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: { kind: 'macapp', deviceId: 'dMac' },
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(provider.config.callingClient).toEqual({
        kind: 'macapp',
        deviceId: 'dMac',
        deviceNickname: 'My Mac',
        isAhandEnabled: true,
      });
    });

    it('macapp with owned but offline device → isAhandEnabled=false', async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: 'dMac', isOnline: false }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: { kind: 'macapp', deviceId: 'dMac' },
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(
        (provider.config.callingClient as { isAhandEnabled: boolean })
          .isAhandEnabled,
      ).toBe(false);
    });

    it('macapp with unknown deviceId → falls back to {kind:web}', async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({ hubDeviceId: 'dOther' }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: { kind: 'macapp', deviceId: 'dGhost' },
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(provider.config.callingClient).toEqual({ kind: 'web' });
    });

    it('macapp with null deviceId → falls back to {kind:web}', async () => {
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: { kind: 'macapp', deviceId: null },
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(provider.config.callingClient).toEqual({ kind: 'web' });
    });
  });

  // ─── error / guard paths ──────────────────────────────────────────────────

  describe('guard paths', () => {
    it('blueprint without HostComponent → untouched + warn', async () => {
      const bpNoHost = {
        components: [{ typeKey: 'system-prompt', config: {} }],
      };
      const { blueprint, ahandTrackingState } = await extender.extend(
        bpNoHost,
        {
          callingUserId: 'u1',
          clientContext: null,
        },
      );
      expect(blueprint.components).toEqual(bpNoHost.components);
      expect(ahandTrackingState.onlineDeviceIds).toEqual([]);
      expect(control.listDevicesForUser).not.toHaveBeenCalled();
    });

    it('gateway failure → blueprint untouched, tracking empty', async () => {
      control.listDevicesForUser.mockRejectedValue(new Error('gateway down'));
      const { blueprint, ahandTrackingState } = await extender.extend(
        baseBlueprint,
        { callingUserId: 'u1', clientContext: null },
      );
      expect(
        blueprint.components.filter((c) => c.typeKey === 'ahand-host'),
      ).toHaveLength(0);
      expect(
        blueprint.components.filter(
          (c) => c.typeKey === 'ahand-context-provider',
        ),
      ).toHaveLength(0);
      expect(ahandTrackingState.onlineDeviceIds).toEqual([]);
    });

    it('works when AHAND_HUB_URL is empty (env not set)', async () => {
      mockSharedEnv.AHAND_HUB_URL = '';
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      const host = blueprint.components.find(
        (c) => c.typeKey === 'ahand-host',
      )!;
      expect(host.config.hubUrl).toBe('');
    });

    it('works when GATEWAY_INTERNAL_URL is empty (env not set)', async () => {
      mockSharedEnv.GATEWAY_INTERNAL_URL = '';
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      const host = blueprint.components.find(
        (c) => c.typeKey === 'ahand-host',
      )!;
      expect(host.config.gatewayInternalUrl).toBe('');
    });

    it('empty INTERNAL_AUTH_VALIDATION_TOKEN → blueprint untouched, tracking empty', async () => {
      mockSharedEnv.INTERNAL_AUTH_VALIDATION_TOKEN = '';
      control.listDevicesForUser.mockResolvedValue([makeDevice()]);
      const { blueprint, ahandTrackingState } = await extender.extend(
        baseBlueprint,
        { callingUserId: 'u1', clientContext: null },
      );
      expect(
        blueprint.components.filter((c) => c.typeKey === 'ahand-host'),
      ).toHaveLength(0);
      expect(
        blueprint.components.filter(
          (c) => c.typeKey === 'ahand-context-provider',
        ),
      ).toHaveLength(0);
      expect(ahandTrackingState.onlineDeviceIds).toEqual([]);
    });

    it('gateway failure with non-Error rejection still degrades gracefully', async () => {
      control.listDevicesForUser.mockImplementation(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error — not an Error instance';
      });
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: null,
      });
      expect(
        blueprint.components.filter((c) => c.typeKey === 'ahand-host'),
      ).toHaveLength(0);
    });
  });

  // ─── clientContext: revoked+online edge case ───────────────────────────────

  describe('clientContext resolution', () => {
    it('macapp with revoked+online device → isAhandEnabled=false (revoked not considered enabled)', async () => {
      control.listDevicesForUser.mockResolvedValue([
        makeDevice({
          hubDeviceId: 'dRevoked',
          status: 'revoked',
          isOnline: true,
        }),
      ]);
      const { blueprint } = await extender.extend(baseBlueprint, {
        callingUserId: 'u1',
        clientContext: { kind: 'macapp', deviceId: 'dRevoked' },
      });
      const provider = blueprint.components.find(
        (c) => c.typeKey === 'ahand-context-provider',
      )!;
      expect(
        (provider.config.callingClient as { isAhandEnabled: boolean })
          .isAhandEnabled,
      ).toBe(false);
    });
  });

  // ─── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('does not warn when INTERNAL_AUTH_VALIDATION_TOKEN is set', () => {
      mockSharedEnv.INTERNAL_AUTH_VALIDATION_TOKEN = 'valid-token';
      const warnSpy = jest
        .spyOn((extender as any).logger, 'warn')
        .mockImplementation(() => undefined);
      extender.onModuleInit();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns when INTERNAL_AUTH_VALIDATION_TOKEN is falsy (empty string)', () => {
      mockSharedEnv.INTERNAL_AUTH_VALIDATION_TOKEN = '';
      const warnSpy = jest
        .spyOn((extender as any).logger, 'warn')
        .mockImplementation(() => undefined);
      extender.onModuleInit();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('INTERNAL_AUTH_VALIDATION_TOKEN is not set'),
      );
    });

    it('warns when INTERNAL_AUTH_VALIDATION_TOKEN getter throws', () => {
      // Make the getter throw — getRequiredEnv throws if the value is missing
      Object.defineProperty(mockSharedEnv, 'INTERNAL_AUTH_VALIDATION_TOKEN', {
        get: () => {
          throw new Error('missing env');
        },
        configurable: true,
      });
      const warnSpy = jest
        .spyOn((extender as any).logger, 'warn')
        .mockImplementation(() => undefined);
      extender.onModuleInit();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('INTERNAL_AUTH_VALIDATION_TOKEN is not set'),
      );
      // Restore normal property
      Object.defineProperty(mockSharedEnv, 'INTERNAL_AUTH_VALIDATION_TOKEN', {
        value: 'internal-token',
        writable: true,
        configurable: true,
      });
    });
  });
});
