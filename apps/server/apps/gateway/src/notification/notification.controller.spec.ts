import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

describe('NotificationController markAllAsRead', () => {
  let controller: NotificationController;
  let notificationService: {
    getUnreadNotificationIds: jest.Mock<any>;
    markAllAsRead: jest.Mock<any>;
    getUnreadCounts: jest.Mock<any>;
  };
  let deliveryService: {
    broadcastNotificationRead: jest.Mock<any>;
    broadcastCountsUpdate: jest.Mock<any>;
  };

  beforeEach(() => {
    notificationService = {
      getUnreadNotificationIds: jest
        .fn<any>()
        .mockResolvedValue(['notif-1', 'notif-2']),
      markAllAsRead: jest.fn<any>().mockResolvedValue(undefined),
      getUnreadCounts: jest.fn<any>().mockResolvedValue({
        total: 0,
        byCategory: { message: 0, system: 0, workspace: 0 },
        byType: {},
      }),
    };
    deliveryService = {
      broadcastNotificationRead: jest.fn<any>().mockResolvedValue(undefined),
      broadcastCountsUpdate: jest.fn<any>().mockResolvedValue(undefined),
    };

    controller = new NotificationController(
      notificationService as unknown as NotificationService,
      deliveryService as unknown as NotificationDeliveryService,
    );
  });

  it('parses comma-separated types and forwards them to the service', async () => {
    await controller.markAllAsRead(
      'user-1',
      'message',
      'mention, reply,thread_reply',
    );

    expect(notificationService.markAllAsRead).toHaveBeenCalledWith(
      'user-1',
      'message',
      ['mention', 'reply', 'thread_reply'],
    );
    expect(deliveryService.broadcastNotificationRead).toHaveBeenCalledWith(
      'user-1',
      ['notif-1', 'notif-2'],
    );
    expect(deliveryService.broadcastCountsUpdate).toHaveBeenCalled();
  });

  it('passes undefined types through to the service', async () => {
    await controller.markAllAsRead('user-1', 'message', undefined);

    expect(notificationService.markAllAsRead).toHaveBeenCalledWith(
      'user-1',
      'message',
      undefined,
    );
    expect(deliveryService.broadcastCountsUpdate).toHaveBeenCalled();
  });

  it('rejects unknown types with 400 before calling the service', async () => {
    await expect(
      controller.markAllAsRead('user-1', 'message', 'mention,not_a_real_type'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(notificationService.markAllAsRead).not.toHaveBeenCalled();
    expect(deliveryService.broadcastCountsUpdate).not.toHaveBeenCalled();
  });

  it('rejects empty string with 400 before calling the service', async () => {
    await expect(
      controller.markAllAsRead('user-1', 'message', ''),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(notificationService.markAllAsRead).not.toHaveBeenCalled();
    expect(deliveryService.broadcastCountsUpdate).not.toHaveBeenCalled();
  });

  it('rejects array input with 400 before calling the service', async () => {
    await expect(
      controller.markAllAsRead('user-1', 'message', [
        'mention',
        'reply',
      ] as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(notificationService.markAllAsRead).not.toHaveBeenCalled();
    expect(deliveryService.broadcastCountsUpdate).not.toHaveBeenCalled();
  });

  it('rejects repeated-param shape with empty token 400 before calling the service', async () => {
    await expect(
      controller.markAllAsRead('user-1', 'message', 'mention,,reply'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(notificationService.markAllAsRead).not.toHaveBeenCalled();
    expect(deliveryService.broadcastCountsUpdate).not.toHaveBeenCalled();
  });
});
