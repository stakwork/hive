/**
 * Safe ID validation for use in URL interpolation.
 * Accepts numeric IDs, UUID (v4-style) strings, and alphanumeric slug IDs.
 * Rejects path traversal sequences, slashes, spaces, and shell metacharacters.
 */
const SAFE_ID_RE = /^[a-zA-Z0-9-]+$/;

export function isSafeId(value: string): boolean {
  return SAFE_ID_RE.test(value) && !value.includes("..");
}
