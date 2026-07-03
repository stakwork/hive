/**
 * Locked structured-frame contract for error reporting SDKs.
 *
 * Field names are STABLE — the Rails SDK builds against this exact shape.
 * Do NOT add or rename fields without coordinating SDK changes.
 */

export interface StructuredFrame {
  filename: string;
  function?: string;
  lineno?: number;
  inApp?: boolean;
}

/**
 * Sanitize a raw (unknown) frames value from an ingest payload.
 *
 * - Requires each entry to have a non-empty string `filename`; drops the
 *   entire entry if it is missing or invalid.
 * - Coerces `function` to string (drops if not coercible to a non-empty string).
 * - Coerces `lineno` to a positive integer (drops if 0, negative, or non-numeric).
 * - Coerces `inApp` to boolean (drops if absent or not coercible).
 * - Returns an empty array if the input is not an array.
 * - Never includes fields beyond the four above (strips unknown properties).
 */
export function sanitizeFrames(raw: unknown): StructuredFrame[] {
  if (!Array.isArray(raw)) return [];

  const result: StructuredFrame[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const e = entry as Record<string, unknown>;

    // filename is required and must be a non-empty string
    if (typeof e.filename !== "string" || !e.filename.trim()) continue;

    const frame: StructuredFrame = { filename: e.filename.trim() };

    // function — coerce to string or omit
    if (e.function !== undefined && e.function !== null) {
      const fn = String(e.function).trim();
      if (fn) frame.function = fn;
    }

    // lineno — coerce to positive integer or omit
    if (e.lineno !== undefined && e.lineno !== null) {
      const n = Number(e.lineno);
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
        frame.lineno = n;
      }
    }

    // inApp — coerce to boolean or omit
    if (e.inApp !== undefined && e.inApp !== null) {
      frame.inApp = Boolean(e.inApp);
    }

    result.push(frame);
  }

  return result;
}
