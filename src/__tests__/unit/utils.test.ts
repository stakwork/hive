import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "@/lib/utils";

describe("formatRelativeTime", () => {
  const mockDate = new Date("2025-01-15T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("should return 'just now' for dates less than 1 minute ago", () => {
    const thirtySecondsAgo = new Date(mockDate.getTime() - 30 * 1000);
    expect(formatRelativeTime(thirtySecondsAgo)).toBe("just now");
    
    const fifteenSecondsAgo = new Date(mockDate.getTime() - 15 * 1000);
    expect(formatRelativeTime(fifteenSecondsAgo)).toBe("just now");
  });

  test("should return correct minute format for dates 1-59 minutes ago", () => {
    const oneMinuteAgo = new Date(mockDate.getTime() - 1 * 60 * 1000);
    expect(formatRelativeTime(oneMinuteAgo)).toBe("1 minute ago");
    
    const fiveMinutesAgo = new Date(mockDate.getTime() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinutesAgo)).toBe("5 minutes ago");
    
    const fiftyNineMinutesAgo = new Date(mockDate.getTime() - 59 * 60 * 1000);
    expect(formatRelativeTime(fiftyNineMinutesAgo)).toBe("59 minutes ago");
  });

  test("should return correct hour format for dates 1-23 hours ago", () => {
    const oneHourAgo = new Date(mockDate.getTime() - 1 * 60 * 60 * 1000);
    expect(formatRelativeTime(oneHourAgo)).toBe("1 hour ago");
    
    const fiveHoursAgo = new Date(mockDate.getTime() - 5 * 60 * 60 * 1000);
    expect(formatRelativeTime(fiveHoursAgo)).toBe("5 hours ago");
    
    const twentyThreeHoursAgo = new Date(mockDate.getTime() - 23 * 60 * 60 * 1000);
    expect(formatRelativeTime(twentyThreeHoursAgo)).toBe("23 hours ago");
  });

  test("should return correct day format for dates 1-6 days ago", () => {
    const oneDayAgo = new Date(mockDate.getTime() - 1 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(oneDayAgo)).toBe("1 day ago");
    
    const threeDaysAgo = new Date(mockDate.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
    
    const sixDaysAgo = new Date(mockDate.getTime() - 6 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(sixDaysAgo)).toBe("6 days ago");
  });

  test("should return absolute date for dates 7+ days ago", () => {
    const sevenDaysAgo = new Date(mockDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(sevenDaysAgo)).toBe(sevenDaysAgo.toLocaleDateString());
    
    const oneMonthAgo = new Date(mockDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(oneMonthAgo)).toBe(oneMonthAgo.toLocaleDateString());
  });

  test("should handle string date inputs", () => {
    const fiveMinutesAgo = new Date(mockDate.getTime() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinutesAgo.toISOString())).toBe("5 minutes ago");
  });

  test("should handle edge cases correctly", () => {
    // Exactly 1 minute ago
    const exactlyOneMinute = new Date(mockDate.getTime() - 60 * 1000);
    expect(formatRelativeTime(exactlyOneMinute)).toBe("1 minute ago");
    
    // Exactly 1 hour ago
    const exactlyOneHour = new Date(mockDate.getTime() - 60 * 60 * 1000);
    expect(formatRelativeTime(exactlyOneHour)).toBe("1 hour ago");
    
    // Exactly 1 day ago
    const exactlyOneDay = new Date(mockDate.getTime() - 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(exactlyOneDay)).toBe("1 day ago");
  });

  test("should use correct singular/plural forms", () => {
    const oneMinuteAgo = new Date(mockDate.getTime() - 1 * 60 * 1000);
    expect(formatRelativeTime(oneMinuteAgo)).toBe("1 minute ago");
    
    const twoMinutesAgo = new Date(mockDate.getTime() - 2 * 60 * 1000);
    expect(formatRelativeTime(twoMinutesAgo)).toBe("2 minutes ago");
    
    const oneHourAgo = new Date(mockDate.getTime() - 1 * 60 * 60 * 1000);
    expect(formatRelativeTime(oneHourAgo)).toBe("1 hour ago");
    
    const twoHoursAgo = new Date(mockDate.getTime() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo)).toBe("2 hours ago");
  });
});