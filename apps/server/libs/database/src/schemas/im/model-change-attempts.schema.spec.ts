import { describe, expect, it } from '@jest/globals';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../index.js';

describe('model change audit and outbox schemas', () => {
  it('exports bounded normalized attempt fields without a raw request body', () => {
    const table = schema.modelChangeAttempts;
    expect(table).toBeDefined();
    expect(Object.keys(table)).toEqual(
      expect.arrayContaining([
        'id',
        'idempotencyKey',
        'actorUserId',
        'authSessionId',
        'correlationId',
        'tenantId',
        'channelId',
        'botId',
        'installedApplicationId',
        'applicationId',
        'sessionId',
        'requestedProvider',
        'requestedModelId',
        'capability',
        'catalogVersion',
        'decision',
        'reasonCode',
        'dispatchStatus',
        'safeErrorCode',
        'createdAt',
        'updatedAt',
        'dispatchedAt',
      ]),
    );
    expect(Object.keys(table)).not.toEqual(
      expect.arrayContaining(['rawBody', 'requestBody', 'payload']),
    );
    expect(table.idempotencyKey.config.length).toBe(128);
    expect(table.requestedProvider.config.length).toBe(128);
    expect(table.requestedModelId.config.length).toBe(256);
  });

  it('defines stable decision, dispatch, and outbox states', () => {
    expect(schema.modelChangeDecisionEnum.enumValues).toEqual([
      'accepted',
      'rejected',
    ]);
    expect(schema.modelChangeDispatchStatusEnum.enumValues).toEqual([
      'not_applicable',
      'pending',
      'dispatching',
      'dispatched',
      'failed',
    ]);
    expect(schema.modelChangeOutboxStatusEnum.enumValues).toEqual([
      'pending',
      'processing',
      'dispatched',
      'failed',
    ]);
  });

  it('enforces one attempt per idempotency key and one outbox row per attempt', () => {
    const attemptConfig = getTableConfig(schema.modelChangeAttempts);
    const outboxConfig = getTableConfig(schema.modelChangeOutbox);

    expect(
      attemptConfig.indexes.some(
        (index) =>
          index.config.name === 'uq_model_change_attempts_idempotency' &&
          index.config.unique,
      ),
    ).toBe(true);
    expect(
      outboxConfig.indexes.some(
        (index) =>
          index.config.name === 'uq_model_change_outbox_attempt' &&
          index.config.unique,
      ),
    ).toBe(true);
    expect(outboxConfig.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'idx_model_change_outbox_due',
        'idx_model_change_outbox_claim',
      ]),
    );
  });

  it('keeps outbox retries and claim fencing explicit', () => {
    const table = schema.modelChangeOutbox;
    expect(Object.keys(table)).toEqual(
      expect.arrayContaining([
        'attemptId',
        'status',
        'retryCount',
        'nextAttemptAt',
        'claimToken',
        'claimUntil',
        'safeErrorCode',
        'createdAt',
        'updatedAt',
      ]),
    );
  });
});
