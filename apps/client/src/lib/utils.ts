import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validate if a string is a valid UUID (RFC 4122)
 * Supports UUIDv1, UUIDv4, UUIDv7, etc.
 */
export function isValidUUID(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

/**
 * Check if a message ID is a temporary ID (used for optimistic updates)
 * Temporary IDs start with "temp-"
 */
export function isTemporaryId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  return id.startsWith("temp-");
}

/**
 * Check if a message ID is a valid permanent ID (not temporary)
 * Returns true if the ID is a valid UUID and not a temporary ID
 */
export function isValidMessageId(id: string): boolean {
  return isValidUUID(id) && !isTemporaryId(id);
}
