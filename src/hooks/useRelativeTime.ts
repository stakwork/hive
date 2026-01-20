import { useEffect, useState } from 'react';
import { formatRelativeOrDate, isRelativeFormat } from '@/lib/date-utils';

/**
 * Hook that returns a formatted relative time string that automatically updates.
 * 
 * Features:
 * - Auto-refreshes at a configurable interval (default 60s, via NEXT_PUBLIC_TIME_UPDATE_INTERVAL)
 * - Uses Page Visibility API to update immediately when tab becomes visible
 * - Stops updating when dates age beyond 2 days
 * - Cleans up intervals and event listeners on unmount
 * 
 * @param date - The date to format
 * @returns Formatted relative time string (e.g., "2 hrs ago", "Yesterday", or "Nov 1, 2023")
 */
export function useRelativeTime(date: string | Date): string {
  const [formattedTime, setFormattedTime] = useState(() => formatRelativeOrDate(date));

  useEffect(() => {
    // Update the formatted time when date changes
    setFormattedTime(formatRelativeOrDate(date));

    // Get update interval from environment or use default (60 seconds)
    const envInterval = typeof window !== 'undefined' 
      ? process.env.NEXT_PUBLIC_TIME_UPDATE_INTERVAL 
      : undefined;
    const parsedInterval = parseInt(envInterval || '60000', 10);
    const updateInterval = isNaN(parsedInterval) ? 60000 : parsedInterval;

    // Update the formatted time
    const updateTime = () => {
      setFormattedTime(formatRelativeOrDate(date));
    };

    // Handler for visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateTime();
      }
    };

    // Only set up interval if the date should use relative formatting
    let intervalId: NodeJS.Timeout | null = null;
    
    if (isRelativeFormat(date)) {
      // Set up interval for automatic updates
      intervalId = setInterval(updateTime, updateInterval);
      
      // Set up visibility change listener
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Cleanup function
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [date]);

  return formattedTime;
}
