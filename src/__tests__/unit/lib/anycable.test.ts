// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cableUrl } from "@/lib/anycable";

describe("cableUrl", () => {
  it('returns the jobs (production) host for exactly "production"', () => {
    expect(cableUrl("production")).toBe("wss://jobs.stakwork.com/cable");
  });

  it('returns the staging host for "staging"', () => {
    expect(cableUrl("staging")).toBe("wss://staging.stakwork.com/cable");
  });

  it('returns the staging host for "development"', () => {
    expect(cableUrl("development")).toBe("wss://staging.stakwork.com/cable");
  });

  it("returns the staging host for an empty string", () => {
    expect(cableUrl("")).toBe("wss://staging.stakwork.com/cable");
  });

  it('returns the staging host for "prod" (near-miss — strict match only)', () => {
    expect(cableUrl("prod")).toBe("wss://staging.stakwork.com/cable");
  });

  it('returns the staging host for "PRODUCTION" (case-sensitive — no fuzzy matching)', () => {
    expect(cableUrl("PRODUCTION")).toBe("wss://staging.stakwork.com/cable");
  });
});
