/**
 * Permissions end-to-end smoke test — Strategy B (mock services + supertest)
 *
 * Exercises the full happy-path state machine at the HTTP layer:
 *   1. Bot (non-member) POSTs to a channel  → 403 PERMISSION_REQUIRED
 *      (PermissionsService.gate returns { allowed: false }, service then
 *       creates a permission request and MessagesController throws 403)
 *   2. Approver calls POST /api/v1/permissions/requests/:id/decide
 *      with { decision: 'remember', rememberSubject: 'channel-session' }
 *      → 201 with the decided request row
 *   3. Bot retries the POST → 201 (gate now returns allowed: true)
 *
 * We stub out every service that has external dependencies (DB, Redis,
 * RabbitMQ, gRPC) so the test is fully self-contained and fast. The
 * stateful mocks simulate the grant/request lifecycle that a real DB
 * would provide.
 *
 * What this exercises end-to-end:
 *  - MessagesController → BotService + PermissionsService wiring
 *  - PermissionsController → PermissionsService wiring
 *  - Route versioning (`/api/v1/...`) and global prefix
 *  - ValidationPipe for the DecideRequestDto
 *  - ForbiddenException shape: { error: 'PERMISSION_REQUIRED', requestId, spellId }
 *  - Decision transitions: pending → approved_durable (grant created)
 *  - Retry success: gate allows after remember-approve
 *
 * NOTE: WebsocketGateway's @WebSocketGateway decorator reads env.CORS_ORIGIN
 * at module-load time, so we must set it before any import.
 */

// Set required env vars before any module imports that read them at load time
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  type INestApplication,
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AuthGuard } from '@team9/auth';
import { PermissionsController } from '../src/permissions/permissions.controller.js';
import { MessagesController } from '../src/im/messages/messages.controller.js';

// ---------------------------------------------------------------------------
// Fixed IDs used throughout the test
// ---------------------------------------------------------------------------
const BOT_USER_ID = '019cd29d-0000-7000-b001-000000000001';
const APPROVER_USER_ID = '019cd29d-0000-7000-b001-000000000002';
const BOT_ID = '019cd29d-0000-7000-b001-000000000010';
const CHANNEL_ID = '019cd29d-0000-7000-c001-000000000001';
const TENANT_ID = 'tenant-t1';

// ---------------------------------------------------------------------------
// Switchable Auth Guard
// ---------------------------------------------------------------------------

let currentUserId = BOT_USER_ID;
let currentTenantId = TENANT_ID;

class SwitchableAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      user?: { sub: string; tenantId: string };
    }>();
    req.user = { sub: currentUserId, tenantId: currentTenantId };
    return true;
  }
}

// ---------------------------------------------------------------------------
// State machine for permission gate
// ---------------------------------------------------------------------------

type RequestStatus =
  | 'pending'
  | 'approved_durable'
  | 'approved_once'
  | 'denied';

interface PermissionRequest {
  id: string;
  spellId: string;
  tenantId: string;
  requesterBotId: string;
  permissionKey: string;
  requestedMetadata: Record<string, unknown>;
  status: RequestStatus;
  contextChannelId: string | null;
  decidedByUserId: string | null;
  durableGrantId: string | null;
}

interface PermissionGrant {
  id: string;
  tenantId: string;
  subjectKind: string;
  subjectId: string;
  permissionKey: string;
  scopeMetadata: Record<string, unknown>;
}

const state = {
  requests: new Map<string, PermissionRequest>(),
  grants: new Map<string, PermissionGrant>(),
};

function resetState() {
  state.requests.clear();
  state.grants.clear();
}

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------

function buildPermissionsServiceStub() {
  return {
    /** gate: allowed if a matching durable grant exists (checks subjectKind + subjectId) */
    gate: jest.fn(
      async (input: {
        key: string;
        metadata: Record<string, unknown>;
        ctx: { tenantId: string; botId: string; channelId?: string };
      }) => {
        for (const grant of state.grants.values()) {
          if (
            grant.tenantId === input.ctx.tenantId &&
            grant.permissionKey === input.key &&
            ((grant.subjectKind === 'channel-session' &&
              grant.subjectId === input.ctx.channelId) ||
              (grant.subjectKind === 'agent' &&
                grant.subjectId === input.ctx.botId))
          ) {
            return { allowed: true, via: 'grant', grantId: grant.id };
          }
        }
        return { allowed: false };
      },
    ),

    /** createRequest: builds a pending request and stores it */
    createRequest: jest.fn(
      async (input: {
        tenantId: string;
        requesterBotId: string;
        permissionKey: string;
        requestedMetadata: Record<string, unknown>;
        contextChannelId?: string;
        reason?: string;
      }) => {
        const req: PermissionRequest = {
          id: uuidv7(),
          spellId: 'amber fox river',
          tenantId: input.tenantId,
          requesterBotId: input.requesterBotId,
          permissionKey: input.permissionKey,
          requestedMetadata: input.requestedMetadata,
          status: 'pending',
          contextChannelId: input.contextChannelId ?? null,
          decidedByUserId: null,
          durableGrantId: null,
        };
        state.requests.set(req.id, req);
        return req;
      },
    ),

    /** getRequest: look up by id */
    getRequest: jest.fn(async (id: string) => {
      return state.requests.get(id) ?? null;
    }),

    /** canDecide: approver can always decide in this test */
    canDecide: jest.fn(async () => true),

    /** decideRequest: transitions status + creates grant for 'remember' */
    decideRequest: jest.fn(
      async (input: {
        requestId: string;
        userId: string;
        decision: 'remember' | 'once' | 'deny';
        rememberSubject?: string;
      }) => {
        const req = state.requests.get(input.requestId);
        if (!req) throw new Error(`Request ${input.requestId} not found`);

        let durableGrantId: string | null = null;

        if (input.decision === 'remember') {
          const grant: PermissionGrant = {
            id: uuidv7(),
            tenantId: req.tenantId,
            subjectKind: input.rememberSubject ?? 'channel-session',
            subjectId: req.contextChannelId ?? req.requesterBotId,
            permissionKey: req.permissionKey,
            scopeMetadata: req.requestedMetadata,
          };
          state.grants.set(grant.id, grant);
          durableGrantId = grant.id;
        }

        const newStatus: RequestStatus =
          input.decision === 'deny'
            ? 'denied'
            : input.decision === 'once'
              ? 'approved_once'
              : 'approved_durable';

        const updated: PermissionRequest = {
          ...req,
          status: newStatus,
          decidedByUserId: input.userId,
          durableGrantId,
        };
        state.requests.set(req.id, updated);
        return updated;
      },
    ),

    // stubs for other controller methods (list, create grant etc.)
    listGrants: jest.fn(async () => []),
    createGrant: jest.fn(async () => ({ id: uuidv7() })),
    revokeGrant: jest.fn(async () => ({ id: uuidv7(), revokedAt: new Date() })),
    listRequests: jest.fn(async () => []),
    cancelRequest: jest.fn(async () => ({})),
    requireBotIdForUser: jest.fn(async (userId: string) => {
      if (userId === BOT_USER_ID) return BOT_ID;
      throw new Error('Not a bot');
    }),
    getRequestBySpell: jest.fn(async () => null),
    resolveApprovers: jest.fn(async () => [APPROVER_USER_ID]),
  };
}

function buildBotServiceStub() {
  return {
    getBotByUserId: jest.fn(async (userId: string) => {
      if (userId !== BOT_USER_ID) return null;
      return {
        userId: BOT_USER_ID,
        botId: BOT_ID,
        username: 'test-bot',
        displayName: 'Test Bot',
        email: 'bot@test.internal',
        type: 'custom',
        ownerId: APPROVER_USER_ID,
        mentorId: null,
        description: null,
        capabilities: null,
        extra: null,
        managedProvider: null,
        managedMeta: null,
        isActive: true,
      };
    }),
  };
}

function buildChannelsServiceStub() {
  // Bot is NOT a member of the channel — causes the permission gate to fire
  return {
    isMember: jest.fn(async () => false),
    assertReadAccess: jest.fn(async () => undefined),
    findById: jest.fn(async () => ({
      id: CHANNEL_ID,
      tenantId: TENANT_ID,
      type: 'public',
      isActivated: true,
      isArchived: false,
    })),
    assertMentionsAllowed: jest.fn(async () => undefined),
    getMemberRole: jest.fn(async () => null),
  };
}

function buildMessagesServiceStub() {
  return {
    getChannelMessages: jest.fn(async () => []),
    getMessageWithDetails: jest.fn(async () => {
      throw new Error('not found');
    }),
    truncateForPreview: jest.fn((m: unknown) => m),
    mergeProperties: jest.fn(async (msgs: unknown[]) => msgs),
    markAsRead: jest.fn(async () => undefined),
    update: jest.fn(async () => {
      throw new Error('not found');
    }),
    delete: jest.fn(async () => undefined),
    getThread: jest.fn(async () => ({ rootMessage: {}, replies: [] })),
    getSubReplies: jest.fn(async () => ({ replies: [] })),
    pinMessage: jest.fn(async () => undefined),
    addReaction: jest.fn(async () => undefined),
    removeReaction: jest.fn(async () => undefined),
    getChannelMessagesPaginated: jest.fn(async () => ({
      messages: [],
      hasOlder: false,
      hasNewer: false,
    })),
    getMessageChannelId: jest.fn(async () => CHANNEL_ID),
    getFullContent: jest.fn(async () => ({ content: '' })),
  };
}

function buildImWorkerGrpcClientServiceStub() {
  return {
    createMessage: jest.fn(async () => ({ msgId: uuidv7() })),
  };
}

function buildMessagePropertiesServiceStub() {
  return {
    batchSet: jest.fn(async () => undefined),
  };
}

function buildAiAutoFillServiceStub() {
  return {
    autoFill: jest.fn(async () => undefined),
  };
}

function buildPropertyDefinitionsServiceStub() {
  return {
    findAllByChannel: jest.fn(async () => []),
  };
}

function buildWebsocketGatewayStub() {
  return {
    sendToChannelMembers: jest.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Permissions e2e — deny → decide → retry', () => {
  let app: INestApplication;
  let permSvc: ReturnType<typeof buildPermissionsServiceStub>;
  let botSvc: ReturnType<typeof buildBotServiceStub>;
  let channelsSvc: ReturnType<typeof buildChannelsServiceStub>;
  let msgsSvc: ReturnType<typeof buildMessagesServiceStub>;
  let imWorkerGrpc: ReturnType<typeof buildImWorkerGrpcClientServiceStub>;
  let msgPropsSvc: ReturnType<typeof buildMessagePropertiesServiceStub>;
  let aiAutoFillSvc: ReturnType<typeof buildAiAutoFillServiceStub>;
  let propDefsSvc: ReturnType<typeof buildPropertyDefinitionsServiceStub>;
  let wsSvc: ReturnType<typeof buildWebsocketGatewayStub>;

  beforeEach(async () => {
    resetState();
    currentUserId = BOT_USER_ID;
    currentTenantId = TENANT_ID;

    permSvc = buildPermissionsServiceStub();
    botSvc = buildBotServiceStub();
    channelsSvc = buildChannelsServiceStub();
    msgsSvc = buildMessagesServiceStub();
    imWorkerGrpc = buildImWorkerGrpcClientServiceStub();
    msgPropsSvc = buildMessagePropertiesServiceStub();
    aiAutoFillSvc = buildAiAutoFillServiceStub();
    propDefsSvc = buildPropertyDefinitionsServiceStub();
    wsSvc = buildWebsocketGatewayStub();

    // Lazy import the service tokens to avoid transitive DI resolution issues.
    // We import only the classes we need for useValue overrides.
    const { PermissionsService } =
      await import('../src/permissions/permissions.service.js');
    const { BotService } = await import('../src/bot/bot.service.js');
    const { ChannelsService } =
      await import('../src/im/channels/channels.service.js');
    const { MessagesService } =
      await import('../src/im/messages/messages.service.js');
    const { ImWorkerGrpcClientService } =
      await import('../src/im/services/im-worker-grpc-client.service.js');
    const { MessagePropertiesService } =
      await import('../src/im/properties/message-properties.service.js');
    const { AiAutoFillService } =
      await import('../src/im/properties/ai-auto-fill.service.js');
    const { PropertyDefinitionsService } =
      await import('../src/im/properties/property-definitions.service.js');
    const { WebsocketGateway } =
      await import('../src/im/websocket/websocket.gateway.js');

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [PermissionsController, MessagesController],
      providers: [
        { provide: PermissionsService, useValue: permSvc },
        { provide: BotService, useValue: botSvc },
        { provide: ChannelsService, useValue: channelsSvc },
        { provide: MessagesService, useValue: msgsSvc },
        { provide: ImWorkerGrpcClientService, useValue: imWorkerGrpc },
        { provide: MessagePropertiesService, useValue: msgPropsSvc },
        { provide: AiAutoFillService, useValue: aiAutoFillSvc },
        { provide: PropertyDefinitionsService, useValue: propDefsSvc },
        { provide: WebsocketGateway, useValue: wsSvc },
        // GatewayMQService is Optional in MessagesController, no need to stub
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(SwitchableAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // Happy path: deny → decide(remember) → retry → 201
  // -------------------------------------------------------------------------

  it('full flow: 403 PERMISSION_REQUIRED → decide remember → 201', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    // ── Step 1: Bot attempts to send a message to a channel it's not in ──
    // PermissionsService.gate returns { allowed: false } so the controller
    // creates a request and throws a 403 with the { requestId, spellId } payload.

    const step1 = await request(server)
      .post(`/api/v1/im/channels/${CHANNEL_ID}/messages`)
      .send({ content: 'hello from bot' });

    expect(step1.status).toBe(403);
    expect(step1.body.error).toBe('PERMISSION_REQUIRED');
    expect(typeof step1.body.requestId).toBe('string');
    expect(step1.body.spellId).toMatch(/^[a-z]+( [a-z]+){2,3}$/);

    const { requestId } = step1.body as { requestId: string };

    // Verify the request was stored in our state machine
    expect(state.requests.has(requestId)).toBe(true);
    expect(state.requests.get(requestId)?.status).toBe('pending');

    // ── Step 2: Switch to approver identity, call decide ──
    currentUserId = APPROVER_USER_ID;

    const step2 = await request(server)
      .post(`/api/v1/permissions/requests/${requestId}/decide`)
      .send({ decision: 'remember', rememberSubject: 'channel-session' });

    expect(step2.status).toBe(201);
    expect(step2.body.status).toBe('approved_durable');
    expect(step2.body.decidedByUserId).toBe(APPROVER_USER_ID);
    expect(typeof step2.body.durableGrantId).toBe('string');

    // Verify grant was created in our state
    const updatedReq = state.requests.get(requestId);
    expect(updatedReq?.status).toBe('approved_durable');
    expect(state.grants.size).toBe(1);

    // ── Step 3: Bot retries the message — gate now allows it ──
    currentUserId = BOT_USER_ID;

    // Configure messagesService to return a fake created message
    const fakeMsg = {
      id: uuidv7(),
      channelId: CHANNEL_ID,
      senderId: BOT_USER_ID,
      content: 'hello from bot',
      type: 'text',
      isPinned: false,
      parentId: null,
      createdAt: new Date().toISOString(),
      sender: null,
    };
    msgsSvc.getMessageWithDetails.mockResolvedValue(fakeMsg as never);
    msgsSvc.mergeProperties.mockResolvedValue([fakeMsg] as never);
    msgsSvc.truncateForPreview.mockReturnValue(fakeMsg as never);

    const step3 = await request(server)
      .post(`/api/v1/im/channels/${CHANNEL_ID}/messages`)
      .send({ content: 'hello from bot' });

    expect(step3.status).toBe(201);
    expect(step3.body.channelId).toBe(CHANNEL_ID);

    // Confirm the gate was called with the right key
    expect(permSvc.gate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'messages:send',
        ctx: expect.objectContaining({
          tenantId: TENANT_ID,
          botId: BOT_ID,
          channelId: CHANNEL_ID,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Verify 403 shape on deny decision
  // -------------------------------------------------------------------------

  it('returns 403 PERMISSION_REQUIRED on first attempt when gate denies', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const res = await request(server)
      .post(`/api/v1/im/channels/${CHANNEL_ID}/messages`)
      .send({ content: 'test' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      statusCode: 403,
      message: expect.any(String),
      error: 'PERMISSION_REQUIRED',
    });
    expect(typeof res.body.requestId).toBe('string');
    expect(typeof res.body.spellId).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Verify decide endpoint validates DTO
  // -------------------------------------------------------------------------

  it('returns 400 for invalid decision value', async () => {
    currentUserId = APPROVER_USER_ID;
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    // First create a pending request via state directly
    const req: PermissionRequest = {
      id: uuidv7(),
      spellId: 'test spell id',
      tenantId: TENANT_ID,
      requesterBotId: BOT_ID,
      permissionKey: 'messages:send',
      requestedMetadata: {},
      status: 'pending',
      contextChannelId: CHANNEL_ID,
      decidedByUserId: null,
      durableGrantId: null,
    };
    state.requests.set(req.id, req);
    permSvc.getRequest.mockResolvedValue(req as never);

    const res = await request(server)
      .post(`/api/v1/permissions/requests/${req.id}/decide`)
      .send({ decision: 'invalid-value' });

    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Verify 404 when deciding a non-existent request
  // -------------------------------------------------------------------------

  it('returns 404 when deciding a non-existent request', async () => {
    currentUserId = APPROVER_USER_ID;
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    permSvc.getRequest.mockResolvedValue(null as never);

    const nonExistentId = uuidv7();
    const res = await request(server)
      .post(`/api/v1/permissions/requests/${nonExistentId}/decide`)
      .send({ decision: 'deny' });

    expect(res.status).toBe(404);
  });
});
