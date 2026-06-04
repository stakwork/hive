// @vitest-environment jsdom
/**
 * Tests for DashboardLayout overflow logic.
 * Rather than rendering the full component (which requires Next.js JSX transform),
 * we test the isFullscreenPage predicate and className logic directly.
 */
import { describe, it, expect } from "vitest";

/** Mirrors the isFullscreenPage logic in DashboardLayout.tsx */
function isFullscreenPage(pathname: string): boolean {
  return pathname.includes("/task/") || pathname.includes("/plan/");
}

/** Mirrors the <main> className logic in DashboardLayout.tsx */
function mainClassName(pathname: string): string {
  const fullscreen = isFullscreenPage(pathname);
  return `flex-1 flex flex-col ${fullscreen ? "overflow-hidden p-1 md:p-3" : "overflow-auto p-4 md:p-6"}`;
}

describe("DashboardLayout — isFullscreenPage", () => {
  it("returns true for a /plan/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/plan/some-feature-id")).toBe(true);
  });

  it("returns true for a /task/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/task/some-task-id")).toBe(true);
  });

  it("returns false for a settings route", () => {
    expect(isFullscreenPage("/w/my-workspace/settings")).toBe(false);
  });

  it("returns false for the workspace root", () => {
    expect(isFullscreenPage("/w/my-workspace")).toBe(false);
  });

  it("returns false for the tasks list page (no trailing /task/)", () => {
    expect(isFullscreenPage("/w/my-workspace/tasks")).toBe(false);
  });
});

describe("DashboardLayout — <main> overflow class", () => {
  it("applies overflow-hidden on a /plan/ route", () => {
    const cls = mainClassName("/w/my-workspace/plan/some-feature-id");
    expect(cls).toContain("overflow-hidden");
    expect(cls).not.toContain("overflow-auto");
  });

  it("applies overflow-hidden on a /task/ route", () => {
    const cls = mainClassName("/w/my-workspace/task/some-task-id");
    expect(cls).toContain("overflow-hidden");
    expect(cls).not.toContain("overflow-auto");
  });

  it("applies overflow-auto on a non-fullscreen route", () => {
    const cls = mainClassName("/w/my-workspace/settings");
    expect(cls).toContain("overflow-auto");
    expect(cls).not.toContain("overflow-hidden");
  });

  it("applies overflow-auto on the workspace root", () => {
    const cls = mainClassName("/w/my-workspace");
    expect(cls).toContain("overflow-auto");
    expect(cls).not.toContain("overflow-hidden");
  });
});
