import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitSubscribe,
  RABBITMQ_QUEUES,
  RABBITMQ_EXCHANGES,
} from '@team9/rabbitmq';
import type {
  NotificationTask,
  MentionNotificationTask,
  ReplyNotificationTask,
  DMNotificationTask,
  WorkspaceInvitationNotificationTask,
  MemberJoinedNotificationTask,
  RoleChangedNotificationTask,
} from '@team9/shared';
import { NotificationTriggerService } from './notification-trigger.service.js';

/**
 * Notification Consumer Service for im-worker
 *
 * Consumes notification tasks from RabbitMQ queue and triggers notifications
 * After creating notifications, publishes delivery tasks to Gateway via RabbitMQ
 */
@Injectable()
export class NotificationConsumerService implements OnModuleInit {
  private readonly logger = new Logger(NotificationConsumerService.name);

  constructor(
    private readonly notificationTriggerService: NotificationTriggerService,
  ) {}

  onModuleInit() {
    this.logger.log('NotificationConsumerService initialized in im-worker');
  }

  /**
   * Handle notification tasks from RabbitMQ
   */
  @RabbitSubscribe({
    exchange: RABBITMQ_EXCHANGES.NOTIFICATION_EVENTS,
    routingKey: 'notification.#',
    queue: RABBITMQ_QUEUES.NOTIFICATION_TASKS,
    queueOptions: {
      durable: true,
    },
  })
  async handleNotificationTask(task: NotificationTask): Promise<void> {
    this.logger.debug(`Received notification task: ${task.type}`);

    try {
      switch (task.type) {
        case 'mention':
          await this.handleMentionTask(task as MentionNotificationTask);
          break;
        case 'reply':
          await this.handleReplyTask(task as ReplyNotificationTask);
          break;
        case 'dm':
          await this.handleDMTask(task as DMNotificationTask);
          break;
        case 'workspace_invitation':
          await this.handleWorkspaceInvitationTask(
            task as WorkspaceInvitationNotificationTask,
          );
          break;
        case 'member_joined':
          await this.handleMemberJoinedTask(
            task as MemberJoinedNotificationTask,
          );
          break;
        case 'role_changed':
          await this.handleRoleChangedTask(task as RoleChangedNotificationTask);
          break;
        default:
          this.logger.warn(
            `Unknown notification task type: ${(task as NotificationTask).type}`,
          );
      }
    } catch (error) {
      this.logger.error(`Failed to process notification task: ${error}`);
      throw error; // Let RabbitMQ handle retry
    }
  }

  private async handleMentionTask(
    task: MentionNotificationTask,
  ): Promise<void> {
    await this.notificationTriggerService.triggerMentionNotifications(
      task.payload,
    );
  }

  private async handleReplyTask(task: ReplyNotificationTask): Promise<void> {
    await this.notificationTriggerService.triggerReplyNotification(
      task.payload,
    );
  }

  private async handleDMTask(task: DMNotificationTask): Promise<void> {
    await this.notificationTriggerService.triggerDMNotification(task.payload);
  }

  private async handleWorkspaceInvitationTask(
    task: WorkspaceInvitationNotificationTask,
  ): Promise<void> {
    await this.notificationTriggerService.triggerWorkspaceInvitation(
      task.payload,
    );
  }

  private async handleMemberJoinedTask(
    task: MemberJoinedNotificationTask,
  ): Promise<void> {
    await this.notificationTriggerService.triggerMemberJoined(task.payload);
  }

  private async handleRoleChangedTask(
    task: RoleChangedNotificationTask,
  ): Promise<void> {
    await this.notificationTriggerService.triggerRoleChanged(task.payload);
  }
}
