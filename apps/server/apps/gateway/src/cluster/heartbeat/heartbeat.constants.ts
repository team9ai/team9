/**
 * Heartbeat configuration constants
 */
export const HEARTBEAT_CONFIG = {
  // Client ping interval (seconds) - client should send ping every 30s
  PING_INTERVAL: 30,

  // Server timeout (seconds) - if no heartbeat for 90s, consider dead
  // This is 3x the ping interval to allow for some network delays
  TIMEOUT: 90,

  // Zombie check interval (seconds) - how often to scan for zombies
  ZOMBIE_CHECK_INTERVAL: 30,

  // Max zombies to clean per batch
  ZOMBIE_BATCH_SIZE: 100,

  // Grace period before marking as zombie (seconds)
  GRACE_PERIOD: 10,
} as const;
