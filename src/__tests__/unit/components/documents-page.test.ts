/**
 * Unit tests for src/app/w/[slug]/documents/page.tsx
 *
 * The page no longer uses a feature flag. Instead it redirects to the
 * workspace root when none of `s3Key`, `nodeId`, or `url` are present
 * in the search params — the editor is context-only (always accessible
 * when a document reference is supplied).
 *
 * Verifies:
 * 1. The route is a server component (no "use client" directive).
 * 2. Without an active session, the page redirects to /login.
 * 3. With a session but no query params, redirects to /w/[slug].
 * 4. With any one of ?s3Key=, ?nodeId=, or ?url=, renders DocxEditorPage.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/navigation (redirect throws in the real runtime; we capture it)
// ---------------------------------------------------------------------------

const mockRedirect = vi.fn((url: string): never => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

// ---------------------------------------------------------------------------
// Mock next-auth session
// ---------------------------------------------------------------------------

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// ---------------------------------------------------------------------------
// Mock DocxEditorPage so we don't pull in the full React tree
// ---------------------------------------------------------------------------

vi.mock("@/components/docx-editor/DocxEditorPage", () => ({
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Import the page after mocks are in place
// ---------------------------------------------------------------------------

import DocumentsPage from "@/app/w/[slug]/documents/page";

// ---------------------------------------------------------------------------
// Helper: resolve params/searchParams
// ---------------------------------------------------------------------------

function makeProps(slug: string, sp: Record<string, string> = {}) {
  return {
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(sp),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DocumentsPage — server-side guards (no feature flag)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Session guard ──────────────────────────────────────────────────────────

  test("redirects to /login when session is null (unauthenticated)", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(
      DocumentsPage(makeProps("my-workspace", { s3Key: "some/key.docx" })),
    ).rejects.toThrow("REDIRECT:/login");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  // ── No query params → redirect to workspace root ──────────────────────────

  test("redirects to workspace root when no s3Key, nodeId, or url provided", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    await expect(
      DocumentsPage(makeProps("my-workspace", {})),
    ).rejects.toThrow("REDIRECT:/w/my-workspace");

    expect(mockRedirect).toHaveBeenCalledWith("/w/my-workspace");
  });

  test("redirects to workspace root using correct slug in redirect target", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    await expect(
      DocumentsPage(makeProps("openlaw", {})),
    ).rejects.toThrow("REDIRECT:/w/openlaw");

    expect(mockRedirect).toHaveBeenCalledWith("/w/openlaw");
  });

  // ── At least one query param present → renders editor ─────────────────────

  test("does NOT redirect when ?s3Key= is present", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    try {
      await DocumentsPage(makeProps("my-workspace", { s3Key: "uploads/ws/doc.docx" }));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
        throw err;
      }
    }

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  test("does NOT redirect when ?nodeId= is present", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    try {
      await DocumentsPage(makeProps("my-workspace", { nodeId: "node-abc-123" }));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
        throw err;
      }
    }

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  test("does NOT redirect when ?url= is present", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    try {
      await DocumentsPage(makeProps("my-workspace", {
        url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/doc.docx",
        filename: "doc.docx",
      }));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
        throw err;
      }
    }

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // ── No feature flag dependency ─────────────────────────────────────────────

  test("does not import or reference FEATURE_FLAGS.AI_DOC_EDITOR", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const pagePath = path.resolve(
      process.cwd(),
      "src/app/w/[slug]/documents/page.tsx",
    );
    const source = fs.readFileSync(pagePath, "utf-8");

    expect(source).not.toContain("AI_DOC_EDITOR");
    expect(source).not.toContain("canAccessServerFeature");
    expect(source).not.toContain("FEATURE_FLAGS");
  });

  // ── No "use client" directive ─────────────────────────────────────────────

  test("the page module does not contain a 'use client' directive", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const pagePath = path.resolve(
      process.cwd(),
      "src/app/w/[slug]/documents/page.tsx",
    );
    const source = fs.readFileSync(pagePath, "utf-8");

    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});
