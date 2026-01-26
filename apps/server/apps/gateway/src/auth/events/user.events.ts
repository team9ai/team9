export const USER_EVENTS = {
  REGISTERED: 'user.registered',
} as const;

export interface UserRegisteredEvent {
  userId: string;
  displayName: string;
}
