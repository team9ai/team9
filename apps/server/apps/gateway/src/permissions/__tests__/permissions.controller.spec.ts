// apps/server/apps/gateway/src/permissions/__tests__/permissions.controller.spec.ts
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { AuthGuard } from '@team9/auth';

const svc = {
  createGrant: jest.fn(),
  listGrants: jest.fn(),
  revokeGrant: jest.fn(),
  getGrant: jest.fn(),
  createRequest: jest.fn(),
  cancelRequest: jest.fn(),
  decideRequest: jest.fn(),
  getRequest: jest.fn(),
  getRequestBySpell: jest.fn(),
  listRequests: jest.fn(),
  canDecide: jest.fn(),
  requireBotIdForUser: jest.fn(),
  getWorkspaceAdmins: jest.fn(),
  listAdminsForTenant: jest.fn(),
};

const spellIdSvc = {
  generate: jest.fn(),
  parse: jest.fn((s: string) => {
    // Replicate SpellIdService.parse logic for tests
    const normalized = s.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/^[a-z]+( [a-z]+){2,3}$/.test(normalized)) return null;
    return normalized;
  }),
};

const { PermissionsController } = await import('../permissions.controller.js');
const { PermissionsService } = await import('../permissions.service.js');
const { SpellIdService } = await import('../spell-id.service.js');

class FakeAuthGuard {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { sub: 'u1', tenantId: 't1' };
    return true;
  }
}

describe('PermissionsController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [
        { provide: PermissionsService, useValue: svc },
        { provide: SpellIdService, useValue: spellIdSvc },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => app.close());

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------

  it('GET /permissions/grants lists grants (admin caller)', async () => {
    svc.listAdminsForTenant.mockResolvedValue(['u1']); // u1 is workspace admin
    svc.listGrants.mockResolvedValue([{ id: 'g1' }]);
    const res = await request(app.getHttpServer())
      .get('/api/v1/permissions/grants')
      .expect(200);
    expect(res.body).toEqual([{ id: 'g1' }]);
    expect(svc.listGrants).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });

  it('POST /permissions/grants creates a grant', async () => {
    svc.canDecide.mockResolvedValueOnce(true); // caller is authorized
    svc.createGrant.mockResolvedValue({ id: 'g1' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/permissions/grants')
      .send({
        subjectKind: 'agent',
        subjectId: '550e8400-e29b-41d4-a716-446655440000',
        permissionKey: 'messages:send',
      })
      .expect(201);
    expect(res.body).toEqual({ id: 'g1' });
    expect(svc.createGrant).toHaveBeenCalled();
  });

  it('POST /permissions/grants rejects unknown subjectKind', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/permissions/grants')
      .send({
        subjectKind: 'bogus',
        subjectId: '550e8400-e29b-41d4-a716-446655440000',
        permissionKey: 'messages:send',
      })
      .expect(400);
  });

  it('POST /permissions/grants rejects invalid UUID for subjectId', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/permissions/grants')
      .send({
        subjectKind: 'agent',
        subjectId: 'not-a-uuid',
        permissionKey: 'messages:send',
      })
      .expect(400);
  });

  it('DELETE /permissions/grants/:id revokes grant with tenantId', async () => {
    svc.getGrant.mockResolvedValue({
      id: 'g1',
      tenantId: 't1',
      subjectKind: 'agent',
      subjectId: '550e8400-e29b-41d4-a716-446655440000',
      permissionKey: 'messages:send',
      scopeMetadata: {},
    });
    svc.canDecide.mockResolvedValue(true);
    svc.revokeGrant.mockResolvedValue({ id: 'g1', revokedAt: new Date() });
    await request(app.getHttpServer())
      .delete('/api/v1/permissions/grants/g1')
      .expect(200);
    expect(svc.revokeGrant).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: 'g1', userId: 'u1', tenantId: 't1' }),
    );
  });

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  it('GET /permissions/requests lists requests', async () => {
    svc.listRequests.mockResolvedValue([{ id: 'r1' }]);
    const res = await request(app.getHttpServer())
      .get('/api/v1/permissions/requests')
      .expect(200);
    expect(res.body).toEqual([{ id: 'r1' }]);
  });

  it('GET /permissions/requests/by-spell/:spell returns request and normalizes spell', async () => {
    svc.getRequestBySpell.mockResolvedValue({ id: 'r1', spellId: 'a b c' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/permissions/requests/by-spell/A%20B%20C')
      .expect(200);
    expect(svc.getRequestBySpell).toHaveBeenCalledWith('a b c', 't1');
    expect(res.body.id).toBe('r1');
  });

  it('GET /permissions/requests/by-spell/:spell returns 404 when not found', async () => {
    svc.getRequestBySpell.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/api/v1/permissions/requests/by-spell/valid%20three%20words')
      .expect(404);
  });

  it('GET /permissions/requests/by-spell/:spell returns 400 for malformed spell id', async () => {
    // A single word or non-alpha string fails parse()
    await request(app.getHttpServer())
      .get('/api/v1/permissions/requests/by-spell/not-valid-spell')
      .expect(400);
    expect(svc.getRequestBySpell).not.toHaveBeenCalled();
  });

  it('POST /permissions/requests creates a request and returns 201 with the new row', async () => {
    svc.requireBotIdForUser.mockResolvedValue('b1');
    svc.createRequest.mockResolvedValue({
      id: 'r-new',
      spellId: 'raven crystal flame',
      status: 'pending',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: { toolName: 'sql' },
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
      reason: 'data lookup',
      expiresAt: null,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/permissions/requests')
      .send({
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        reason: 'data lookup',
      })
      .expect(201);
    expect(res.body.id).toBe('r-new');
    expect(res.body.spellId).toBe('raven crystal flame');
    expect(svc.requireBotIdForUser).toHaveBeenCalledWith('u1');
    expect(svc.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        requesterBotId: 'b1',
        permissionKey: 'tools:invoke',
        requestedMetadata: { toolName: 'sql' },
        reason: 'data lookup',
      }),
    );
  });

  it('POST /permissions/requests returns 403 when user is not a bot', async () => {
    svc.requireBotIdForUser.mockRejectedValue(
      new ForbiddenException(
        'Only bot accounts may create permission requests',
      ),
    );
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests')
      .send({
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
      })
      .expect(403);
  });

  it('POST /permissions/requests/:id/decide returns 403 when canDecide=false', async () => {
    svc.getRequest.mockResolvedValue({
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests/r1/decide')
      .send({ decision: 'once' })
      .expect(403);
  });

  it('POST /permissions/requests/:id/decide forwards to service when authorized', async () => {
    svc.getRequest.mockResolvedValue({
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(true);
    svc.decideRequest.mockResolvedValue({ id: 'r1', status: 'approved_once' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/permissions/requests/r1/decide')
      .send({ decision: 'once' })
      .expect(201);
    expect(res.body.status).toBe('approved_once');
  });

  it('POST /permissions/requests/:id/decide rejects invalid decision value', async () => {
    svc.getRequest.mockResolvedValue({
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(true);
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests/r1/decide')
      .send({ decision: 'invalid-value' })
      .expect(400);
  });

  it('POST /permissions/requests/:id/decide returns 404 when request not found', async () => {
    svc.getRequest.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests/nonexistent/decide')
      .send({ decision: 'deny' })
      .expect(404);
  });

  it('DELETE /permissions/requests/:id returns 403 when user is not a bot', async () => {
    svc.requireBotIdForUser.mockRejectedValue(
      new ForbiddenException(
        'Only bot accounts may cancel permission requests',
      ),
    );
    await request(app.getHttpServer())
      .delete('/api/v1/permissions/requests/r1')
      .expect(403);
  });

  it('POST /permissions/grants returns 400 for unknown permissionKey', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/permissions/grants')
      .send({
        subjectKind: 'agent',
        subjectId: '550e8400-e29b-41d4-a716-446655440000',
        permissionKey: 'bogus:key',
      })
      .expect(400);
  });

  it('POST /permissions/grants — returns 403 when caller is not in the approver set', async () => {
    svc.canDecide.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .post('/api/v1/permissions/grants')
      .send({
        subjectKind: 'agent',
        subjectId: '550e8400-e29b-41d4-a716-446655440000',
        permissionKey: 'messages:send',
      })
      .expect(403);
    expect(svc.createGrant).not.toHaveBeenCalled();
  });

  it('POST /permissions/requests — returns 400 when suggestedApproverIds has more than 50 entries', async () => {
    svc.requireBotIdForUser.mockResolvedValue('b1');
    const tooMany = Array.from(
      { length: 51 },
      () => '550e8400-e29b-41d4-a716-446655440000',
    );
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests')
      .send({
        permissionKey: 'tools:invoke',
        requestedMetadata: {},
        suggestedApproverIds: tooMany,
      })
      .expect(400);
  });

  it('POST /permissions/requests returns 400 for unknown permissionKey', async () => {
    svc.requireBotIdForUser.mockResolvedValue('b1');
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests')
      .send({
        permissionKey: 'bogus:key',
        requestedMetadata: {},
      })
      .expect(400);
  });

  it('DELETE /permissions/requests/:id cancels request and passes tenantId', async () => {
    svc.requireBotIdForUser.mockResolvedValue('b1');
    svc.cancelRequest.mockResolvedValue({ id: 'r1', status: 'cancelled' });
    const res = await request(app.getHttpServer())
      .delete('/api/v1/permissions/requests/r1')
      .expect(200);
    expect(res.body.status).toBe('cancelled');
    expect(svc.cancelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'r1',
        requesterBotId: 'b1',
        tenantId: 't1',
      }),
    );
  });

  it('POST /permissions/requests returns 400 when requestedMetadata exceeds 4 KB', async () => {
    svc.requireBotIdForUser.mockResolvedValue('b1');
    // Generate a value that pushes the JSON payload beyond 4096 bytes
    const bigValue = 'x'.repeat(5000);
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests')
      .send({
        permissionKey: 'tools:invoke',
        requestedMetadata: { bigKey: bigValue },
      })
      .expect(400);
    expect(svc.createRequest).not.toHaveBeenCalled();
  });

  it('POST /permissions/requests/by-spell/:spell/decide returns 403 when canDecide=false', async () => {
    svc.getRequestBySpell.mockResolvedValue({
      id: 'r1',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post(
        '/api/v1/permissions/requests/by-spell/raven%20crystal%20flame/decide',
      )
      .send({ decision: 'deny' })
      .expect(403);
  });

  it('POST /permissions/requests/by-spell/:spell/decide forwards when authorized', async () => {
    svc.getRequestBySpell.mockResolvedValue({
      id: 'r2',
      tenantId: 't1',
      requesterBotId: 'b1',
      permissionKey: 'tools:invoke',
      requestedMetadata: {},
      suggestedApproverIds: [],
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
    });
    svc.canDecide.mockResolvedValue(true);
    svc.decideRequest.mockResolvedValue({ id: 'r2', status: 'denied' });
    const res = await request(app.getHttpServer())
      .post(
        '/api/v1/permissions/requests/by-spell/raven%20crystal%20flame/decide',
      )
      .send({ decision: 'deny' })
      .expect(201);
    expect(res.body.status).toBe('denied');
    expect(svc.decideRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r2' }),
    );
  });

  // -------------------------------------------------------------------------
  // Fix 1: tenant cross-check on decide
  // -------------------------------------------------------------------------

  it('POST /permissions/requests/:id/decide returns 404 when request belongs to a different tenant', async () => {
    // getRequest now accepts tenantId and returns null when the request belongs to a
    // different tenant (DB-level filter). The mock simulates this by returning null.
    svc.getRequest.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/api/v1/permissions/requests/r1/decide')
      .send({ decision: 'once' })
      .expect(404);
    expect(svc.canDecide).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Fix 3: revokeGrant authorization check
  // -------------------------------------------------------------------------

  it('DELETE /permissions/grants/:id returns 404 when grant not found', async () => {
    svc.getGrant.mockResolvedValue(null);
    await request(app.getHttpServer())
      .delete('/api/v1/permissions/grants/unknown-grant')
      .expect(404);
    expect(svc.revokeGrant).not.toHaveBeenCalled();
  });

  it('DELETE /permissions/grants/:id returns 403 when caller is not authorized to administer this grant', async () => {
    svc.getGrant.mockResolvedValue({
      id: 'g1',
      tenantId: 't1',
      subjectKind: 'agent',
      subjectId: '550e8400-e29b-41d4-a716-446655440000',
      permissionKey: 'messages:send',
      scopeMetadata: {},
    });
    svc.canDecide.mockResolvedValue(false);
    await request(app.getHttpServer())
      .delete('/api/v1/permissions/grants/g1')
      .expect(403);
    expect(svc.revokeGrant).not.toHaveBeenCalled();
  });

  it('DELETE /permissions/grants/:id succeeds when caller is authorized', async () => {
    svc.getGrant.mockResolvedValue({
      id: 'g1',
      tenantId: 't1',
      subjectKind: 'agent',
      subjectId: '550e8400-e29b-41d4-a716-446655440000',
      permissionKey: 'messages:send',
      scopeMetadata: {},
    });
    svc.canDecide.mockResolvedValue(true);
    svc.revokeGrant.mockResolvedValue({ id: 'g1', revokedAt: new Date() });
    await request(app.getHttpServer())
      .delete('/api/v1/permissions/grants/g1')
      .expect(200);
    expect(svc.revokeGrant).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: 'g1', userId: 'u1', tenantId: 't1' }),
    );
  });

  // -------------------------------------------------------------------------
  // Fix 4: listGrants visibility check
  // -------------------------------------------------------------------------

  it('GET /permissions/grants without subjectKind+subjectId returns 403 for non-admin', async () => {
    svc.listAdminsForTenant.mockResolvedValue(['admin-user']); // u1 is not in list
    await request(app.getHttpServer())
      .get('/api/v1/permissions/grants')
      .expect(403);
    expect(svc.listGrants).not.toHaveBeenCalled();
  });

  it('GET /permissions/grants without subjectKind+subjectId returns 200 for workspace admin', async () => {
    svc.listAdminsForTenant.mockResolvedValue(['u1']); // u1 is admin
    svc.listGrants.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/api/v1/permissions/grants')
      .expect(200);
    expect(svc.listGrants).toHaveBeenCalled();
  });

  it('GET /permissions/grants with subjectKind+subjectId is allowed for non-admin who is an approver', async () => {
    svc.listAdminsForTenant.mockResolvedValue(['admin-user']); // u1 is not admin
    svc.canDecide.mockResolvedValueOnce(true); // u1 is in approver set
    svc.listGrants.mockResolvedValue([{ id: 'g1' }]);
    const res = await request(app.getHttpServer())
      .get(
        '/api/v1/permissions/grants?subjectKind=agent&subjectId=550e8400-e29b-41d4-a716-446655440000',
      )
      .expect(200);
    expect(res.body).toEqual([{ id: 'g1' }]);
    expect(svc.canDecide).toHaveBeenCalled();
  });

  it('GET /permissions/grants returns 403 for non-admin user requesting a subject they do not administer', async () => {
    svc.listAdminsForTenant.mockResolvedValue(['admin-user']); // u1 is not admin
    svc.canDecide.mockResolvedValueOnce(false); // u1 is NOT in approver set
    await request(app.getHttpServer())
      .get(
        '/api/v1/permissions/grants?subjectKind=agent&subjectId=550e8400-e29b-41d4-a716-446655440000',
      )
      .expect(403);
    expect(svc.listGrants).not.toHaveBeenCalled();
  });
});
