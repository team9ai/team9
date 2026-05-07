export const USER_PROFILE_EVENTS = {
  UPDATED: 'user.profile.updated',
} as const;

export interface UserProfileUpdatedEvent {
  userId: string;
}
