import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ModelChangeAttemptController } from './model-change-attempt.controller.js';

const attemptId = '10000000-0000-7000-8000-000000000001';

function setup(input: {
  attempt?: Record<string, unknown>;
  activeTenantMember?: boolean;
}) {
  let selectIndex = 0;
  const db = {
    select: jest.fn<any>().mockImplementation(() => {
      const current = selectIndex++;
      return {
        from: () => ({
          where: () => ({
            limit: async () =>
              current === 0
                ? input.attempt
                  ? [input.attempt]
                  : []
                : input.activeTenantMember
                  ? [{ id: 'membership-1' }]
                  : [],
          }),
        }),
      };
    }),
  };
  return {
    controller: new ModelChangeAttemptController(db as never),
    db,
  };
}

describe('ModelChangeAttemptController', () => {
  it('returns a pending attempt to the actor without a membership lookup', async () => {
    const { controller, db } = setup({
      attempt: {
        id: attemptId,
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        decision: 'accepted',
        dispatchStatus: 'pending',
        reasonCode: 'accepted',
        safeErrorCode: null,
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        updatedAt: new Date('2026-07-27T00:00:01.000Z'),
        dispatchedAt: null,
      },
    });

    await expect(controller.getAttempt('user-1', attemptId)).resolves.toEqual({
      attemptId,
      state: 'pending',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z',
      dispatchedAt: null,
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('allows an active member of the attempt tenant', async () => {
    const { controller } = setup({
      activeTenantMember: true,
      attempt: {
        id: attemptId,
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        decision: 'accepted',
        dispatchStatus: 'dispatched',
        reasonCode: 'accepted',
        safeErrorCode: null,
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        updatedAt: new Date('2026-07-27T00:00:02.000Z'),
        dispatchedAt: new Date('2026-07-27T00:00:02.000Z'),
      },
    });

    await expect(controller.getAttempt('user-2', attemptId)).resolves.toEqual(
      expect.objectContaining({ attemptId, state: 'dispatched' }),
    );
  });

  it('does not reveal an attempt to an unrelated user', async () => {
    const { controller } = setup({
      activeTenantMember: false,
      attempt: {
        id: attemptId,
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        decision: 'accepted',
        dispatchStatus: 'pending',
        reasonCode: 'accepted',
        safeErrorCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        dispatchedAt: null,
      },
    });

    await expect(
      controller.getAttempt('outsider', attemptId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only stable reason and safe error codes', async () => {
    const { controller } = setup({
      attempt: {
        id: attemptId,
        actorUserId: 'user-1',
        tenantId: null,
        decision: 'accepted',
        dispatchStatus: 'failed',
        reasonCode: 'accepted',
        safeErrorCode: 'hive_http_400',
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        updatedAt: new Date('2026-07-27T00:00:03.000Z'),
        dispatchedAt: null,
      },
    });

    await expect(controller.getAttempt('user-1', attemptId)).resolves.toEqual({
      attemptId,
      state: 'failed',
      reasonCode: 'accepted',
      safeErrorCode: 'hive_http_400',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:03.000Z',
      dispatchedAt: null,
    });
  });

  it('maps rejected policy decisions to rejected state', async () => {
    const { controller } = setup({
      attempt: {
        id: attemptId,
        actorUserId: 'user-1',
        tenantId: null,
        decision: 'rejected',
        dispatchStatus: 'not_applicable',
        reasonCode: 'unsupported_model',
        safeErrorCode: null,
        createdAt: new Date('2026-07-27T00:00:00.000Z'),
        updatedAt: new Date('2026-07-27T00:00:00.000Z'),
        dispatchedAt: null,
      },
    });

    await expect(controller.getAttempt('user-1', attemptId)).resolves.toEqual(
      expect.objectContaining({
        attemptId,
        state: 'rejected',
        reasonCode: 'unsupported_model',
      }),
    );
  });
});
