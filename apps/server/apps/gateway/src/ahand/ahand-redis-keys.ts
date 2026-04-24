/**
 * Redis key builders for the ahand feature.
 * Centralised here so both the devices service and webhook service
 * use identical key formats — a divergence would cause presence reads
 * to miss webhook-written keys silently.
 */

/** Presence key for a device: value is "online" when the device is connected. */
export function devicePresenceKey(hubDeviceId: string): string {
  return `ahand:device:${hubDeviceId}:presence`;
}

/** Deduplication key for a webhook event. */
export function webhookDedupeKey(eventId: string): string {
  return `ahand:webhook:seen:${eventId}`;
}
