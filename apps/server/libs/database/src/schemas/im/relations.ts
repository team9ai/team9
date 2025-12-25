import { relations } from 'drizzle-orm';
import { users } from './users';
import { channels } from './channels';
import { channelMembers } from './channel-members';
import { messages } from './messages';
import { messageAttachments } from './message-attachments';
import { messageReactions } from './message-reactions';
import { userChannelReadStatus } from './user-channel-read-status';
import { mentions } from './mentions';

export const usersRelations = relations(users, ({ many }) => ({
  channelMemberships: many(channelMembers),
  sentMessages: many(messages),
  reactions: many(messageReactions),
  readStatuses: many(userChannelReadStatus),
  mentions: many(mentions),
  createdChannels: many(channels),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  creator: one(users, {
    fields: [channels.createdBy],
    references: [users.id],
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
  mentions: many(mentions),
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

export const mentionsRelations = relations(mentions, ({ one }) => ({
  message: one(messages, {
    fields: [mentions.messageId],
    references: [messages.id],
  }),
  mentionedUser: one(users, {
    fields: [mentions.mentionedUserId],
    references: [users.id],
  }),
  mentionedChannel: one(channels, {
    fields: [mentions.mentionedChannelId],
    references: [channels.id],
  }),
}));
