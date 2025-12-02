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
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
