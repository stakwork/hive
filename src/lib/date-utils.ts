/**
 * Returns 'Today', 'Yesterday', or 'Oct 12, 2025' for older dates.
 * Used as day separator labels in chat views.
 */
export function formatDaySeparatorLabel(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();

  // Compare calendar days in local time
  const toMidnight = (dt: Date) =>
    new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();

  const diffDays = Math.round(
    (toMidnight(now) - toMidnight(d)) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Returns true when two dates fall on the same calendar day (local time).
 */
export function isSameCalendarDay(a: string | Date, b: string | Date): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Format a date as relative time for recent dates, or as a date string for older dates.
 * - Within last 2 days: "2 hrs ago", "Yesterday", "2 days ago"
 * - Older than 2 days: "Nov 1, 2023" (date only, no time)
 */
export function formatRelativeOrDate(date: string | Date): string {
  const dateObj = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Less than 1 minute
  if (diffSeconds < 60) {
    return 'Just now';
  }

  // Less than 1 hour
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 min ago' : `${diffMinutes} mins ago`;
  }

  // Less than 24 hours
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hr ago' : `${diffHours} hrs ago`;
  }

  // Yesterday
  if (diffDays === 1) {
    return 'Yesterday';
  }

  // 2 days ago
  if (diffDays === 2) {
    return '2 days ago';
  }

  // More than 2 days ago - show date only
  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date as a localized date string.
 * Example: "Nov 1, 2023"
 */
export function formatFeatureDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Check if a date should be formatted as relative time.
 * Returns true for dates within 48 hours (2 days) of now.
 */
export function isRelativeFormat(date: string | Date): boolean {
  const dateObj = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // Include dates from 0 to just under 48 hours
  // At exactly 48 hours or more, return false (use absolute format)
  return diffHours >= 0 && diffHours <= 48;
}

// ─── Timezone-aware date utilities ───────────────────────────────────────────

/**
 * Helper: extract the short timezone abbreviation (e.g. "EST", "PDT") for a
 * given IANA timezone at a given instant.
 */
function getTzAbbrev(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return "UTC";
  }
}

/**
 * Helper: extract { year, month, day } in the given IANA timezone.
 * Month is 1-based.
 */
function zonedYmdLocal(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(date);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");
    return { year: get("year"), month: get("month"), day: get("day") };
  } catch {
    return zonedYmdLocal(date, "UTC");
  }
}

/**
 * Format a date in the user's IANA timezone, appending the short timezone
 * abbreviation (e.g. "Jun 23, 2026, 10:00 AM EST").
 *
 * Falls back to UTC on any invalid timezone string.
 */
export function formatInUserTz(
  date: string | Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = new Date(date);
  const safeZone = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();

  const defaultOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: safeZone,
  };

  const merged = options ? { ...defaultOptions, ...options, timeZone: safeZone } : defaultOptions;
  return new Intl.DateTimeFormat("en-US", merged).format(d);
}

/**
 * Same relative-vs-absolute logic as `formatRelativeOrDate`, but day-boundary
 * comparisons ("Yesterday") are evaluated in the user's IANA timezone and the
 * absolute branch uses `formatInUserTz` (includes the tz abbreviation).
 *
 * Falls back to UTC on any invalid timezone string.
 */
export function formatRelativeOrDateInTz(
  date: string | Date,
  timezone: string,
): string {
  const dateObj = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffSeconds < 60) return "Just now";
  if (diffMinutes < 60) return diffMinutes === 1 ? "1 min ago" : `${diffMinutes} mins ago`;
  if (diffHours < 24) return diffHours === 1 ? "1 hr ago" : `${diffHours} hrs ago`;

  // For day-boundary comparisons, use the user's wall clock.
  const safeZone = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();

  const nowYmd = zonedYmdLocal(now, safeZone);
  const dateYmd = zonedYmdLocal(dateObj, safeZone);

  // Compute calendar-day diff in the user's timezone
  const nowMidnight = Date.UTC(nowYmd.year, nowYmd.month - 1, nowYmd.day);
  const dateMidnight = Date.UTC(dateYmd.year, dateYmd.month - 1, dateYmd.day);
  const diffDays = Math.round((nowMidnight - dateMidnight) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return "Yesterday";
  if (diffDays === 2) return "2 days ago";

  return formatInUserTz(dateObj, safeZone);
}

/**
 * Returns "Today", "Yesterday", or a formatted date string (e.g. "Oct 12, 2025")
 * with all comparisons done in the user's IANA timezone.
 *
 * Falls back to UTC on any invalid timezone string.
 */
export function formatDaySeparatorLabelInTz(
  date: string | Date,
  timezone: string,
): string {
  const d = new Date(date);
  const now = new Date();

  const safeZone = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();

  const nowYmd = zonedYmdLocal(now, safeZone);
  const dateYmd = zonedYmdLocal(d, safeZone);

  const nowMidnight = Date.UTC(nowYmd.year, nowYmd.month - 1, nowYmd.day);
  const dateMidnight = Date.UTC(dateYmd.year, dateYmd.month - 1, dateYmd.day);
  const diffDays = Math.round((nowMidnight - dateMidnight) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: safeZone,
  }).format(d);
}

/**
 * Format duration in hours to a human-readable string.
 * - Less than 24 hours: "2.5h"
 * - 24 hours or more: "1.3d" (days with 1 decimal)
 * - Edge cases: 0 → "0h", null/undefined/negative → "—"
 */
export function formatDuration(hours: number | null | undefined): string {
  // Handle null, undefined, and negative values
  if (hours == null || hours < 0) {
    return '—';
  }

  // Handle zero
  if (hours === 0) {
    return '0h';
  }

  // Less than 24 hours: format as hours
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }

  // 24 hours or more: format as days
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
