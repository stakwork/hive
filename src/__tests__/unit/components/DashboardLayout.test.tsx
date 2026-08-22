// @vitest-environment jsdom
/**
 * Tests for DashboardLayout overflow logic.
 * Rather than rendering the full component (which requires Next.js JSX transform),
 * we test the isFullscreenPage predicate and className logic directly.
 *
 * isDocumentsPage uses pathname.endsWith("/documents") — not includes("/documents/") —
 * so that sub-paths like /documents-archive do NOT match.
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

/**
 * Mirrors the FIXED isDocumentsPage logic in DashboardLayout.tsx.
 * Uses endsWith("/documents") instead of includes("/documents/").
 */
function isDocumentsPage(pathname: string): boolean {
  return pathname.endsWith("/documents");
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

/** Mirrors the sidebar-offset padding guard (isFullscreenPage) */
function sidebarOffsetClass(pathname: string): string {
  return isFullscreenPage(pathname) ? "md:pl-0" : "md:pl-64";
}

describe("DashboardLayout — isDocumentsPage (endsWith fix)", () => {
  it("returns true for /w/slug/documents (exact terminal segment)", () => {
    expect(isDocumentsPage("/w/my-workspace/documents")).toBe(true);
  });

  it("returns false for /w/slug/documents/some-sub-path (sub-path does not end with /documents)", () => {
    // The editor is now context-only; no sub-paths exist under /documents
    expect(isDocumentsPage("/w/my-workspace/documents/docid")).toBe(false);
  });

  it("returns false for /w/slug/documents-archive (different segment, NOT a false positive)", () => {
    expect(isDocumentsPage("/w/my-workspace/documents-archive")).toBe(false);
  });

  it("returns false for non-documents routes", () => {
    expect(isDocumentsPage("/w/my-workspace/settings")).toBe(false);
    expect(isDocumentsPage("/w/my-workspace")).toBe(false);
    expect(isDocumentsPage("/w/my-workspace/tasks")).toBe(false);
  });
});

describe("DashboardLayout — isFullscreenPage", () => {
  it("returns true for a /plan/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/plan/some-feature-id")).toBe(true);
  });

  it("returns true for a /task/ route", () => {
    expect(isFullscreenPage("/w/my-workspace/task/some-task-id")).toBe(true);
  });

  it("returns true for the exact /documents terminal route", () => {
    expect(isFullscreenPage("/w/my-workspace/documents")).toBe(true);
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

  it("returns false for /documents-archive (no false positive)", () => {
    expect(isFullscreenPage("/w/my-workspace/documents-archive")).toBe(false);
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

  it("applies overflow-hidden and p-0 on /w/slug/documents", () => {
    const cls = mainClassName("/w/slug/documents");
    expect(cls).toContain("overflow-hidden");
    expect(cls).toContain("p-0");
    expect(cls).not.toContain("overflow-auto");
    expect(cls).not.toContain("p-1");
    expect(cls).not.toContain("md:p-3");
  });

  it("does NOT apply documents styles to /w/slug/documents-archive", () => {
    const cls = mainClassName("/w/slug/documents-archive");
    // documents-archive is neither docs nor fullscreen — should be overflow-auto
    expect(cls).toContain("overflow-auto");
    expect(cls).not.toContain("p-0");
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

describe("DashboardLayout — sidebar-offset padding (isFullscreenPage guard)", () => {
  it("applies md:pl-0 on /documents route (fullscreen)", () => {
    expect(sidebarOffsetClass("/w/slug/documents")).toBe("md:pl-0");
  });

  it("applies md:pl-0 on /task/ route (fullscreen)", () => {
    expect(sidebarOffsetClass("/w/slug/task/abc")).toBe("md:pl-0");
  });

  it("applies md:pl-64 on /settings (non-fullscreen)", () => {
    expect(sidebarOffsetClass("/w/slug/settings")).toBe("md:pl-64");
  });

  it("does NOT apply fullscreen padding to /documents-archive", () => {
    expect(sidebarOffsetClass("/w/slug/documents-archive")).toBe("md:pl-64");
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
