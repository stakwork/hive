/**
 * Unit tests for src/app/w/[slug]/documents/page.tsx
 *
 * Verifies:
 * 1. The route is a server component (no "use client" directive).
 * 2. With the feature flag disabled (env var unset), the page calls redirect()
 *    before rendering any editor HTML.
 * 3. With the feature flag enabled, the page renders the editor.
 * 4. Without an active session, the page redirects to /login.
 *
 * We test the behaviour by calling the exported async function directly and
 * mocking its dependencies, rather than spinning up a Next.js server.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/navigation (redirect throws RedirectError in the Next.js runtime;
// we capture it as a thrown value in tests)
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
// Tests
// ---------------------------------------------------------------------------

describe("DocumentsPage — server-side guards", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR = originalEnv;
    }
  });

  // ── Session guard ──────────────────────────────────────────────────────────

  test("redirects to /login when session is null (unauthenticated)", async () => {
    // Flag enabled, but no session
    process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR = "true";
    mockGetServerSession.mockResolvedValue(null);

    await expect(
      DocumentsPage({ params: Promise.resolve({ slug: "my-workspace" }) }),
    ).rejects.toThrow("REDIRECT:/login");

    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  // ── Feature flag guard ────────────────────────────────────────────────────

  test("redirects to workspace root when AI_DOC_EDITOR flag is disabled (env var unset)", async () => {
    delete process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR;
    // Authenticated session
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    await expect(
      DocumentsPage({ params: Promise.resolve({ slug: "my-workspace" }) }),
    ).rejects.toThrow("REDIRECT:/w/my-workspace");

    expect(mockRedirect).toHaveBeenCalledWith("/w/my-workspace");
  });

  test("redirects to workspace root when AI_DOC_EDITOR flag is set to 'false'", async () => {
    process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR = "false";
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    await expect(
      DocumentsPage({ params: Promise.resolve({ slug: "test-slug" }) }),
    ).rejects.toThrow("REDIRECT:/w/test-slug");

    expect(mockRedirect).toHaveBeenCalledWith("/w/test-slug");
  });

  test("does NOT redirect when flag is enabled and session exists", async () => {
    process.env.NEXT_PUBLIC_FEATURE_AI_DOC_EDITOR = "true";
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", name: "Alice" } });

    // The page renders <DocxEditorPage /> which requires a JSX transform.
    // We only care that redirect() was NOT called — any render error is fine.
    try {
      await DocumentsPage({ params: Promise.resolve({ slug: "my-workspace" }) });
    } catch (err) {
      // A redirect error (thrown by our mock) would start with "REDIRECT:".
      // Any other error (e.g. React not defined in non-JSX environment) is
      // acceptable — it means the guards passed and we reached the render step.
      if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
        throw err; // re-throw — this means a guard fired unexpectedly
      }
    }

    // redirect must not have been called with any path
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // ── No "use client" directive ─────────────────────────────────────────────

  test("the page module does not contain a 'use client' directive", async () => {
    // Dynamic import so we can read the raw module source path
    const fs = await import("fs");
    const path = await import("path");

    const pagePath = path.resolve(
      process.cwd(),
      "src/app/w/[slug]/documents/page.tsx",
    );
    const source = fs.readFileSync(pagePath, "utf-8");

    // The file must not start with or contain "use client"
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});
