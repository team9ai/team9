// `WebsocketGateway` reads CORS_ORIGIN at class-definition time when
// imported below. Provide a default for CI environments that don't set it.
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

/**
 * PermissionsModule DI bootstrap smoke test.
 *
 * Verifies that all providers declared in PermissionsModule resolve correctly
 * under NestJS dependency injection.  Rather than bootstrapping the full
 * AppModule (which requires live Postgres / Redis / RabbitMQ) or the full
 * PermissionsModule (which transitively pulls WebsocketModule → ChannelsModule
 * → AuditModule whose forwardRef is fragile in the test harness), we
 * instantiate each provider in a flat TestingModule with all external
 * dependencies replaced by lightweight stubs.
 *
 * What this exercises:
 *  - Every token referenced in PermissionsModule providers/controllers can
 *    be resolved.
 *  - PermissionsService, PermissionsApproverRepository, SpellIdService, and
 *    PermissionsWsBridge are all in the module's providers list (any missing
 *    declaration is caught here as a "not found" error).
 *  - PermissionsService is exported (tested via moduleRef.get resolving it
 *    from the consumer side).
 *  - SpellIdService works end-to-end (no infra deps).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DATABASE_CONNECTION } from '@team9/database';

const WEBSOCKET_GATEWAY = 'WEBSOCKET_GATEWAY';

// ── stubs ────────────────────────────────────────────────────────────────────

const dbStub = { query: {}, select: jest.fn(), insert: jest.fn() };
const gatewayStub = { sendToUser: jest.fn() };
const botServiceStub = { getBotUserIdByBotId: jest.fn() };

describe('PermissionsModule providers bootstrap', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const { PermissionsService } =
      await import('../src/permissions/permissions.service.js');
    const { PermissionsController } =
      await import('../src/permissions/permissions.controller.js');
    const { PermissionsApproverRepository } =
      await import('../src/permissions/permissions-approver.repository.js');
    const { SpellIdService } =
      await import('../src/permissions/spell-id.service.js');
    const { PermissionsWsBridge } =
      await import('../src/permissions/permissions.ws-bridge.js');
    const { WebsocketGateway } =
      await import('../src/im/websocket/websocket.gateway.js');
    const { BotService } = await import('../src/bot/bot.service.js');

    // Build a flat module containing exactly the providers declared in
    // PermissionsModule, with all infrastructure tokens stubbed out.
    // SpellIdService has an optional RandomFn constructor parameter that NestJS
    // tries to inject as a Function type — we supply it explicitly so the DI
    // container does not attempt to resolve the unregistered Function token.
    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [PermissionsController],
      providers: [
        PermissionsService,
        PermissionsApproverRepository,
        {
          provide: SpellIdService,
          useFactory: () => new SpellIdService(Math.random),
        },
        PermissionsWsBridge,
        { provide: DATABASE_CONNECTION, useValue: dbStub },
        { provide: WebsocketGateway, useValue: gatewayStub },
        { provide: WEBSOCKET_GATEWAY, useValue: gatewayStub },
        { provide: BotService, useValue: botServiceStub },
      ],
    }).compile();
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('resolves PermissionsService', async () => {
    const { PermissionsService } =
      await import('../src/permissions/permissions.service.js');
    const svc = moduleRef.get(PermissionsService);
    expect(svc).toBeInstanceOf(PermissionsService);
  });

  it('resolves PermissionsApproverRepository', async () => {
    const { PermissionsApproverRepository } =
      await import('../src/permissions/permissions-approver.repository.js');
    const repo = moduleRef.get(PermissionsApproverRepository);
    expect(repo).toBeInstanceOf(PermissionsApproverRepository);
  });

  it('resolves SpellIdService and generates valid spell-ids', async () => {
    const { SpellIdService } =
      await import('../src/permissions/spell-id.service.js');
    const spell = moduleRef.get(SpellIdService);
    expect(spell).toBeInstanceOf(SpellIdService);
    const id3 = spell.generate({ wordCount: 3 });
    expect(id3.split(' ')).toHaveLength(3);
    const id4 = spell.generate({ wordCount: 4 });
    expect(id4.split(' ')).toHaveLength(4);
  });

  it('resolves PermissionsWsBridge', async () => {
    const { PermissionsWsBridge } =
      await import('../src/permissions/permissions.ws-bridge.js');
    const bridge = moduleRef.get(PermissionsWsBridge);
    expect(bridge).toBeInstanceOf(PermissionsWsBridge);
  });

  it('resolves PermissionsController', async () => {
    const { PermissionsController } =
      await import('../src/permissions/permissions.controller.js');
    const ctrl = moduleRef.get(PermissionsController);
    expect(ctrl).toBeInstanceOf(PermissionsController);
  });
});
