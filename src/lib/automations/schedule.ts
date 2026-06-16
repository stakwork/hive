/**
 * Timezone-aware scheduling helpers for recurring Automations.
 *
 * An automation stores a wall-clock `timeOfDay` ("HH:MM") plus an IANA
 * `timezone`. The cron needs the next UTC instant at which that local
 * wall-clock time occurs. We compute it with `Intl.DateTimeFormat` (no
 * external tz library is installed) so it stays DST-correct.
 */

/** Matches a 24-hour "HH:MM" wall-clock time. */
const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_RE.test(value);
}

/** Validate an IANA timezone by asking `Intl` to format with it. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset of a timezone from UTC, in milliseconds, at a given instant.
 * Positive east of UTC. DST-aware because it asks `Intl` what the local
 * wall-clock reads at that exact instant.
 */
function tzOffsetMs(utcMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asIfUtc - utcMs;
}

/**
 * The UTC `Date` corresponding to a wall-clock `Y-M-D HH:MM:00` in
 * `timezone`. Resolves the offset twice to settle DST boundary jumps.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = wallAsUtc - tzOffsetMs(wallAsUtc, timezone);
  // Re-resolve against the candidate instant to correct DST transitions.
  utc = wallAsUtc - tzOffsetMs(utc, timezone);
  return new Date(utc);
}

/** Extract the calendar Y/M/D shown in `timezone` for a given instant. */
function zonedYmd(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Compute the next UTC instant at which `timeOfDay` ("HH:MM") occurs in
 * `timezone`, strictly after `from`. If today's occurrence is still in the
 * future it's used; otherwise the next day's.
 */
export function computeNextRunAt(
  timeOfDay: string,
  timezone: string,
  from: Date = new Date(),
): Date {
  const m = TIME_OF_DAY_RE.exec(timeOfDay);
  if (!m) {
    throw new Error(`Invalid timeOfDay: ${timeOfDay}`);
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);

  const { year, month, day } = zonedYmd(from, timezone);
  const todayRun = zonedWallTimeToUtc(year, month, day, hour, minute, timezone);
  if (todayRun.getTime() > from.getTime()) {
    return todayRun;
  }
  // Advance one calendar day in the target zone (handles month/year rollover
  // because we re-derive the wall time through Date.UTC).
  const tomorrow = zonedWallTimeToUtc(
    year,
    month,
    day + 1,
    hour,
    minute,
    timezone,
  );
  return tomorrow;
}

/**
 * Human label for a schedule, e.g. "Daily at 4:00 AM". Rendered in the UI.
 */
export function describeSchedule(timeOfDay: string, timezone?: string): string {
  const m = TIME_OF_DAY_RE.exec(timeOfDay);
  if (!m) return timeOfDay;
  let hour = Number(m[1]);
  const minute = m[2];
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  const tzSuffix = timezone ? ` ${timezone}` : "";
  return `Daily at ${hour}:${minute} ${period}${tzSuffix}`;
}
