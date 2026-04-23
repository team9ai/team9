import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MessagePropertiesController } from './message-properties.controller.js';

describe('MessagePropertiesController', () => {
  const messageId = '00000000-0000-0000-0000-000000000001';
  const userId = 'user-1';
  const tenantId = 'tenant-1';
  const channelId = 'channel-1';

  let controller: MessagePropertiesController;
  let mockMessageProperties: {
    getMessageChannelId: jest.Mock<any>;
    getProperties: jest.Mock<any>;
    batchSet: jest.Mock<any>;
    getRelationsInspection: jest.Mock<any>;
  };
  let mockAiAutoFill: {
    autoFill: jest.Mock<any>;
  };
  let mockChannels: {
    isMember: jest.Mock<any>;
    assertReadAccess: jest.Mock<any>;
  };

  beforeEach(() => {
    mockMessageProperties = {
      getMessageChannelId: jest.fn<any>().mockResolvedValue(channelId),
      getProperties: jest.fn<any>(),
      batchSet: jest.fn<any>(),
      getRelationsInspection: jest.fn<any>(),
    };
    mockAiAutoFill = {
      autoFill: jest.fn<any>(),
    };
    mockChannels = {
      isMember: jest.fn<any>().mockResolvedValue(true),
      assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
    };
    controller = new MessagePropertiesController(
      mockMessageProperties as any,
      mockAiAutoFill as any,
      mockChannels as any,
    );
  });

  // ==================== autoFill ====================

  describe('autoFill', () => {
    it('returns the actual AI fill result synchronously, not a "202 accepted" stub', async () => {
      mockAiAutoFill.autoFill.mockResolvedValue({
        filled: { status: 'done' },
        skipped: ['tags'],
      });

      const result = await controller.autoFill(userId, tenantId, messageId, {
        fields: ['status', 'tags'],
        preserveExisting: true,
      });

      expect(result).toEqual({ filled: { status: 'done' }, skipped: ['tags'] });
      expect(mockAiAutoFill.autoFill).toHaveBeenCalledWith(
        messageId,
        userId,
        tenantId,
        { fields: ['status', 'tags'], preserveExisting: true },
      );
    });

    it('propagates AI errors to the caller instead of swallowing them', async () => {
      mockAiAutoFill.autoFill.mockRejectedValue(
        new BadRequestException(
          'AI auto-fill failed after 3 attempts: timeout',
        ),
      );

      await expect(
        controller.autoFill(userId, tenantId, messageId, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks non-members before invoking AI', async () => {
      mockChannels.isMember.mockResolvedValue(false);

      await expect(
        controller.autoFill(userId, tenantId, messageId, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAiAutoFill.autoFill).not.toHaveBeenCalled();
    });
  });

  // ==================== getRelations ====================

  describe('GET /relations', () => {
    const inspectionResult = {
      outgoing: {
        parent: [
          {
            messageId: 'parent-1',
            depth: 1,
            propertyDefinitionId: 'def-1',
            parentSource: 'relation' as const,
          },
        ],
        related: [],
      },
      incoming: {
        children: [],
        relatedBy: [{ messageId: 'source-1', propertyDefinitionId: 'def-2' }],
      },
    };

    it('returns outgoing parent + related and incoming lookups', async () => {
      mockMessageProperties.getRelationsInspection.mockResolvedValue(
        inspectionResult,
      );

      const result = await controller.getRelations(
        userId,
        messageId,
        'all',
        'both',
        1,
      );

      expect(result).toEqual(inspectionResult);
      expect(mockMessageProperties.getRelationsInspection).toHaveBeenCalledWith(
        messageId,
        {
          kind: 'all',
          direction: 'both',
          depth: 1,
        },
      );
      expect(mockChannels.assertReadAccess).toHaveBeenCalledWith(
        channelId,
        userId,
      );
    });

    it('passes default undefined values when query params are omitted', async () => {
      mockMessageProperties.getRelationsInspection.mockResolvedValue(
        inspectionResult,
      );

      await controller.getRelations(userId, messageId);

      expect(mockMessageProperties.getRelationsInspection).toHaveBeenCalledWith(
        messageId,
        {
          kind: undefined,
          direction: undefined,
          depth: undefined,
        },
      );
    });

    it('calls assertReadAccess with the correct channelId', async () => {
      mockMessageProperties.getRelationsInspection.mockResolvedValue(
        inspectionResult,
      );

      await controller.getRelations(userId, messageId);

      expect(mockChannels.assertReadAccess).toHaveBeenCalledWith(
        channelId,
        userId,
      );
    });

    it('propagates errors from getRelationsInspection', async () => {
      mockMessageProperties.getRelationsInspection.mockRejectedValue(
        new BadRequestException('boom'),
      );

      await expect(controller.getRelations(userId, messageId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
