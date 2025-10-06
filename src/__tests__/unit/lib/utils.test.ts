import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cn, formatRelativeTime, getBaseUrl } from "@/lib/utils";

describe("utils", () => {
  describe("cn", () => {
    it("should merge classes correctly", () => {
      expect(cn("foo", "bar")).toBe("foo bar");
      expect(cn("foo bar", "baz")).toBe("foo bar baz");
    });

    it("should handle conditional classes", () => {
      expect(cn("foo", true && "bar", false && "baz")).toBe("foo bar");
      expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
    });

    it("should handle array inputs", () => {
      expect(cn(["foo", "bar"])).toBe("foo bar");
      expect(cn("foo", ["bar", "baz"])).toBe("foo bar baz");
    });

    it("should handle object inputs", () => {
      expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
      expect(cn("base", { active: true, disabled: false })).toBe("base active");
    });

    it("should handle Tailwind class conflicts", () => {
      // tailwind-merge should handle conflicting classes
      expect(cn("p-4", "p-2")).toBe("p-2");
      expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
    });

    it("should handle empty and falsy inputs", () => {
      expect(cn()).toBe("");
      expect(cn("", null, undefined, false)).toBe("");
      expect(cn("foo", "", "bar")).toBe("foo bar");
    });

    it("should handle mixed input types", () => {
      expect(cn(
        "base",
        ["foo", "bar"],
        { active: true, disabled: false },
        true && "conditional",
        "final"
      )).toBe("base foo bar active conditional final");
    });
  });

  describe("formatRelativeTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      { seconds: 0, expected: "just now" },
      { seconds: 30, expected: "just now" },
      { seconds: 45, expected: "just now" },
    ])("should return '$expected' for $seconds seconds ago", ({ seconds, expected }) => {
      const now = new Date();
      const date = new Date(now.getTime() - seconds * 1000);
      expect(formatRelativeTime(date)).toBe(expected);
    });

    it.each([
      { minutes: 1, expected: "1 minute ago" },
      { minutes: 5, expected: "5 minutes ago" },
      { minutes: 30, expected: "30 minutes ago" },
      { minutes: 59, expected: "59 minutes ago" },
    ])("should return '$expected' for $minutes minutes ago", ({ minutes, expected }) => {
      const now = new Date();
      const date = new Date(now.getTime() - minutes * 60 * 1000);
      expect(formatRelativeTime(date)).toBe(expected);
    });

    it.each([
      { hours: 1, expected: "1 hour ago" },
      { hours: 5, expected: "5 hours ago" },
      { hours: 12, expected: "12 hours ago" },
      { hours: 23, expected: "23 hours ago" },
    ])("should return '$expected' for $hours hours ago", ({ hours, expected }) => {
      const now = new Date();
      const date = new Date(now.getTime() - hours * 60 * 60 * 1000);
      expect(formatRelativeTime(date)).toBe(expected);
    });

    it.each([
      { days: 1, expected: "1 day ago" },
      { days: 3, expected: "3 days ago" },
      { days: 6, expected: "6 days ago" },
    ])("should return '$expected' for $days days ago", ({ days, expected }) => {
      const now = new Date();
      const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(date)).toBe(expected);
    });

    it.each([
      { days: 7 },
      { days: 30 },
      { days: 365 },
    ])("should format dates $days days ago as formatted date string", ({ days }) => {
      const now = new Date();
      const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const result = formatRelativeTime(date);
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });

    it("should handle string date inputs", () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      expect(formatRelativeTime(fiveMinutesAgo.toISOString())).toBe("5 minutes ago");
      expect(formatRelativeTime("2024-01-15T11:55:00Z")).toBe("5 minutes ago");
    });

    it("should handle future dates", () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 5 * 60 * 1000);

      const result = formatRelativeTime(futureDate);
      expect(result).toBe("just now");
    });
  });

  describe("getBaseUrl", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
      delete process.env.NEXTAUTH_URL;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use host header with https for non-localhost", () => {
      expect(getBaseUrl("example.com")).toBe("https://example.com");
      expect(getBaseUrl("api.mysite.com")).toBe("https://api.mysite.com");
      expect(getBaseUrl("subdomain.domain.org")).toBe("https://subdomain.domain.org");
    });

    it("should use http for localhost host header", () => {
      expect(getBaseUrl("localhost:3000")).toBe("http://localhost:3000");
      expect(getBaseUrl("localhost")).toBe("http://localhost");
      expect(getBaseUrl("localhost:8080")).toBe("http://localhost:8080");
    });

    it("should use NEXTAUTH_URL when available and no host header", () => {
      process.env.NEXTAUTH_URL = "https://myapp.com";
      expect(getBaseUrl()).toBe("https://myapp.com");
      
      process.env.NEXTAUTH_URL = "http://localhost:3000";
      expect(getBaseUrl()).toBe("http://localhost:3000");
    });

    it("should prefer host header over NEXTAUTH_URL", () => {
      process.env.NEXTAUTH_URL = "https://myapp.com";
      expect(getBaseUrl("example.com")).toBe("https://example.com");
      expect(getBaseUrl("localhost:3000")).toBe("http://localhost:3000");
    });

    it("should fallback to localhost:3000 when no host header or NEXTAUTH_URL", () => {
      expect(getBaseUrl()).toBe("http://localhost:3000");
      expect(getBaseUrl(null)).toBe("http://localhost:3000");
      expect(getBaseUrl(undefined)).toBe("http://localhost:3000");
    });

    it("should handle empty string host header", () => {
      process.env.NEXTAUTH_URL = "https://myapp.com";
      expect(getBaseUrl("")).toBe("https://myapp.com");
      
      delete process.env.NEXTAUTH_URL;
      expect(getBaseUrl("")).toBe("http://localhost:3000");
    });

    it("should handle various localhost variations", () => {
      expect(getBaseUrl("localhost")).toBe("http://localhost");
      expect(getBaseUrl("localhost:3000")).toBe("http://localhost:3000");
      expect(getBaseUrl("localhost:8080")).toBe("http://localhost:8080");
      expect(getBaseUrl("127.0.0.1")).toBe("https://127.0.0.1");
      expect(getBaseUrl("127.0.0.1:3000")).toBe("https://127.0.0.1:3000");
    });

    it("should handle host headers with port numbers", () => {
      expect(getBaseUrl("example.com:8080")).toBe("https://example.com:8080");
      expect(getBaseUrl("api.test.com:3001")).toBe("https://api.test.com:3001");
    });
  });
});