import { describe, test, expect, beforeEach, vi } from "vitest";
import { formatRelativeOrDate, formatFeatureDate } from "@/lib/date-utils";

describe("date-utils", () => {
  beforeEach(() => {
    // Mock the current date to ensure consistent test results
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-02T12:00:00.000Z"));
  });

  describe("formatRelativeOrDate", () => {
    test("returns 'Just now' for dates less than 1 minute ago", () => {
      const date = new Date("2025-12-02T11:59:30.000Z"); // 30 seconds ago
      expect(formatRelativeOrDate(date)).toBe("Just now");
    });

    test("returns '1 min ago' for 1 minute ago", () => {
      const date = new Date("2025-12-02T11:59:00.000Z"); // 1 minute ago
      expect(formatRelativeOrDate(date)).toBe("1 min ago");
    });

    test("returns 'X mins ago' for multiple minutes", () => {
      const date = new Date("2025-12-02T11:45:00.000Z"); // 15 minutes ago
      expect(formatRelativeOrDate(date)).toBe("15 mins ago");
    });

    test("returns '1 hr ago' for 1 hour ago", () => {
      const date = new Date("2025-12-02T11:00:00.000Z"); // 1 hour ago
      expect(formatRelativeOrDate(date)).toBe("1 hr ago");
    });

    test("returns 'X hrs ago' for multiple hours", () => {
      const date = new Date("2025-12-02T09:00:00.000Z"); // 3 hours ago
      expect(formatRelativeOrDate(date)).toBe("3 hrs ago");
    });

    test("returns 'Yesterday' for exactly 1 day ago", () => {
      const date = new Date("2025-12-01T12:00:00.000Z"); // 1 day ago
      expect(formatRelativeOrDate(date)).toBe("Yesterday");
    });

    test("returns '2 days ago' for exactly 2 days ago", () => {
      const date = new Date("2025-11-30T12:00:00.000Z"); // 2 days ago
      expect(formatRelativeOrDate(date)).toBe("2 days ago");
    });

    test("returns formatted date for more than 2 days ago", () => {
      const date = new Date("2025-11-29T12:00:00.000Z"); // 3 days ago
      expect(formatRelativeOrDate(date)).toBe("Nov 29, 2025");
    });

    test("returns formatted date for dates from previous year", () => {
      const date = new Date("2024-01-15T12:00:00.000Z");
      expect(formatRelativeOrDate(date)).toBe("Jan 15, 2024");
    });

    test("accepts ISO string input", () => {
      const dateString = "2025-12-02T11:00:00.000Z";
      expect(formatRelativeOrDate(dateString)).toBe("1 hr ago");
    });

    test("accepts Date object input", () => {
      const date = new Date("2025-12-02T11:00:00.000Z");
      expect(formatRelativeOrDate(date)).toBe("1 hr ago");
    });

    test("handles boundary at 24 hours correctly", () => {
      const date = new Date("2025-12-01T12:00:01.000Z"); // 23:59:59 hours ago
      expect(formatRelativeOrDate(date)).toBe("23 hrs ago");
    });

    test("handles boundary at 48 hours correctly", () => {
      const date = new Date("2025-11-30T12:00:01.000Z"); // Just under 2 days
      expect(formatRelativeOrDate(date)).toBe("Yesterday");
    });

    test("handles edge case of current time", () => {
      const date = new Date("2025-12-02T12:00:00.000Z"); // Exactly now
      expect(formatRelativeOrDate(date)).toBe("Just now");
    });
  });

  describe("formatFeatureDate", () => {
    test("formats date correctly with short month, numeric day and year", () => {
      const date = new Date("2025-11-15T10:30:00.000Z");
      expect(formatFeatureDate(date)).toBe("Nov 15, 2025");
    });

    test("formats date at start of year", () => {
      const date = new Date("2025-01-01T00:00:00.000Z");
      expect(formatFeatureDate(date)).toBe("Jan 1, 2025");
    });

    test("formats date at end of year", () => {
      const date = new Date("2025-12-31T23:59:59.000Z");
      expect(formatFeatureDate(date)).toBe("Dec 31, 2025");
    });

    test("accepts ISO string input", () => {
      const dateString = "2024-06-15T12:00:00.000Z";
      expect(formatFeatureDate(dateString)).toBe("Jun 15, 2024");
    });

    test("accepts Date object input", () => {
      const date = new Date("2024-06-15T12:00:00.000Z");
      expect(formatFeatureDate(date)).toBe("Jun 15, 2024");
    });

    test("formats date from different years consistently", () => {
      const date2023 = new Date("2023-03-20T10:00:00.000Z");
      const date2024 = new Date("2024-03-20T10:00:00.000Z");
      const date2025 = new Date("2025-03-20T10:00:00.000Z");

      expect(formatFeatureDate(date2023)).toBe("Mar 20, 2023");
      expect(formatFeatureDate(date2024)).toBe("Mar 20, 2024");
      expect(formatFeatureDate(date2025)).toBe("Mar 20, 2025");
    });
  });
});
