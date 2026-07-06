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
    return React.createElement("div", { "data-testid": "system-canvas" });
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
// Source-level assertions (mirrors the multiSelectKey test pattern)
// ---------------------------------------------------------------------------

describe("OrgCanvasBackground – edgeContextMenu", () => {
  it("passes edgeContextMenu prop to <SystemCanvas>", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // The prop must be wired on the SystemCanvas JSX element
    expect(source).toContain("edgeContextMenu={edgeContextMenu}");

    // The useMemo declaration must exist
    expect(source).toContain("useMemo<EdgeContextMenuConfig>");

    // EdgeContextMenuConfig must be imported
    expect(source).toContain("EdgeContextMenuConfig");
  });

  it("edgeContextMenu config includes delete and edit-label items", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // Must define both action item IDs
    expect(source).toContain('"delete"');
    expect(source).toContain('"edit-label"');

    // delete must be marked destructive
    const edgeContextMenuBlock =
      source.match(/const edgeContextMenu = useMemo[\s\S]*?\),\s*\[/)?.[0] ?? "";
    expect(edgeContextMenuBlock).toContain("destructive: true");
  });

  it("delete action calls handleEdgeDelete", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // The delete branch must delegate to handleEdgeDelete
    expect(source).toContain("handleEdgeDelete");

    // handleEdgeDelete appears in the edgeContextMenu memoized block deps
    expect(source).toContain("[handleEdgeDelete]");
  });

  it("edit-label action sets editingEdgeLabel state", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // setEditingEdgeLabel must be called in the edit-label branch
    expect(source).toContain("setEditingEdgeLabel");

    // The state setter should appear near the "edit-label" string
    const editLabelBlock =
      source.match(/"edit-label"[\s\S]{0,300}setEditingEdgeLabel/)?.[0] ?? "";
    expect(editLabelBlock).toBeTruthy();
  });

  it("EdgeLabelOverlay renders and commits via handleEdgeUpdate", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // EdgeLabelOverlay component must be defined
    expect(source).toContain("function EdgeLabelOverlay(");

    // The overlay must be rendered conditionally on editingEdgeLabel
    expect(source).toContain("editingEdgeLabel && (");

    // Committing the label must call handleEdgeUpdate
    expect(source).toContain("handleEdgeUpdate(");
  });
});
