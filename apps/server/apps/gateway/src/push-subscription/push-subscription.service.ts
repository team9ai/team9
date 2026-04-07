import { Injectable, Inject, Logger, ConflictException } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { SubscribePushDto } from './dto/subscribe-push.dto.js';

@Injectable()
export class PushSubscriptionService {
  private readonly logger = new Logger(PushSubscriptionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Subscribe (upsert) a push subscription.
   * If the endpoint already exists for the SAME user, update keys/userAgent.
   * If the endpoint belongs to a different user, the conflict update is
   * scoped by setWhere so the row is left untouched (no cross-user takeover).
   */
  async subscribe(
    userId: string,
    dto: SubscribePushDto,
    userAgent?: string,
  ): Promise<schema.PushSubscription> {
    const [subscription] = await this.db
      .insert(schema.pushSubscriptions)
      .values({
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: userAgent || null,
      })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        // Do NOT update userId on conflict — prevents cross-user endpoint
        // takeover. Only the original owner can refresh their keys.
        set: {
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          userAgent: userAgent || null,
        },
        setWhere: eq(schema.pushSubscriptions.userId, userId),
      })
      .returning();

    if (!subscription) {
      // setWhere prevented the update — endpoint belongs to a different user
      throw new ConflictException(
        'Push endpoint already registered by another account',
      );
    }

    this.logger.debug(
      `Upserted push subscription ${subscription.id} for user ${userId}`,
    );

    return subscription;
  }

  /**
   * Unsubscribe by endpoint, scoped to the authenticated user.
   */
  async unsubscribe(endpoint: string, userId: string): Promise<void> {
    await this.db
      .delete(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.endpoint, endpoint),
          eq(schema.pushSubscriptions.userId, userId),
        ),
      );

    this.logger.debug(
      `Deleted push subscription for endpoint ${endpoint} (user ${userId})`,
    );
  }

  /**
   * Unsubscribe all subscriptions for a user
   */
  async unsubscribeAll(userId: string): Promise<void> {
    await this.db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId));

    this.logger.debug(`Deleted all push subscriptions for user ${userId}`);
  }

  /**
   * Get all subscriptions for a user
   */
  async getSubscriptions(userId: string): Promise<schema.PushSubscription[]> {
    return this.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId));
  }

  /**
   * Remove a subscription by ID (for stale cleanup)
   */
  async removeSubscription(id: string): Promise<void> {
    await this.db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.id, id));

    this.logger.debug(`Removed push subscription ${id}`);
  }

  /**
   * Update lastUsedAt timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    await this.db
      .update(schema.pushSubscriptions)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(schema.pushSubscriptions.id, id));
  }
}
