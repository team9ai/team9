import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { channelSections } from './channel-sections.js';
import { channels } from './channels.js';
import { channelMembers } from './channel-members.js';
import { messages } from './messages.js';
import { messageAttachments } from './message-attachments.js';
import { messageReactions } from './message-reactions.js';
import { userChannelReadStatus } from './user-channel-read-status.js';
import { files } from './files.js';
import { notifications } from './notifications.js';
import {
  notificationPreferences,
  channelNotificationMutes,
} from './notification-preferences.js';
import { bots } from './bots.js';
import { tenants } from '../tenant/tenants.js';
import { tenantMembers } from '../tenant/tenant-members.js';

export const usersRelations = relations(users, ({ many, one }) => ({
  channelMemberships: many(channelMembers),
  sentMessages: many(messages),
  reactions: many(messageReactions),
  readStatuses: many(userChannelReadStatus),
  createdChannels: many(channels),
  tenantMemberships: many(tenantMembers),
  notifications: many(notifications),
  notificationPreferences: one(notificationPreferences),
  channelNotificationMutes: many(channelNotificationMutes),
  botProfile: one(bots),
  ownedBots: many(bots, { relationName: 'botOwner' }),
  mentoredBots: many(bots, { relationName: 'botMentor' }),
}));

export const channelSectionsRelations = relations(
  channelSections,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [channelSections.tenantId],
      references: [tenants.id],
    }),
    creator: one(users, {
      fields: [channelSections.createdBy],
      references: [users.id],
    }),
    channels: many(channels),
  }),
);

export const channelsRelations = relations(channels, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [channels.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [channels.createdBy],
    references: [users.id],
  }),
  section: one(channelSections, {
    fields: [channels.sectionId],
    references: [channelSections.id],
  }),
  members: many(channelMembers),
  messages: many(messages),
  readStatuses: many(userChannelReadStatus),
}));

export const channelMembersRelations = relations(channelMembers, ({ one }) => ({
  channel: one(channels, {
    fields: [channelMembers.channelId],
    references: [channels.id],
  }),
  user: one(users, {
    fields: [channelMembers.userId],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
  parent: one(messages, {
    fields: [messages.parentId],
    references: [messages.id],
    relationName: 'thread',
  }),
  replies: many(messages, { relationName: 'thread' }),
  attachments: many(messageAttachments),
  reactions: many(messageReactions),
}));

export const messageAttachmentsRelations = relations(
  messageAttachments,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageAttachments.messageId],
      references: [messages.id],
    }),
  }),
);

export const messageReactionsRelations = relations(
  messageReactions,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageReactions.messageId],
      references: [messages.id],
    }),
    user: one(users, {
      fields: [messageReactions.userId],
      references: [users.id],
    }),
  }),
);

export const userChannelReadStatusRelations = relations(
  userChannelReadStatus,
  ({ one }) => ({
    user: one(users, {
      fields: [userChannelReadStatus.userId],
      references: [users.id],
    }),
    channel: one(channels, {
      fields: [userChannelReadStatus.channelId],
      references: [channels.id],
    }),
    lastReadMessage: one(messages, {
      fields: [userChannelReadStatus.lastReadMessageId],
      references: [messages.id],
    }),
  }),
);

export const filesRelations = relations(files, ({ one }) => ({
  tenant: one(tenants, {
    fields: [files.tenantId],
    references: [tenants.id],
  }),
  channel: one(channels, {
    fields: [files.channelId],
    references: [channels.id],
  }),
  uploader: one(users, {
    fields: [files.uploaderId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  actor: one(users, {
    fields: [notifications.actorId],
    references: [users.id],
    relationName: 'notificationActor',
  }),
  tenant: one(tenants, {
    fields: [notifications.tenantId],
    references: [tenants.id],
  }),
  channel: one(channels, {
    fields: [notifications.channelId],
    references: [channels.id],
  }),
  message: one(messages, {
    fields: [notifications.messageId],
    references: [messages.id],
  }),
}));

export const notificationPreferencesRelations = relations(
  notificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const channelNotificationMutesRelations = relations(
  channelNotificationMutes,
  ({ one }) => ({
    user: one(users, {
      fields: [channelNotificationMutes.userId],
      references: [users.id],
    }),
    channel: one(channels, {
      fields: [channelNotificationMutes.channelId],
      references: [channels.id],
    }),
  }),
);

export const botsRelations = relations(bots, ({ one }) => ({
  user: one(users, {
    fields: [bots.userId],
    references: [users.id],
  }),
  owner: one(users, {
    fields: [bots.ownerId],
    references: [users.id],
    relationName: 'botOwner',
  }),
  mentor: one(users, {
    fields: [bots.mentorId],
    references: [users.id],
    relationName: 'botMentor',
  }),
}));
