/** Epoch seconds or milliseconds (the live graph stores ms, older nodes seconds) to ms; undefined if not a positive number. */
export function graphEpochToMs(value: unknown): number | undefined {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return v > 1e12 ? v : v * 1000;
}

/**
 * Any graph time to ms: an ISO string, epoch ms (number or numeric string) or
 * legacy epoch seconds (float or numeric string). undefined when missing or
 * unparseable. Readers of `updated_at` / `created_at` use this so the stored
 * format can move from ISO to epoch ms without breaking them.
 */
export function graphTimeToMs(value: unknown): number | undefined {
  if (typeof value === "number") return graphEpochToMs(value);
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t)) return graphEpochToMs(t);
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}
