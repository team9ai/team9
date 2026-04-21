import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// Set CORS_ORIGIN before any module import — WebsocketGateway reads it at
// class-definition time. ES module static imports are hoisted, so we must
// load ViewsController via dynamic import AFTER setting the env var.
process.env.CORS_ORIGIN = 'http://localhost';

const { ViewsController } = await import('./views.controller.js');

describe('ViewsController', () => {
  const channelId = '00000000-0000-0000-0000-000000000001';
  const viewId = '00000000-0000-0000-0000-000000000002';
  const userId = 'user-1';

  let controller: ViewsController;
  let mockViewsService: {
    findAllByChannel: jest.Mock<any>;
    findByIdOrThrow: jest.Mock<any>;
    create: jest.Mock<any>;
    update: jest.Mock<any>;
    delete: jest.Mock<any>;
    queryMessages: jest.Mock<any>;
    getTreeSnapshot: jest.Mock<any>;
  };
  let mockWebsocketGateway: {
    sendToChannelMembers: jest.Mock<any>;
  };
  let mockChannelsService: {
    assertReadAccess: jest.Mock<any>;
    isMember: jest.Mock<any>;
  };

  const baseView = {
    id: viewId,
    channelId,
    name: 'Test View',
    type: 'table' as const,
    config: { filters: [], sorts: [] },
    order: 0,
    createdBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockViewsService = {
      findAllByChannel: jest.fn<any>().mockResolvedValue([baseView]),
      findByIdOrThrow: jest.fn<any>().mockResolvedValue(baseView),
      create: jest.fn<any>().mockResolvedValue(baseView),
      update: jest.fn<any>().mockResolvedValue(baseView),
      delete: jest.fn<any>().mockResolvedValue(undefined),
      queryMessages: jest
        .fn<any>()
        .mockResolvedValue({ messages: [], total: 0, cursor: null }),
      getTreeSnapshot: jest.fn<any>().mockResolvedValue({
        nodes: [],
        nextCursor: null,
        ancestorsIncluded: [],
      }),
    };
    mockWebsocketGateway = {
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(undefined),
    };
    mockChannelsService = {
      assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
      isMember: jest.fn<any>().mockResolvedValue(true),
    };

    controller = new ViewsController(
      mockViewsService as any,
      mockWebsocketGateway as any,
      mockChannelsService as any,
    );
  });

  // ==================== GET /views/:viewId/tree ====================

  describe('GET /views/:viewId/tree', () => {
    it('returns nodes + nextCursor + ancestorsIncluded', async () => {
      const treeResult = {
        nodes: [
          {
            messageId: 'msg-1',
            effectiveParentId: null,
            parentSource: null,
            depth: 0,
            hasChildren: true,
          },
        ],
        nextCursor: 'msg-1',
        ancestorsIncluded: [],
      };
      mockViewsService.getTreeSnapshot.mockResolvedValue(treeResult);

      const result = await controller.getTree(
        userId,
        channelId,
        viewId,
        3,
        undefined,
        undefined,
        50,
      );

      expect(result).toEqual(treeResult);
      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith({
        channelId,
        viewId,
        maxDepth: 3,
        limit: 50,
        cursor: null,
        expandedIds: [],
        filter: undefined,
        sort: undefined,
      });
    });

    it('rejects maxDepth > 5 with BadRequestException', async () => {
      await expect(
        controller.getTree(userId, channelId, viewId, 6),
      ).rejects.toThrow(BadRequestException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('rejects limit > 100 with BadRequestException', async () => {
      await expect(
        controller.getTree(
          userId,
          channelId,
          viewId,
          3,
          undefined,
          undefined,
          101,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('rejects invalid JSON filter with BadRequestException', async () => {
      await expect(
        controller.getTree(
          userId,
          channelId,
          viewId,
          3,
          undefined,
          undefined,
          50,
          'not-valid-json',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('rejects invalid JSON sort with BadRequestException', async () => {
      await expect(
        controller.getTree(
          userId,
          channelId,
          viewId,
          3,
          undefined,
          undefined,
          50,
          undefined,
          '{bad-json}',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('splits comma-separated expandedIds', async () => {
      const uuid1 = '00000000-0000-0000-0000-000000000011';
      const uuid2 = '00000000-0000-0000-0000-000000000022';
      const uuid3 = '00000000-0000-0000-0000-000000000033';
      await controller.getTree(
        userId,
        channelId,
        viewId,
        3,
        `${uuid1},${uuid2},${uuid3}`,
      );

      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          expandedIds: [uuid1, uuid2, uuid3],
        }),
      );
    });

    it('filters out empty strings from expandedIds', async () => {
      const uuid1 = '00000000-0000-0000-0000-000000000011';
      const uuid2 = '00000000-0000-0000-0000-000000000022';
      await controller.getTree(
        userId,
        channelId,
        viewId,
        3,
        `${uuid1},,${uuid2}`,
      );

      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          expandedIds: [uuid1, uuid2],
        }),
      );
    });

    it('parses valid JSON filter and sort', async () => {
      const filter = [{ propertyKey: 'status', operator: 'eq', value: 'open' }];
      const sort = [{ propertyKey: 'priority', direction: 'asc' }];

      await controller.getTree(
        userId,
        channelId,
        viewId,
        3,
        undefined,
        undefined,
        50,
        JSON.stringify(filter),
        JSON.stringify(sort),
      );

      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          filter,
          sort,
        }),
      );
    });

    it('passes cursor to getTreeSnapshot', async () => {
      const validCursor = '00000000-0000-0000-0000-000000000099';
      await controller.getTree(
        userId,
        channelId,
        viewId,
        3,
        undefined,
        validCursor,
      );

      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: validCursor,
        }),
      );
    });

    it('uses null cursor when no cursor param provided', async () => {
      await controller.getTree(userId, channelId, viewId);

      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: null,
        }),
      );
    });

    it('rejects non-UUID expandedIds entry with BadRequestException', async () => {
      await expect(
        controller.getTree(userId, channelId, viewId, 3, 'not-a-uuid'),
      ).rejects.toThrow(BadRequestException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('rejects non-UUID cursor with BadRequestException', async () => {
      await expect(
        controller.getTree(
          userId,
          channelId,
          viewId,
          3,
          undefined,
          'not-a-uuid-cursor',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('accepts valid UUID expandedIds', async () => {
      const validUuid = '00000000-0000-0000-0000-000000000099';
      await expect(
        controller.getTree(userId, channelId, viewId, 3, validUuid),
      ).resolves.not.toThrow();
      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          expandedIds: [validUuid],
        }),
      );
    });

    it('accepts valid UUID cursor', async () => {
      const validUuid = '00000000-0000-0000-0000-000000000099';
      await expect(
        controller.getTree(userId, channelId, viewId, 3, undefined, validUuid),
      ).resolves.not.toThrow();
      expect(mockViewsService.getTreeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: validUuid,
        }),
      );
    });

    it('throws NotFoundException when view does not belong to channel', async () => {
      mockViewsService.findByIdOrThrow.mockResolvedValue({
        ...baseView,
        channelId: 'different-channel',
      });

      await expect(
        controller.getTree(userId, channelId, viewId),
      ).rejects.toThrow(NotFoundException);
      expect(mockViewsService.getTreeSnapshot).not.toHaveBeenCalled();
    });

    it('calls assertReadAccess with correct channelId and userId', async () => {
      await controller.getTree(userId, channelId, viewId);

      expect(mockChannelsService.assertReadAccess).toHaveBeenCalledWith(
        channelId,
        userId,
      );
    });

    it('accepts maxDepth exactly equal to 5', async () => {
      await expect(
        controller.getTree(userId, channelId, viewId, 5),
      ).resolves.not.toThrow();
    });

    it('accepts limit exactly equal to 100', async () => {
      await expect(
        controller.getTree(
          userId,
          channelId,
          viewId,
          3,
          undefined,
          undefined,
          100,
        ),
      ).resolves.not.toThrow();
    });
  });
});
