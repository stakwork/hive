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
