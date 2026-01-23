import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatRelativeTime,
  formatShortDate,
  formatFullDateTime,
  formatDateRange,
  isToday,
  isWithinLastDays,
} from '@/utils/dateFormatters';

describe('dateFormatters', () => {
  beforeEach(() => {
    // Mock the current time to January 23, 2026, 16:02:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-23T16:02:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatRelativeTime', () => {
    it('should return "just now" for dates less than 60 seconds ago', () => {
      const date = new Date('2026-01-23T16:01:30'); // 30 seconds ago
      expect(formatRelativeTime(date)).toBe('just now');
    });

    it('should return minutes for dates less than 60 minutes ago', () => {
      const date = new Date('2026-01-23T15:57:00'); // 5 minutes ago
      expect(formatRelativeTime(date)).toBe('5 minutes ago');
    });

    it('should return singular "minute" for 1 minute ago', () => {
      const date = new Date('2026-01-23T16:01:00'); // 1 minute ago
      expect(formatRelativeTime(date)).toBe('1 minute ago');
    });

    it('should return hours for dates less than 24 hours ago', () => {
      const date = new Date('2026-01-23T14:02:00'); // 2 hours ago
      expect(formatRelativeTime(date)).toBe('2 hours ago');
    });

    it('should return days for dates less than 7 days ago', () => {
      const date = new Date('2026-01-20T16:02:00'); // 3 days ago
      expect(formatRelativeTime(date)).toBe('3 days ago');
    });

    it('should return weeks for dates less than 4 weeks ago', () => {
      const date = new Date('2026-01-09T16:02:00'); // 2 weeks ago
      expect(formatRelativeTime(date)).toBe('2 weeks ago');
    });

    it('should return months for dates less than 12 months ago', () => {
      const date = new Date('2025-11-23T16:02:00'); // 2 months ago
      expect(formatRelativeTime(date)).toBe('2 months ago');
    });

    it('should return years for dates more than 12 months ago', () => {
      const date = new Date('2024-01-23T16:02:00'); // 2 years ago
      expect(formatRelativeTime(date)).toBe('2 years ago');
    });

    it('should accept string dates', () => {
      const dateString = '2026-01-23T15:02:00';
      expect(formatRelativeTime(dateString)).toBe('1 hour ago');
    });
  });

  describe('formatShortDate', () => {
    it('should format a date to short format', () => {
      const date = new Date('2026-01-23T16:02:00');
      expect(formatShortDate(date)).toBe('Jan 23, 2026');
    });

    it('should accept string dates', () => {
      expect(formatShortDate('2026-01-23T16:02:00')).toBe('Jan 23, 2026');
    });

    it('should accept custom options', () => {
      const date = new Date('2026-01-23T16:02:00');
      const result = formatShortDate(date, { year: undefined });
      expect(result).toBe('Jan 23');
    });
  });

  describe('formatFullDateTime', () => {
    it('should format a date to full date and time', () => {
      const date = new Date('2026-01-23T16:02:00');
      expect(formatFullDateTime(date)).toBe('January 23, 2026 at 4:02 PM');
    });

    it('should accept string dates', () => {
      expect(formatFullDateTime('2026-01-23T09:30:00')).toBe(
        'January 23, 2026 at 9:30 AM'
      );
    });
  });

  describe('formatDateRange', () => {
    it('should format dates in the same month', () => {
      const start = new Date('2026-01-15T10:00:00');
      const end = new Date('2026-01-23T16:02:00');
      expect(formatDateRange(start, end)).toBe('Jan 15 - Jan 23, 2026');
    });

    it('should format dates in different months of the same year', () => {
      const start = new Date('2026-01-15T10:00:00');
      const end = new Date('2026-03-20T16:02:00');
      expect(formatDateRange(start, end)).toBe('Jan 15 - Mar 20, 2026');
    });

    it('should format dates in different years', () => {
      const start = new Date('2025-12-15T10:00:00');
      const end = new Date('2026-01-23T16:02:00');
      expect(formatDateRange(start, end)).toBe('Dec 15, 2025 - Jan 23, 2026');
    });

    it('should accept string dates', () => {
      const result = formatDateRange(
        '2026-01-15T10:00:00',
        '2026-01-23T16:02:00'
      );
      expect(result).toBe('Jan 15 - Jan 23, 2026');
    });
  });

  describe('isToday', () => {
    it('should return true for today', () => {
      const date = new Date('2026-01-23T10:00:00');
      expect(isToday(date)).toBe(true);
    });

    it('should return false for yesterday', () => {
      const date = new Date('2026-01-22T16:02:00');
      expect(isToday(date)).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const date = new Date('2026-01-24T16:02:00');
      expect(isToday(date)).toBe(false);
    });

    it('should accept string dates', () => {
      expect(isToday('2026-01-23T10:00:00')).toBe(true);
      expect(isToday('2026-01-22T10:00:00')).toBe(false);
    });
  });

  describe('isWithinLastDays', () => {
    it('should return true for dates within the specified days', () => {
      const date = new Date('2026-01-20T16:02:00'); // 3 days ago
      expect(isWithinLastDays(date, 7)).toBe(true);
    });

    it('should return false for dates outside the specified days', () => {
      const date = new Date('2026-01-10T16:02:00'); // 13 days ago
      expect(isWithinLastDays(date, 7)).toBe(false);
    });

    it('should return true for today', () => {
      const date = new Date('2026-01-23T16:02:00');
      expect(isWithinLastDays(date, 7)).toBe(true);
    });

    it('should return false for future dates', () => {
      const date = new Date('2026-01-25T16:02:00'); // 2 days in the future
      expect(isWithinLastDays(date, 7)).toBe(false);
    });

    it('should accept string dates', () => {
      expect(isWithinLastDays('2026-01-20T16:02:00', 7)).toBe(true);
      expect(isWithinLastDays('2026-01-10T16:02:00', 7)).toBe(false);
    });
  });
});
