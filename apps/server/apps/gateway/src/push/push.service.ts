import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { PushPlatform } from '@team9/database/schemas';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?:
      | 'DeviceNotRegistered'
      | 'InvalidCredentials'
      | 'MessageTooBig'
      | 'MessageRateExceeded';
  };
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Register (upsert) a push token for the given user.
   * If the same (userId, token) pair already exists, update the platform and timestamp.
   */
  async registerToken(
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<{ message: string }> {
    await this.db
      .insert(schema.userPushTokens)
      .values({
        userId,
        token,
        platform,
      })
      .onConflictDoUpdate({
        target: [schema.userPushTokens.userId, schema.userPushTokens.token],
        set: {
          platform,
          updatedAt: new Date(),
        },
      });

    return { message: 'Push token registered.' };
  }

  /**
   * Remove a push token for the given user.
   */
  async unregisterToken(
    userId: string,
    token: string,
  ): Promise<{ message: string }> {
    await this.db
      .delete(schema.userPushTokens)
      .where(
        and(
          eq(schema.userPushTokens.userId, userId),
          eq(schema.userPushTokens.token, token),
        ),
      );

    return { message: 'Push token removed.' };
  }

  /**
   * Send a push notification to all registered devices for a user.
   */
  async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const tokens = await this.db
      .select()
      .from(schema.userPushTokens)
      .where(eq(schema.userPushTokens.userId, userId));

    if (tokens.length === 0) {
      return;
    }

    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data,
      sound: 'default' as const,
    }));

    const tickets = await this.sendToExpo(messages);
    await this.handleTicketErrors(tickets, tokens);
  }

  /**
   * POST messages to the Expo Push API.
   */
  async sendToExpo(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        this.logger.error(
          `Expo Push API responded with status ${response.status}`,
        );
        return [];
      }

      const result = (await response.json()) as { data: ExpoPushTicket[] };
      return result.data ?? [];
    } catch (error) {
      this.logger.error('Failed to send push notifications via Expo', error);
      return [];
    }
  }

  /**
   * Process ticket errors and remove invalid tokens (DeviceNotRegistered).
   */
  private async handleTicketErrors(
    tickets: ExpoPushTicket[],
    tokens: schema.UserPushToken[],
  ): Promise<void> {
    const invalidTokenValues: string[] = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        const token = tokens[i];
        if (token) {
          invalidTokenValues.push(token.token);
        }
      }
    }

    if (invalidTokenValues.length > 0) {
      await this.removeInvalidTokens(invalidTokenValues);
    }
  }

  /**
   * Remove tokens that the Expo Push API reports as invalid.
   */
  async removeInvalidTokens(tokenValues: string[]): Promise<void> {
    for (const tokenValue of tokenValues) {
      try {
        await this.db
          .delete(schema.userPushTokens)
          .where(eq(schema.userPushTokens.token, tokenValue));

        this.logger.log(
          `Removed invalid push token: ${tokenValue.slice(0, 10)}...`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to remove invalid push token: ${tokenValue.slice(0, 10)}...`,
          error,
        );
      }
    }
  }
}
