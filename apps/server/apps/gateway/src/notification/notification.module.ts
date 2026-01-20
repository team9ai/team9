import { Module, forwardRef, OnModuleInit, Inject } from '@nestjs/common';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationDeliveryConsumerService } from './notification-delivery-consumer.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { WebsocketGateway } from '../im/websocket/websocket.gateway.js';

/**
 * Notification Module for Gateway
 *
 * Handles notification delivery (WebSocket push) and read operations:
 * - NotificationService: CRUD operations for notifications (read, mark-read, archive)
 * - NotificationDeliveryService: WebSocket push to online users
 * - NotificationDeliveryConsumerService: Consumes delivery tasks from RabbitMQ
 *
 * Note: Notification creation/processing is handled by im-worker
 */
@Module({
  imports: [AuthModule, forwardRef(() => WebsocketModule)],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationDeliveryService,
    NotificationDeliveryConsumerService,
  ],
  exports: [NotificationService, NotificationDeliveryService],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly deliveryService: NotificationDeliveryService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  onModuleInit() {
    // Set the WebSocket gateway reference to avoid circular dependency
    this.deliveryService.setWebsocketGateway(this.websocketGateway);
  }
}
