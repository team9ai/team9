import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { MessageController } from './message.controller.js';
import type { CreateMessageDto, CreateMessageResponse } from '@team9/shared';

describe('MessageController', () => {
  let controller: MessageController;
  let messageService: {
    createAndPersist: jest.Mock<any>;
  };

  beforeEach(() => {
    messageService = {
      createAndPersist: jest.fn<any>(),
    };

    controller = new MessageController(messageService as any);
    (controller as any).logger = {
      debug: jest.fn(),
      error: jest.fn(),
    };
  });

  function makeDto(
    overrides: Partial<CreateMessageDto> = {},
  ): CreateMessageDto {
    return {
      clientMsgId: 'client-msg-1',
      channelId: 'channel-1',
      senderId: 'user-1',
      content: 'hello',
      type: 'text',
      ...overrides,
    } as CreateMessageDto;
  }

  async function expectBadRequest(
    dto: Partial<CreateMessageDto>,
    message: string,
  ) {
    try {
      await controller.createMessage(dto as CreateMessageDto);
      throw new Error('Expected createMessage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as HttpException).getResponse()).toBe(message);
    }
  }

  it.each([
    ['clientMsgId', { clientMsgId: '' }, 'clientMsgId is required'],
    ['channelId', { channelId: '' }, 'channelId is required'],
    ['senderId', { senderId: '' }, 'senderId is required'],
  ] as const)(
    'rejects missing %s with 400',
    async (_field, overrides, message) => {
      await expectBadRequest(makeDto(overrides), message);
      expect(messageService.createAndPersist).not.toHaveBeenCalled();
    },
  );

  it('rejects empty content for text messages with 400', async () => {
    await expectBadRequest(
      makeDto({ content: '' }),
      'content is required for text messages',
    );
    expect(messageService.createAndPersist).not.toHaveBeenCalled();
  });

  it('allows non-text messages to omit content and forwards the dto', async () => {
    const dto = makeDto({
      type: 'file',
      content: '' as any,
    });
    const response: CreateMessageResponse = {
      msgId: 'msg-1',
      seqId: '42',
      clientMsgId: dto.clientMsgId,
      status: 'persisted',
      timestamp: 1234567890,
    };
    messageService.createAndPersist.mockResolvedValueOnce(response);

    await expect(controller.createMessage(dto)).resolves.toEqual(response);

    expect(messageService.createAndPersist).toHaveBeenCalledWith(dto);
    expect((controller as any).logger.debug).toHaveBeenCalledWith(
      'Message created: msg-1 (persisted) for channel channel-1',
    );
  });

  it('maps service failures to a 500 HttpException', async () => {
    messageService.createAndPersist.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    try {
      await controller.createMessage(makeDto());
      throw new Error('Expected createMessage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect((error as HttpException).getResponse()).toBe(
        'database unavailable',
      );
    }

    expect((controller as any).logger.error).toHaveBeenCalledWith(
      'Failed to create message: Error: database unavailable',
    );
  });
});
