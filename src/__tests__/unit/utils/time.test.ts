import { describe, test, expect, beforeEach, vi } from "vitest";
import { formatTimestamp } from "@/utils/time";

describe("formatTimestamp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset any global mocks
    vi.restoreAllMocks();
  });

  describe("Normal cases", () => {
    test("should format valid Date object", () => {
      const date = new Date("2024-01-15T14:30:00Z");
      const result = formatTimestamp(date);
      
      // Should return formatted string (exact format may vary by locale)
      expect(result).toMatch(/2024/);
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    test("should format valid ISO date string", () => {
      const isoString = "2024-01-15T14:30:00Z";
      const result = formatTimestamp(isoString);
      
      expect(result).toMatch(/2024/);
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    test("should format timestamp number", () => {
      const timestamp = 1705327800000; // 2024-01-15T14:30:00Z
      const result = formatTimestamp(timestamp);
      
      expect(result).toMatch(/2024/);
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    test("should format different date formats", () => {
      const formats = [
        "2024-01-15",
        "2024/01/15",
        "Jan 15, 2024",
        "15 Jan 2024",
      ];

      formats.forEach(dateStr => {
        const result = formatTimestamp(dateStr);
        expect(result).toMatch(/2024/);
        expect(result).toMatch(/Jan/);
        expect(result).toMatch(/15/);
      });
    });
  });

  describe("Edge cases", () => {
    test("should return empty string for null", () => {
      expect(formatTimestamp(null)).toBe("");
    });

    test("should return empty string for undefined", () => {
      expect(formatTimestamp(undefined)).toBe("");
    });

    test("should return empty string for empty string", () => {
      expect(formatTimestamp("")).toBe("");
    });

    test("should return empty string for 0", () => {
      expect(formatTimestamp(0)).toBe("");
    });

    test("should return empty string for false", () => {
      expect(formatTimestamp(false as any)).toBe("");
    });

    test("should return original value as string for invalid date strings", () => {
      const invalidDates = [
        "invalid-date",
        "not-a-date",
        "2024-13-40", // Invalid month/day
        "abc123",
        "{}",
      ];

      invalidDates.forEach(invalid => {
        const result = formatTimestamp(invalid);
        expect(result).toBe(invalid);
      });
    });

    test("should handle very large timestamp numbers", () => {
      const largeTimestamp = Number.MAX_SAFE_INTEGER;
      const result = formatTimestamp(largeTimestamp);
      
      // Should return string representation since it creates invalid date
      expect(result).toBe(String(largeTimestamp));
    });

    test("should handle negative timestamp numbers", () => {
      const negativeTimestamp = -999999999999999;
      const result = formatTimestamp(negativeTimestamp);
      
      // The negative timestamp creates a valid date (albeit far in the past)
      // so it will be formatted rather than returned as string
      expect(result).toMatch(/Apr/);
      expect(result).toMatch(/29720/);
    });

    test("should handle Date objects with invalid time", () => {
      const invalidDate = new Date("invalid");
      const result = formatTimestamp(invalidDate);
      
      expect(result).toBe("Invalid Date");
    });
  });

  describe("Intl.DateTimeFormat behavior", () => {
    test("should use specific format options", () => {
      const mockFormat = vi.fn().mockReturnValue("formatted-date");
      const MockIntl = vi.fn().mockImplementation(() => ({
        format: mockFormat,
      }));

      // Mock Intl.DateTimeFormat
      vi.stubGlobal("Intl", {
        DateTimeFormat: MockIntl,
      });

      const date = new Date("2024-01-15T14:30:00Z");
      const result = formatTimestamp(date);

      expect(MockIntl).toHaveBeenCalledWith(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      expect(mockFormat).toHaveBeenCalledWith(date);
      expect(result).toBe("formatted-date");
    });

    test("should fallback to toLocaleString when Intl.DateTimeFormat throws", () => {
      const date = new Date("2024-01-15T14:30:00Z");
      const mockToLocaleString = vi.fn().mockReturnValue("fallback-string");
      date.toLocaleString = mockToLocaleString;

      // Mock Intl.DateTimeFormat to throw error
      vi.stubGlobal("Intl", {
        DateTimeFormat: vi.fn().mockImplementation(() => {
          throw new Error("Intl error");
        }),
      });

      const result = formatTimestamp(date);

      expect(mockToLocaleString).toHaveBeenCalled();
      expect(result).toBe("fallback-string");
    });

    test("should fallback to toLocaleString when format method throws", () => {
      const date = new Date("2024-01-15T14:30:00Z");
      const mockToLocaleString = vi.fn().mockReturnValue("fallback-string");
      date.toLocaleString = mockToLocaleString;

      const mockFormat = vi.fn().mockImplementation(() => {
        throw new Error("Format error");
      });

      vi.stubGlobal("Intl", {
        DateTimeFormat: vi.fn().mockImplementation(() => ({
          format: mockFormat,
        })),
      });

      const result = formatTimestamp(date);

      expect(mockToLocaleString).toHaveBeenCalled();
      expect(result).toBe("fallback-string");
    });
  });

  describe("Type handling", () => {
    test("should handle Date instances correctly", () => {
      const date = new Date("2024-01-15T14:30:00Z");
      const result = formatTimestamp(date);
      
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    test("should convert string inputs to Date", () => {
      const dateString = "2024-01-15T14:30:00Z";
      const result = formatTimestamp(dateString);
      
      expect(typeof result).toBe("string");
      expect(result).toMatch(/2024/);
    });

    test("should convert number inputs to Date", () => {
      const timestamp = Date.now();
      const result = formatTimestamp(timestamp);
      
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    test("should handle mixed valid and invalid inputs", () => {
      const inputs = [
        new Date("2024-01-15"),
        "2024-01-15",
        1705327800000,
        "invalid-date",
        null,
        undefined,
      ];

      const results = inputs.map(input => formatTimestamp(input));

      // Valid inputs should produce formatted dates
      expect(results[0]).toMatch(/2024/);
      expect(results[1]).toMatch(/2024/);
      expect(results[2]).toMatch(/2024/);
      
      // Invalid inputs should produce expected fallbacks
      expect(results[3]).toBe("invalid-date");
      expect(results[4]).toBe("");
      expect(results[5]).toBe("");
    });
  });

  describe("Real-world scenarios", () => {
    test("should handle common timestamp formats from APIs", () => {
      const apiFormats = [
        "2024-01-15T14:30:00.000Z", // ISO with milliseconds
        "2024-01-15T14:30:00Z", // ISO without milliseconds
        "2024-01-15 14:30:00", // SQL datetime format
        1705327800, // Unix timestamp (seconds)
        1705327800000, // Unix timestamp (milliseconds)
      ];

      apiFormats.forEach(format => {
        const result = formatTimestamp(format);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
        // Should not return the original string (meaning it was parsed)
        if (typeof format === "string") {
          expect(result).not.toBe(format);
        }
      });
    });

    test("should handle same date in different formats", () => {
      const sameDate = [
        new Date("2024-01-15T14:30:00Z"),
        "2024-01-15T14:30:00Z",
        1705327800000,
      ];

      const results = sameDate.map(date => formatTimestamp(date));
      
      // All should format to some result containing the year and day
      // Note: Month format depends on locale (Jan vs 1/15/2024 format)
      results.forEach(result => {
        expect(result).toMatch(/2024/);
        expect(result).toMatch(/15/);
      });
    });

    test("should handle edge dates", () => {
      const edgeDates = [
        new Date("1970-01-01T00:00:00Z"), // Unix epoch
        new Date("2000-01-01T00:00:00Z"), // Y2K
        new Date("2038-01-19T03:14:07Z"), // Unix timestamp limit (32-bit)
      ];

      edgeDates.forEach(date => {
        const result = formatTimestamp(date);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toBe("");
      });
    });
  });
});