import { slugify } from 'transliteration';

/**
 * Generate a URL-friendly slug from the given string.
 */
export function generateSlug(input: string, maxLength = 50): string {
  let slug = slugify(input, { lowercase: true, separator: '-' })
    .replace(/^-+|-+$/g, '')
    .substring(0, maxLength);

  // Fallback if slug is empty after sanitization
  if (!slug) {
    slug = 'workspace';
  }

  return slug;
}

/**
 * Generate a short random alphanumeric ID.
 */
export function generateShortId(length = 4): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Append a random suffix to make a slug unique.
 */
export function appendSlugSuffix(slug: string, suffix?: string): string {
  return suffix ? `${slug}-${suffix}` : slug;
}
