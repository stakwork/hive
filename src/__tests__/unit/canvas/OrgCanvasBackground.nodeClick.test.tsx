// @vitest-environment jsdom
/**
 * Unit tests for `onNodeClick` and `onNodeDoubleClick` wiring in
 * `OrgCanvasBackground`.
 *
 * Strategy: source-level prop assertion (same pattern as the
 * multiSelectKey test) — we verify the compiled TSX contains the
 * correct prop bindings rather than fully mounting the component,
 * which would require mocking ~40 deep dependencies.
 *
 * Additionally we verify that `onSelectionChange` is still present
 * alongside the new callbacks so the three props co-exist on the
 * same `<SystemCanvas>` mount.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SOURCE_PATH = path.resolve(
  process.cwd(),
  "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
);

const source = fs.readFileSync(SOURCE_PATH, "utf-8");

// Pull out the SystemCanvas JSX block for scoped assertions
const systemCanvasBlock =
  source.match(/<SystemCanvas\s+ref=[\s\S]*?\/>/)?.[0] ?? "";

describe("OrgCanvasBackground – onNodeClick / onNodeDoubleClick wiring", () => {
  it("passes onNodeClick={handleNodeClick} to <SystemCanvas>", () => {
    expect(systemCanvasBlock).toContain("onNodeClick={handleNodeClick}");
  });

  it("passes onNodeDoubleClick={handleNodeDoubleClick} to <SystemCanvas>", () => {
    expect(systemCanvasBlock).toContain(
      "onNodeDoubleClick={handleNodeDoubleClick}",
    );
  });

  it("onSelectionChange still present alongside the new callbacks", () => {
    expect(systemCanvasBlock).toContain(
      "onSelectionChange={handleSelectionChange}",
    );
  });

  it("defines handleNodeClick as a useCallback in the component body", () => {
    expect(source).toContain("const handleNodeClick = useCallback(");
  });

  it("defines handleNodeDoubleClick as a useCallback in the component body", () => {
    expect(source).toContain("const handleNodeDoubleClick = useCallback(");
  });

  it("handleNodeClick accepts a CanvasNode parameter", () => {
    // Check the callback signature includes (node: CanvasNode)
    const match = source.match(
      /const handleNodeClick = useCallback\(\s*\(([^)]+)\)/,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toContain("node");
  });

  it("handleNodeDoubleClick accepts a CanvasNode parameter", () => {
    const match = source.match(
      /const handleNodeDoubleClick = useCallback\(\s*\(([^)]+)\)/,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toContain("node");
  });
});
