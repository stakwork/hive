import { describe, it, expect } from 'vitest';
import { formatDuration } from '@/lib/date-utils';

describe('formatDuration', () => {
  describe('sub-hour values', () => {
    it('should format 0.5 hours as "0.5h"', () => {
      expect(formatDuration(0.5)).toBe('0.5h');
    });

    it('should format 0.1 hours as "0.1h"', () => {
      expect(formatDuration(0.1)).toBe('0.1h');
    });

    it('should format 0.9 hours as "0.9h"', () => {
      expect(formatDuration(0.9)).toBe('0.9h');
    });
  });

  describe('multi-hour values', () => {
    it('should format 5.2 hours as "5.2h"', () => {
      expect(formatDuration(5.2)).toBe('5.2h');
    });

    it('should format 12.7 hours as "12.7h"', () => {
      expect(formatDuration(12.7)).toBe('12.7h');
    });

    it('should format 23.9 hours as "23.9h"', () => {
      expect(formatDuration(23.9)).toBe('23.9h');
    });

    it('should format whole hours with one decimal', () => {
      expect(formatDuration(5)).toBe('5.0h');
    });
  });

  describe('single day values', () => {
    it('should format 24 hours as "1.0d"', () => {
      expect(formatDuration(24)).toBe('1.0d');
    });

    it('should format 25 hours as "1.0d"', () => {
      expect(formatDuration(25)).toBe('1.0d');
    });

    it('should format 30 hours as "1.3d"', () => {
      expect(formatDuration(30)).toBe('1.3d');
    });
  });

  describe('multi-day values', () => {
    it('should format 2.7 days (64.8 hours) as "2.7d"', () => {
      expect(formatDuration(64.8)).toBe('2.7d');
    });

    it('should format 48 hours as "2.0d"', () => {
      expect(formatDuration(48)).toBe('2.0d');
    });

    it('should format 72 hours as "3.0d"', () => {
      expect(formatDuration(72)).toBe('3.0d');
    });

    it('should format 100 hours as "4.2d"', () => {
      expect(formatDuration(100)).toBe('4.2d');
    });
  });

  describe('edge cases', () => {
    it('should format 0 hours as "0h"', () => {
      expect(formatDuration(0)).toBe('0h');
    });

    it('should return "—" for null', () => {
      expect(formatDuration(null)).toBe('—');
    });

    it('should return "—" for undefined', () => {
      expect(formatDuration(undefined)).toBe('—');
    });

    it('should return "—" for negative values', () => {
      expect(formatDuration(-1)).toBe('—');
      expect(formatDuration(-10.5)).toBe('—');
      expect(formatDuration(-100)).toBe('—');
    });
  });

  describe('boundary conditions', () => {
    it('should format 23.99 hours as hours, not days', () => {
      expect(formatDuration(23.99)).toBe('24.0h');
    });

    it('should format exactly 24 hours as days', () => {
      expect(formatDuration(24)).toBe('1.0d');
    });

    it('should format 24.01 hours as days', () => {
      expect(formatDuration(24.01)).toBe('1.0d');
    });
  });
});
