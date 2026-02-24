import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";

describe("getStakworkTokenReference", () => {
  const originalEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalEnv;
    }
  });

  it('should return "{{HIVE_PROD}}" when VERCEL_ENV is "production"', () => {
    process.env.VERCEL_ENV = "production";
    expect(getStakworkTokenReference()).toBe("{{HIVE_PROD}}");
  });

  it('should return "{{HIVE_STAGING}}" when VERCEL_ENV is "preview"', () => {
    process.env.VERCEL_ENV = "preview";
    expect(getStakworkTokenReference()).toBe("{{HIVE_STAGING}}");
  });

  it('should return "{{HIVE_STAGING}}" when VERCEL_ENV is "development"', () => {
    process.env.VERCEL_ENV = "development";
    expect(getStakworkTokenReference()).toBe("{{HIVE_STAGING}}");
  });

  it('should return "{{HIVE_STAGING}}" when VERCEL_ENV is undefined', () => {
    delete process.env.VERCEL_ENV;
    expect(getStakworkTokenReference()).toBe("{{HIVE_STAGING}}");
  });

  it('should return "{{HIVE_STAGING}}" for any other VERCEL_ENV value', () => {
    process.env.VERCEL_ENV = "some-other-value";
    expect(getStakworkTokenReference()).toBe("{{HIVE_STAGING}}");
  });
});
