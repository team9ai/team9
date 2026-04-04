import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { env } from '@team9/shared';
import { PushSubscriptionService } from '../push-subscription/push-subscription.service.js';
import type { NotificationPayload } from './notification-delivery.service.js';

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private enabled = false;

  constructor(
    private readonly pushSubscriptionService: PushSubscriptionService,
  ) {}

  onModuleInit(): void {
    const publicKey = env.VAPID_PUBLIC_KEY;
    const privateKey = env.VAPID_PRIVATE_KEY;

    if (publicKey && privateKey) {
      webpush.setVapidDetails(env.VAPID_SUBJECT, publicKey, privateKey);
      this.enabled = true;
      this.logger.log('Web Push configured with VAPID keys');
    } else {
      this.enabled = false;
      this.logger.log(
        'Web Push disabled: VAPID_PUBLIC_KEY and/or VAPID_PRIVATE_KEY not configured',
      );
    }
  }

  /**
   * Whether Web Push is enabled (VAPID keys are configured).
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a push notification to all of the user's registered push subscriptions.
   *
   * - On success: updates the subscription's lastUsedAt timestamp.
   * - On 404/410 (expired/invalid endpoint): removes the subscription.
   * - On other errors: logs a warning but does not throw.
   */
  async sendPush(
    userId: string,
    notification: NotificationPayload,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const subscriptions =
      await this.pushSubscriptionService.getSubscriptions(userId);

    if (subscriptions.length === 0) {
      return;
    }

    const payloadStr = JSON.stringify({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      category: notification.category,
      actionUrl: notification.actionUrl,
      actor: notification.actor
        ? { avatarUrl: notification.actor.avatarUrl }
        : null,
    });

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payloadStr,
          );

          await this.pushSubscriptionService.updateLastUsed(sub.id);
        } catch (error: unknown) {
          const statusCode = (error as { statusCode?: number }).statusCode;

          if (statusCode === 404 || statusCode === 410) {
            this.logger.warn(
              `Push endpoint expired/invalid for subscription ${sub.id}, removing`,
            );
            await this.pushSubscriptionService.removeSubscription(sub.id);
          } else {
            this.logger.warn(
              `Failed to send push to subscription ${sub.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }),
    );
  }
}
