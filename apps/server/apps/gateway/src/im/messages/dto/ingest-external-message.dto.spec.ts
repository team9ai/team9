import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from '@jest/globals';
import { IngestExternalMessageDto } from './ingest-external-message.dto.js';

function makePayload() {
  return {
    message: {
      provider: 'weixin-ilink',
      idempotencyKey: 'weixin-ilink:conn-1:conv-1:msg-1',
      externalTenantId: 'wx-user-1',
      externalConversationId: 'conv-1',
      externalMessageId: 'msg-1',
      sender: { externalUserId: 'wx-peer-1' },
      content: 'hello',
      attachments: [],
      occurredAt: '2026-05-25T00:00:00.000Z',
      raw: {},
    },
    binding: {
      connectionId: 'conn-1',
      team9UserId: '019c4728-4852-76ee-828e-4ebd35927bd0',
      team9TenantId: '019c4728-4852-76b8-a68d-36b545dace5a',
    },
  };
}

async function validatePayload(payload: unknown) {
  return validate(plainToInstance(IngestExternalMessageDto, payload));
}

describe('IngestExternalMessageDto', () => {
  it('accepts a complete Weixin iLink inbound message payload', async () => {
    await expect(validatePayload(makePayload())).resolves.toEqual([]);
  });

  it('rejects payloads without the top-level message object', async () => {
    const payload = makePayload();
    delete (payload as Partial<typeof payload>).message;

    const errors = await validatePayload(payload);

    expect(errors.some((error) => error.property === 'message')).toBe(true);
  });

  it('rejects payloads without the top-level binding object', async () => {
    const payload = makePayload();
    delete (payload as Partial<typeof payload>).binding;

    const errors = await validatePayload(payload);

    expect(errors.some((error) => error.property === 'binding')).toBe(true);
  });

  it('rejects payloads without the nested sender object', async () => {
    const payload = makePayload();
    delete (payload.message as Partial<typeof payload.message>).sender;

    const errors = await validatePayload(payload);
    const messageError = errors.find((error) => error.property === 'message');

    expect(JSON.stringify(messageError)).toContain('sender');
  });
});
