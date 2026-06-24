import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getCurrentDateSnippet,
  getQuickAskSystemPrompt,
  getMultiWorkspaceSystemPrompt,
} from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWs(slug: string): WorkspaceConfig {
  return {
    slug,
    name: `Workspace ${slug}`,
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `ws-${slug}`,
    userId: "user-1",
    members: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── getCurrentDateSnippet ────────────────────────────────────────────────────

describe("getCurrentDateSnippet", () => {
  it("includes the current year and day name (2026-06-17 = Wednesday)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const snippet = getCurrentDateSnippet();

    expect(snippet).toContain("2026");
    expect(snippet).toContain("Wednesday");
    expect(snippet).toContain("(UTC)");
  });

  it("reflects a different mocked year — confirms no hardcoded year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));

    const snippet = getCurrentDateSnippet();

    expect(snippet).toContain("2027");
    expect(snippet).not.toContain("2026");
  });

  it("includes the instruction not to default to an earlier year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const snippet = getCurrentDateSnippet();

    expect(snippet).toContain("do not default to an earlier year");
  });

  it("is computed fresh each call — two calls with different times return different years", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));
    const first = getCurrentDateSnippet();

    vi.setSystemTime(new Date("2027-03-15T10:00:00Z"));
    const second = getCurrentDateSnippet();

    expect(first).toContain("2026");
    expect(second).toContain("2027");
  });

  // ── Timezone-aware behaviour ──────────────────────────────────────────────

  it("includes timezone abbreviation (EDT) when America/New_York is passed in June", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z")); // June → EDT

    const snippet = getCurrentDateSnippet("America/New_York");

    expect(snippet).toMatch(/EDT|EST/);
    expect(snippet).toContain("America/New_York");
  });

  it("includes the localisation instruction line when a valid timezone is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const snippet = getCurrentDateSnippet("America/Chicago");

    expect(snippet).toContain("Convert all UTC times to this timezone");
    expect(snippet).toContain("America/Chicago");
  });

  it("falls back to UTC behaviour when no timezone is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const snippet = getCurrentDateSnippet();

    expect(snippet).toContain("(UTC)");
    expect(snippet).not.toContain("Convert all UTC times");
  });

  it("falls back to UTC behaviour when an invalid timezone is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const snippet = getCurrentDateSnippet("Fake/Zone");

    expect(snippet).toContain("(UTC)");
    expect(snippet).not.toContain("Convert all UTC times");
  });
});

// ─── getQuickAskSystemPrompt includes date snippet ───────────────────────────

describe("getQuickAskSystemPrompt — date injection", () => {
  it("includes the current date snippet near the top", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const prompt = getQuickAskSystemPrompt(
      ["https://github.com/owner/repo"],
    );

    expect(prompt).toContain("2026");
    expect(prompt).toContain("Wednesday");
    expect(prompt).toContain("(UTC)");
    expect(prompt).toContain("do not default to an earlier year");
  });

  it("date snippet appears before the assistant role instructions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const prompt = getQuickAskSystemPrompt(
      ["https://github.com/owner/repo"],
    );

    const dateIndex = prompt.indexOf("Current date:");
    const roleIndex = prompt.indexOf("You are a source code learning assistant");
    expect(dateIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(dateIndex);
  });

  it("includes timezone abbreviation when userTimezone is provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z")); // June → EDT

    const prompt = getQuickAskSystemPrompt(
      ["https://github.com/owner/repo"],
      undefined,
      undefined,
      undefined,
      "America/New_York",
    );

    expect(prompt).toMatch(/EDT|EST/);
    expect(prompt).toContain("Convert all UTC times to this timezone");
  });
});

// ─── getMultiWorkspaceSystemPrompt includes date snippet ─────────────────────

describe("getMultiWorkspaceSystemPrompt — date injection", () => {
  it("includes the current date snippet near the top", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha")]);

    expect(prompt).toContain("2026");
    expect(prompt).toContain("Wednesday");
    expect(prompt).toContain("(UTC)");
    expect(prompt).toContain("do not default to an earlier year");
  });

  it("date snippet appears before the assistant role instructions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));

    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha"), makeWs("beta")]);

    const dateIndex = prompt.indexOf("Current date:");
    const roleIndex = prompt.indexOf("You are a source code learning assistant");
    expect(dateIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(dateIndex);
  });

  it("reflects a different mocked year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));

    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha")]);

    expect(prompt).toContain("2027");
  });

  it("includes timezone abbreviation and instruction when userTimezone is provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z")); // June → EDT

    const prompt = getMultiWorkspaceSystemPrompt(
      [makeWs("alpha")],
      undefined,
      undefined,
      "America/New_York",
    );

    expect(prompt).toMatch(/EDT|EST/);
    expect(prompt).toContain("Convert all UTC times to this timezone");
  });
});
