import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

export interface NotificationPreferencesResponse {
  mentionsEnabled: boolean;
  repliesEnabled: boolean;
  dmsEnabled: boolean;
  systemEnabled: boolean;
  workspaceEnabled: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  dndEnabled: boolean;
  dndStart: Date | null;
  dndEnd: Date | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_PREFERENCES: NotificationPreferencesResponse = {
  mentionsEnabled: true,
  repliesEnabled: true,
  dmsEnabled: true,
  systemEnabled: true,
  workspaceEnabled: true,
  desktopEnabled: true,
  soundEnabled: true,
  dndEnabled: false,
  dndStart: null,
  dndEnd: null,
  settings: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Maps notification types to the corresponding preference field.
 */
const NOTIFICATION_TYPE_TO_PREFERENCE: Record<
  string,
  keyof Pick<
    schema.NotificationPreferences,
    | 'mentionsEnabled'
    | 'repliesEnabled'
    | 'dmsEnabled'
    | 'systemEnabled'
    | 'workspaceEnabled'
  >
> = {
  // Mentions
  mention: 'mentionsEnabled',
  channel_mention: 'mentionsEnabled',
  everyone_mention: 'mentionsEnabled',
  here_mention: 'mentionsEnabled',
  // Replies
  reply: 'repliesEnabled',
  thread_reply: 'repliesEnabled',
  // Direct messages
  dm_received: 'dmsEnabled',
  // System
  system_announcement: 'systemEnabled',
  maintenance_notice: 'systemEnabled',
  version_update: 'systemEnabled',
  // Workspace
  workspace_invitation: 'workspaceEnabled',
  role_changed: 'workspaceEnabled',
  member_joined: 'workspaceEnabled',
  member_left: 'workspaceEnabled',
  channel_invite: 'workspaceEnabled',
};

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get notification preferences for a user.
   * Returns default values if no preferences row exists.
   */
  async getPreferences(
    userId: string,
  ): Promise<NotificationPreferencesResponse> {
    const rows = await this.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId))
      .limit(1);

    if (rows.length === 0) {
      return {
        ...DEFAULT_PREFERENCES,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const row = rows[0];
    return {
      mentionsEnabled: row.mentionsEnabled,
      repliesEnabled: row.repliesEnabled,
      dmsEnabled: row.dmsEnabled,
      systemEnabled: row.systemEnabled,
      workspaceEnabled: row.workspaceEnabled,
      desktopEnabled: row.desktopEnabled,
      soundEnabled: row.soundEnabled,
      dndEnabled: row.dndEnabled,
      dndStart: row.dndStart,
      dndEnd: row.dndEnd,
      settings: row.settings,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Upsert notification preferences for a user.
   * Only updates fields present in the DTO.
   */
  async upsertPreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    const now = new Date();
    const updateFields = this.buildUpdateFields(dto, now);

    const [row] = await this.db
      .insert(schema.notificationPreferences)
      .values({
        id: crypto.randomUUID(),
        userId,
        ...this.buildInsertFields(dto),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.notificationPreferences.userId,
        set: updateFields,
      })
      .returning();

    this.logger.debug(`Upserted notification preferences for user ${userId}`);

    return {
      mentionsEnabled: row.mentionsEnabled,
      repliesEnabled: row.repliesEnabled,
      dmsEnabled: row.dmsEnabled,
      systemEnabled: row.systemEnabled,
      workspaceEnabled: row.workspaceEnabled,
      desktopEnabled: row.desktopEnabled,
      soundEnabled: row.soundEnabled,
      dndEnabled: row.dndEnabled,
      dndStart: row.dndStart,
      dndEnd: row.dndEnd,
      settings: row.settings,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Check whether a notification should be delivered to a user
   * based on their preferences and DND status.
   *
   * Returns both the decision and the fetched preferences so callers
   * can reuse them without a second DB round-trip.
   */
  async shouldNotify(
    userId: string,
    notificationType: string,
    _category: string,
  ): Promise<{
    allowed: boolean;
    preferences: NotificationPreferencesResponse;
  }> {
    const prefs = await this.getPreferences(userId);

    // Check DND first
    if (this.isInDndWindow(prefs)) {
      return { allowed: false, preferences: prefs };
    }

    // Map the notification type to its preference field
    const preferenceField = NOTIFICATION_TYPE_TO_PREFERENCE[notificationType];
    if (!preferenceField) {
      // Unknown type — allow by default
      return { allowed: true, preferences: prefs };
    }

    return { allowed: prefs[preferenceField], preferences: prefs };
  }

  /**
   * Check if the user is currently in a DND window.
   */
  private isInDndWindow(prefs: NotificationPreferencesResponse): boolean {
    if (!prefs.dndEnabled || !prefs.dndStart || !prefs.dndEnd) {
      return false;
    }

    const now = new Date();
    const todayStart = this.toTodayTime(prefs.dndStart);
    const todayEnd = this.toTodayTime(prefs.dndEnd);

    // Handle overnight DND windows (e.g. 22:00 → 07:00)
    if (todayStart <= todayEnd) {
      return now >= todayStart && now <= todayEnd;
    }
    // Overnight: either after start or before end
    return now >= todayStart || now <= todayEnd;
  }

  /**
   * Convert a stored DND time to today's date (UTC) with the same hour/minute/second.
   * Uses UTC methods so behavior is consistent regardless of server timezone.
   */
  private toTodayTime(storedTime: Date): Date {
    const now = new Date();
    const result = new Date(now);
    result.setUTCHours(
      storedTime.getUTCHours(),
      storedTime.getUTCMinutes(),
      storedTime.getUTCSeconds(),
      storedTime.getUTCMilliseconds(),
    );
    return result;
  }

  /**
   * Build the insert values from DTO, using defaults for missing fields.
   */
  private buildInsertFields(
    dto: UpdateNotificationPreferencesDto,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    if (dto.mentionsEnabled !== undefined)
      fields.mentionsEnabled = dto.mentionsEnabled;
    if (dto.repliesEnabled !== undefined)
      fields.repliesEnabled = dto.repliesEnabled;
    if (dto.dmsEnabled !== undefined) fields.dmsEnabled = dto.dmsEnabled;
    if (dto.systemEnabled !== undefined)
      fields.systemEnabled = dto.systemEnabled;
    if (dto.workspaceEnabled !== undefined)
      fields.workspaceEnabled = dto.workspaceEnabled;
    if (dto.desktopEnabled !== undefined)
      fields.desktopEnabled = dto.desktopEnabled;
    if (dto.soundEnabled !== undefined) fields.soundEnabled = dto.soundEnabled;
    if (dto.dndEnabled !== undefined) fields.dndEnabled = dto.dndEnabled;
    if (dto.dndStart !== undefined) {
      fields.dndStart = dto.dndStart !== null ? new Date(dto.dndStart) : null;
    }
    if (dto.dndEnd !== undefined) {
      fields.dndEnd = dto.dndEnd !== null ? new Date(dto.dndEnd) : null;
    }

    return fields;
  }

  /**
   * Build only the fields present in the DTO for the update set clause.
   */
  private buildUpdateFields(
    dto: UpdateNotificationPreferencesDto,
    now: Date,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = { updatedAt: now };

    if (dto.mentionsEnabled !== undefined)
      fields.mentionsEnabled = dto.mentionsEnabled;
    if (dto.repliesEnabled !== undefined)
      fields.repliesEnabled = dto.repliesEnabled;
    if (dto.dmsEnabled !== undefined) fields.dmsEnabled = dto.dmsEnabled;
    if (dto.systemEnabled !== undefined)
      fields.systemEnabled = dto.systemEnabled;
    if (dto.workspaceEnabled !== undefined)
      fields.workspaceEnabled = dto.workspaceEnabled;
    if (dto.desktopEnabled !== undefined)
      fields.desktopEnabled = dto.desktopEnabled;
    if (dto.soundEnabled !== undefined) fields.soundEnabled = dto.soundEnabled;
    if (dto.dndEnabled !== undefined) fields.dndEnabled = dto.dndEnabled;
    if (dto.dndStart !== undefined) {
      fields.dndStart = dto.dndStart !== null ? new Date(dto.dndStart) : null;
    }
    if (dto.dndEnd !== undefined) {
      fields.dndEnd = dto.dndEnd !== null ? new Date(dto.dndEnd) : null;
    }

    return fields;
  }
}
