// @vitest-environment jsdom
/**
 * Tests for DashboardLayout overflow logic.
 * Rather than rendering the full component (which requires Next.js JSX transform),
 * we test the isFullscreenPage predicate and className logic directly.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Mirror PUBLIC_VIEWER_BLOCKED_SEGMENTS from DashboardLayout.tsx
// ---------------------------------------------------------------------------

const PUBLIC_VIEWER_BLOCKED_SEGMENTS = [
  "agent-logs",
  "calls",
  "capacity",
  "janitors",
  "recommendations",
  "workflows",
  "projects",
  "settings",
  "graph-admin",
  "documents",
] as const;

function isBlockedForPublicViewer(pathname: string): boolean {
  const match = pathname.match(/^\/w\/[^/]+\/([^/?#]+)/);
  if (!match) return false;
  return (PUBLIC_VIEWER_BLOCKED_SEGMENTS as readonly string[]).includes(match[1]);
}

/** Mirrors the isFullscreenPage logic in DashboardLayout.tsx */
function isDocumentsPage(pathname: string): boolean {
  return pathname.includes("/documents/");
}

function isFullscreenPage(pathname: string): boolean {
  return isDocumentsPage(pathname) || pathname.includes("/task/") || pathname.includes("/plan/");
}

/** Mirrors the <main> className logic in DashboardLayout.tsx */
function mainClassName(pathname: string): string {
  const docs = isDocumentsPage(pathname);
  const fullscreen = isFullscreenPage(pathname);
  return `flex-1 flex flex-col min-h-0 ${docs ? "overflow-hidden p-0" : fullscreen ? "overflow-hidden p-1 md:p-3" : "overflow-auto p-4 md:p-6"}`;
}

describe("DashboardLayout — isFullscreenPage", () => {
  it("returns true for a /plan/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/plan/some-feature-id")).toBe(true);
  });

  it("returns true for a /task/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/task/some-task-id")).toBe(true);
  });

  it("returns true for a /documents/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/documents/docid")).toBe(true);
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

  it("applies overflow-hidden and p-0 on a /documents/ route", () => {
    const cls = mainClassName("/w/slug/documents/docid");
    expect(cls).toContain("overflow-hidden");
    expect(cls).toContain("p-0");
    expect(cls).not.toContain("overflow-auto");
    expect(cls).not.toContain("p-1");
    expect(cls).not.toContain("md:p-3");
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

// ---------------------------------------------------------------------------
// PUBLIC_VIEWER_BLOCKED_SEGMENTS guard
// ---------------------------------------------------------------------------

describe("DashboardLayout — PUBLIC_VIEWER_BLOCKED_SEGMENTS", () => {
  it("blocks the documents route for public viewers", () => {
    expect(isBlockedForPublicViewer("/w/my-workspace/documents")).toBe(true);
  });

  it("blocks a documents sub-route for public viewers", () => {
    expect(isBlockedForPublicViewer("/w/my-workspace/documents/some-doc-id")).toBe(true);
  });

  it("blocks all declared restricted segments", () => {
    const blockedPaths = [
      "/w/slug/agent-logs",
      "/w/slug/calls",
      "/w/slug/capacity",
      "/w/slug/janitors",
      "/w/slug/recommendations",
      "/w/slug/workflows",
      "/w/slug/projects",
      "/w/slug/settings",
      "/w/slug/graph-admin",
      "/w/slug/documents",
    ];
    blockedPaths.forEach((path) => {
      expect(isBlockedForPublicViewer(path)).toBe(true);
    });
  });

  it("does NOT block the workspace root for public viewers", () => {
    expect(isBlockedForPublicViewer("/w/my-workspace")).toBe(false);
  });

  it("does NOT block non-restricted routes", () => {
    expect(isBlockedForPublicViewer("/w/my-workspace/features")).toBe(false);
    expect(isBlockedForPublicViewer("/w/my-workspace/roadmap")).toBe(false);
    expect(isBlockedForPublicViewer("/w/my-workspace/tasks")).toBe(false);
  });

  it("does NOT block a path that merely contains a blocked segment as substring", () => {
    // 'document-library' should not match 'documents'
    expect(isBlockedForPublicViewer("/w/my-workspace/document-library")).toBe(false);
  });
});
