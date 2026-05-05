// apps/server/apps/gateway/src/permissions/__tests__/permissions.ws-bridge.spec.ts
import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock strategy: mock only the direct imports of permissions.ws-bridge.ts.
// This avoids loading the real WebsocketGateway, PermissionsService, and
// BotService (and their heavy transitive deps) entirely.
// ---------------------------------------------------------------------------

// @nestjs/common — provide just what permissions.ws-bridge.ts uses
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@nestjs/common', () => ({
  Injectable: () => () => undefined,
  Logger: class {
    warn() {}
    error() {}
    log() {}
  },
}));

// @nestjs/event-emitter — @OnEvent decorator is a no-op in tests
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@nestjs/event-emitter', () => ({
  OnEvent: () => () => undefined,
}));

// @team9/shared — provide PERMISSION_EVENTS constant used by the bridge
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/shared', () => ({
  PERMISSION_EVENTS: Object.freeze({
    REQUEST_CREATED: 'permission_request_created',
    REQUEST_DECIDED: 'permission_request_decided',
    REQUEST_CONSUMED: 'permission_request_consumed',
    GRANT_CREATED: 'permission_grant_created',
    GRANT_REVOKED: 'permission_grant_revoked',
  }),
}));

// Mock WebsocketGateway — the bridge only calls sendToUser on it
// Path is relative to THIS test file (src/permissions/__tests__/)
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule(
  '../../im/websocket/websocket.gateway.js',
  () => ({
    WebsocketGateway: class {
      sendToUser = jest.fn();
    },
  }),
);

// Mock PermissionsService — the bridge calls getRequest, resolveApprovers,
// and listAdminsForTenant
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('../permissions.service.js', () => ({
  PermissionsService: class {
    getRequest = jest.fn();
    resolveApprovers = jest.fn();
    listAdminsForTenant = jest.fn();
  },
}));

// Mock BotService — the bridge calls getBotUserIdByBotId
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('../../bot/bot.service.js', () => ({
  BotService: class {
    getBotUserIdByBotId = jest.fn();
  },
}));

// ---------------------------------------------------------------------------
// Dynamic import of the SUT (after all mocks are set up)
// ---------------------------------------------------------------------------
const { PermissionsWsBridge } = await import('../permissions.ws-bridge.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type SendToUserFn = ReturnType<typeof jest.fn>;

/** Create a minimal gateway stub with a jest-tracked sendToUser */
function makeGateway(): { sendToUser: SendToUserFn } {
  return { sendToUser: jest.fn() };
}

type PermServiceStub = {
  getRequest: ReturnType<typeof jest.fn>;
  resolveApprovers: ReturnType<typeof jest.fn>;
  listAdminsForTenant: ReturnType<typeof jest.fn>;
};

function makePermissionsService(): PermServiceStub {
  return {
    getRequest: jest.fn(),
    resolveApprovers: jest.fn(),
    listAdminsForTenant: jest.fn(),
  };
}

type BotServiceStub = { getBotUserIdByBotId: ReturnType<typeof jest.fn> };

function makeBotService(): BotServiceStub {
  return { getBotUserIdByBotId: jest.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionsWsBridge', () => {
  // ── request_created ──────────────────────────────────────────────────────

  it('broadcasts request_created to each approver in approverIds WITHOUT approverIds in the payload', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestCreated({
      id: 'r1',
      spellId: 'a b c',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      contextChannelId: null,
      expiresAt: new Date(),
      reason: null,
      approverIds: ['u1', 'u2'],
    } as never);

    expect(gateway.sendToUser).toHaveBeenCalledTimes(2);
    // Payload sent to each user must NOT include approverIds
    const [, , payloadU1] = (
      gateway.sendToUser.mock.calls as [
        string,
        string,
        Record<string, unknown>,
      ][]
    ).find(([u]) => u === 'u1')!;
    expect(payloadU1).not.toHaveProperty('approverIds');
    expect(payloadU1).toMatchObject({ id: 'r1' });
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'u2',
      'permission_request_created',
      expect.not.objectContaining({ approverIds: expect.anything() }),
    );
  });

  it('does NOT call resolveApprovers for request_created (uses approverIds from payload) and strips approverIds from broadcast', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestCreated({
      id: 'r1',
      spellId: 'x y z',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      contextChannelId: null,
      expiresAt: new Date(),
      reason: null,
      approverIds: ['u1'],
    } as never);

    expect(service.resolveApprovers).not.toHaveBeenCalled();
    // approverIds must not be forwarded to the client
    const [, , broadcastPayload] = (
      gateway.sendToUser.mock.calls as [
        string,
        string,
        Record<string, unknown>,
      ][]
    )[0];
    expect(broadcastPayload).not.toHaveProperty('approverIds');
  });

  it('broadcasts to no one when approverIds is empty', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestCreated({
      id: 'r1',
      spellId: 'a b c',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      contextChannelId: null,
      expiresAt: new Date(),
      reason: null,
      approverIds: [],
    } as never);

    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });

  // ── request_decided ──────────────────────────────────────────────────────

  it('broadcasts request_decided to approvers + requester bot userId', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const requestRow = {
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    };
    service.getRequest.mockResolvedValue(requestRow);
    service.resolveApprovers.mockResolvedValue(['u1']);
    botService.getBotUserIdByBotId.mockResolvedValue('u-bot');

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestDecided({
      id: 'r1',
      spellId: 'a b c',
      status: 'approved_once',
      decidedByUserId: 'u-decider',
      durableGrantId: null,
    });

    const recipients = (gateway.sendToUser.mock.calls as [string][])
      .map(([u]) => u)
      .sort();
    expect(recipients).toEqual(['u-bot', 'u1'].sort());
  });

  it('handles request_decided when request is not found (returns early)', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    service.getRequest.mockResolvedValue(null);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestDecided({
      id: 'missing',
      spellId: 'x y z',
      status: 'denied',
      decidedByUserId: null,
      durableGrantId: null,
    });

    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });

  it('deduplicates when bot userId is also in approver list', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const requestRow = {
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    };
    service.getRequest.mockResolvedValue(requestRow);
    // Bot user is ALSO an approver — should only receive one notification
    service.resolveApprovers.mockResolvedValue(['u-bot', 'u1']);
    botService.getBotUserIdByBotId.mockResolvedValue('u-bot');

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestDecided({
      id: 'r1',
      spellId: 'a b c',
      status: 'approved_once',
      decidedByUserId: 'u-admin',
      durableGrantId: null,
    });

    const recipients = (gateway.sendToUser.mock.calls as [string][]).map(
      ([u]) => u,
    );
    const unique = [...new Set(recipients)];
    expect(unique.sort()).toEqual(['u-bot', 'u1'].sort());
    // Verify no duplicate notifications
    expect(recipients.length).toBe(unique.length);
  });

  it('silently skips bot user notification when getBotUserId returns null', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const requestRow = {
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    };
    service.getRequest.mockResolvedValue(requestRow);
    service.resolveApprovers.mockResolvedValue(['u1']);
    botService.getBotUserIdByBotId.mockResolvedValue(null);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestDecided({
      id: 'r1',
      spellId: 'a b c',
      status: 'denied',
      decidedByUserId: 'u-admin',
      durableGrantId: null,
    });

    const recipients = (gateway.sendToUser.mock.calls as [string][]).map(
      ([u]) => u,
    );
    expect(recipients).toEqual(['u1']);
  });

  // ── request_consumed ─────────────────────────────────────────────────────

  it('broadcasts request_consumed to approvers resolved from the request', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    const requestRow = {
      id: 'req-1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    };
    service.getRequest.mockResolvedValue(requestRow);
    service.resolveApprovers.mockResolvedValue(['admin1', 'admin2']);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestConsumed({
      id: 'req-1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
    });

    const recipients = (gateway.sendToUser.mock.calls as [string][])
      .map(([u]) => u)
      .sort();
    expect(recipients).toEqual(['admin1', 'admin2']);
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      expect.any(String),
      'permission_request_consumed',
      expect.objectContaining({ id: 'req-1' }),
    );
  });

  it('skips broadcast for request_consumed when request not found', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    service.getRequest.mockResolvedValue(null);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onRequestConsumed({
      id: 'missing',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
    });

    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });

  // ── grant_created ────────────────────────────────────────────────────────

  it('broadcasts grant_created to all tenant admins', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    service.listAdminsForTenant.mockResolvedValue(['admin1', 'admin2']);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onGrantCreated({
      id: 'g1',
      tenantId: 't1',
      subjectKind: 'agent',
      subjectId: 'b1',
      permissionKey: 'tools:invoke',
      scopeMetadata: {},
    });

    const recipients = (gateway.sendToUser.mock.calls as [string][])
      .map(([u]) => u)
      .sort();
    expect(recipients).toEqual(['admin1', 'admin2']);
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      expect.any(String),
      'permission_grant_created',
      expect.objectContaining({ id: 'g1' }),
    );
  });

  it('broadcasts to no one for grant_created when no admins found', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    service.listAdminsForTenant.mockResolvedValue([]);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onGrantCreated({
      id: 'g1',
      tenantId: 't1',
      subjectKind: 'agent',
      subjectId: 'b1',
      permissionKey: 'tools:invoke',
      scopeMetadata: {},
    });

    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });

  // ── grant_revoked ────────────────────────────────────────────────────────

  it('broadcasts grant_revoked to all tenant admins', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    service.listAdminsForTenant.mockResolvedValue(['admin1']);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onGrantRevoked({ id: 'g1', tenantId: 't1' });

    expect(gateway.sendToUser).toHaveBeenCalledTimes(1);
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'admin1',
      'permission_grant_revoked',
      expect.objectContaining({ id: 'g1' }),
    );
  });

  it('broadcasts to no one for grant_revoked when no admins found', async () => {
    const gateway = makeGateway();
    const service = makePermissionsService();
    const botService = makeBotService();

    service.listAdminsForTenant.mockResolvedValue([]);

    const bridge = new PermissionsWsBridge(
      gateway as never,
      service as never,
      botService as never,
    );

    await bridge.onGrantRevoked({ id: 'g1', tenantId: 't1' });

    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });
});
