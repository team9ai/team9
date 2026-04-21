import { Module, forwardRef, OnModuleInit, Inject } from '@nestjs/common';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationDeliveryConsumerService } from './notification-delivery-consumer.service.js';
import { WebPushService } from './web-push.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import { PushSubscriptionModule } from '../push-subscription/push-subscription.module.js';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module.js';
import { PushModule } from '../push/push.module.js';

/**
 * Notification Module for Gateway
 *
 * Handles notification delivery (WebSocket + Web Push + Mobile Push) and read operations:
 * - NotificationService: CRUD operations for notifications (read, mark-read, archive)
 * - NotificationDeliveryService: WebSocket push to online users + Web Push + Expo Push to all subscriptions
 * - NotificationDeliveryConsumerService: Consumes delivery tasks from RabbitMQ
 * - WebPushService: Sends OS-level push notifications via the Web Push protocol
 * - ExpoPushService: Sends mobile push notifications via the Expo Push API
 *
 * Note: Notification creation/processing is handled by im-worker
 */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    PushSubscriptionModule,
    NotificationPreferencesModule,
    PushModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationDeliveryService,
    NotificationDeliveryConsumerService,
    WebPushService,
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
    // eslint-disable-next-line no-console
    console.log('[DEBUG/NOTM] onModuleInit enter');
    // Set the WebSocket gateway reference to avoid circular dependency
    this.deliveryService.setWebsocketGateway(this.websocketGateway);
  }
}
