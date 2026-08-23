/**
 * Security, sanitization, and ID validation helpers for A.W.R.F.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a standard RFC 4122 UUID.
 */
export function isValidUuid(id: unknown): id is string {
  if (!id || typeof id !== "string") return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Sanitizes and bounds display names.
 * Strips HTML tags, control characters, and limits to 50 characters.
 */
export function sanitizeDisplayName(
  name: unknown
): string | null {
  if (!name || typeof name !== "string") return null;

  const cleaned = name
    .replace(/[<>'"&]/g, "") // strip HTML tags/dangerous characters
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // strip control characters
    .replace(/\s+/g, " ") // normalize repeated whitespace
    .trim();

  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 50);
}
