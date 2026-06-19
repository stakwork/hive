// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock heavy dependencies so the component can be imported in unit tests
// ---------------------------------------------------------------------------

vi.mock("system-canvas-react", () => ({
  SystemCanvas: vi.fn((props: Record<string, unknown>, ref: unknown) => {
    void ref;
    return React.createElement("div", { "data-testid": "system-canvas", ...props });
  }),
  addNode: vi.fn(),
  removeNode: vi.fn(),
  updateNode: vi.fn(),
  addEdge: vi.fn(),
  removeEdge: vi.fn(),
  updateEdge: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/org/test",
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws1", name: "Test" },
    slug: "test",
  }),
}));

vi.mock("@/hooks/useCanvasCollaboration", () => ({
  useCanvasCollaboration: () => ({
    collaborators: [],
    broadcastCursor: vi.fn(),
    broadcastSelection: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Snapshot-free prop assertion
// ---------------------------------------------------------------------------

describe("OrgCanvasBackground – SystemCanvas props", () => {
  it('passes multiSelectKey="space" to SystemCanvas', async () => {
    // Import after mocks are set up
    const { SystemCanvas } = await import("system-canvas-react");
    const mockFn = vi.mocked(SystemCanvas) as ReturnType<typeof vi.fn>;

    // Verify the mock captured at least one call with the right prop
    // We test the prop directly via a minimal render of the component.
    // Because OrgCanvasBackground has many hard deps, we verify the
    // source-of-truth via a regex search on the compiled source instead.
    // This is intentionally lightweight — a heavier integration mount would
    // require mocking 40+ modules.

    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx"
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // The prop must appear adjacent to panMode="trackpad" in the JSX
    expect(source).toContain('multiSelectKey="space"');

    // Ensure panMode and multiSelectKey co-exist on the same SystemCanvas mount
    const systemCanvasBlock = source.match(/<SystemCanvas\s+ref=[\s\S]*?\/>/)?.[0] ?? "";
    expect(systemCanvasBlock).toContain('panMode="trackpad"');
    expect(systemCanvasBlock).toContain('multiSelectKey="space"');

    void mockFn; // satisfy no-unused-vars
  });
});
