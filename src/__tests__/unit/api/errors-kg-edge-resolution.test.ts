/**
 * Unit tests for KG edge-resolution helpers in the errors webhook route:
 *   - selectFrameCandidates: inApp preference, all-frames fallback, parseStackFrames fallback
 *   - matchFileNode: strongest-match precedence, ambiguous ties, `file` key (not file_path)
 *   - matchesFilePath: exact, suffix, no bare-endsWith loose match
 */
import { describe, test, expect } from "vitest";
import {
  selectFrameCandidates,
  matchFileNode,
  matchesFilePath,
  parseStackFrames,
} from "@/lib/utils/error-stack-frames";
import type { StructuredFrame } from "@/lib/utils/error-frames";

// ── selectFrameCandidates ─────────────────────────────────────────────────────

describe("selectFrameCandidates", () => {
  test("prefers inApp === true frames when present", () => {
    const frames: StructuredFrame[] = [
      { filename: "gems/rack/lib/rack.rb", function: "call", inApp: false },
      { filename: "app/workers/my_worker.rb", function: "perform", inApp: true },
      { filename: "app/services/my_service.rb", function: "run", inApp: true },
    ];
    const { candidates, source } = selectFrameCandidates(frames, null);
    expect(source).toBe("frames");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.filePath)).toEqual([
      "app/workers/my_worker.rb",
      "app/services/my_service.rb",
    ]);
    // Non-inApp frame excluded
    expect(candidates.map((c) => c.filePath)).not.toContain("gems/rack/lib/rack.rb");
  });

  test("falls back to ALL frames when none are flagged inApp", () => {
    const frames: StructuredFrame[] = [
      { filename: "app/workers/my_worker.rb", function: "perform" },
      { filename: "app/services/my_service.rb", function: "run" },
    ];
    const { candidates, source } = selectFrameCandidates(frames, null);
    expect(source).toBe("frames");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.filePath)).toEqual([
      "app/workers/my_worker.rb",
      "app/services/my_service.rb",
    ]);
  });

  test("falls back to ALL frames when inApp is explicitly false on all", () => {
    const frames: StructuredFrame[] = [
      { filename: "lib/foo.rb", inApp: false },
      { filename: "lib/bar.rb", inApp: false },
    ];
    const { candidates, source } = selectFrameCandidates(frames, null);
    expect(source).toBe("frames");
    expect(candidates).toHaveLength(2);
  });

  test("falls back to parseStackFrames when frames is empty", () => {
    const { candidates, source } = selectFrameCandidates(
      [],
      "  at doThing (src/foo/bar.ts:10:5)\n  at main (src/app.ts:1:1)"
    );
    expect(source).toBe("stackTrace");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].filePath).toBeTruthy();
  });

  test("returns empty candidates when frames is empty and stackTrace is null", () => {
    const { candidates, source } = selectFrameCandidates([], null);
    expect(source).toBe("stackTrace");
    expect(candidates).toHaveLength(0);
  });

  test("caps at TOP_FRAME_COUNT (5) from inApp frames", () => {
    const frames: StructuredFrame[] = Array.from({ length: 8 }, (_, i) => ({
      filename: `app/file${i}.rb`,
      function: `fn${i}`,
      inApp: true,
    }));
    const { candidates } = selectFrameCandidates(frames, null);
    expect(candidates).toHaveLength(5);
  });

  test("caps at TOP_FRAME_COUNT (5) from all frames when none are inApp", () => {
    const frames: StructuredFrame[] = Array.from({ length: 8 }, (_, i) => ({
      filename: `app/file${i}.rb`,
      function: `fn${i}`,
    }));
    const { candidates } = selectFrameCandidates(frames, null);
    expect(candidates).toHaveLength(5);
  });

  test("maps function to functionName, filename to filePath", () => {
    const frames: StructuredFrame[] = [
      { filename: "app/workers/x.rb", function: "perform", inApp: true },
    ];
    const { candidates } = selectFrameCandidates(frames, null);
    expect(candidates[0]).toEqual({ filePath: "app/workers/x.rb", functionName: "perform" });
  });

  test("sets functionName to null when function is undefined", () => {
    const frames: StructuredFrame[] = [
      { filename: "app/workers/x.rb", inApp: true },
    ];
    const { candidates } = selectFrameCandidates(frames, null);
    expect(candidates[0].functionName).toBeNull();
  });
});

// ── matchFileNode ─────────────────────────────────────────────────────────────

type MockNode = { ref_id: string; node_type: string; properties: Record<string, unknown> };

function fileNode(refId: string, filePath: string, repoId = "repo1", useFileKey = true): MockNode {
  return {
    ref_id: refId,
    node_type: "File",
    properties: {
      ...(useFileKey ? { file: filePath } : { file_path: filePath }),
      repository_id: repoId,
    },
  };
}

describe("matchFileNode — node `file` key (not file_path)", () => {
  test("resolves a node exposing only the `file` property", () => {
    const nodes = [fileNode("ref-a", "stakwork/hive/app/workers/x.rb")];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result?.ref_id).toBe("ref-a");
  });

  test("resolves a node exposing only file_path (fallback retained)", () => {
    const nodes = [fileNode("ref-b", "stakwork/hive/app/workers/x.rb", "repo1", false)];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result?.ref_id).toBe("ref-b");
  });
});

describe("matchFileNode — strongest-match precedence", () => {
  test("(a) exact match: returns node when norm === framePath", () => {
    const nodes = [
      fileNode("ref-exact", "app/workers/x.rb"),
      fileNode("ref-suffix", "stakwork/hive/app/workers/x.rb"),
    ];
    // The framePath exactly equals the first node's path → exact wins
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result?.ref_id).toBe("ref-exact");
  });

  test("(b) full relative path suffix: frame app/workers/x.rb matches stakwork/hive/app/workers/x.rb", () => {
    const nodes = [
      fileNode("ref-script", "stakwork/hive/app/workers/script_graph_recorder_worker.rb"),
      fileNode("ref-spec", "stakwork/hive/spec/workers/script_graph_recorder_worker_spec.rb"),
    ];
    const result = matchFileNode(nodes, "app/workers/script_graph_recorder_worker.rb");
    expect(result?.ref_id).toBe("ref-script");
  });

  test("(b) suffix: frame app/workers/x.rb vs spec/workers/x_spec.rb → resolves to app/workers/x.rb", () => {
    const nodes = [
      fileNode("ref-app", "stakwork/hive/app/workers/x.rb"),
      fileNode("ref-spec", "stakwork/hive/spec/workers/x_spec.rb"),
    ];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result?.ref_id).toBe("ref-app");
  });

  test("(b) true collision: frame app/a/x.rb with nodes {app/a/x.rb, app/b/x.rb} → resolves to app/a/x.rb", () => {
    const nodes = [
      fileNode("ref-a", "stakwork/hive/app/a/x.rb"),
      fileNode("ref-b", "stakwork/hive/app/b/x.rb"),
    ];
    const result = matchFileNode(nodes, "app/a/x.rb");
    expect(result?.ref_id).toBe("ref-a");
  });

  test("(c) bare basename is ambiguous when two nodes share same filename → returns undefined", () => {
    const nodes = [
      fileNode("ref-a", "stakwork/hive/app/a/x.rb"),
      fileNode("ref-b", "stakwork/hive/app/b/x.rb"),
    ];
    // Bare basename x.rb — ambiguous, must not link either
    const result = matchFileNode(nodes, "x.rb");
    expect(result).toBeUndefined();
  });

  test("(c) bare basename is unambiguous when only one node has that filename → resolves it", () => {
    const nodes = [
      fileNode("ref-unique", "stakwork/hive/app/workers/unique_worker.rb"),
      fileNode("ref-other", "stakwork/hive/app/workers/other_worker.rb"),
    ];
    const result = matchFileNode(nodes, "unique_worker.rb");
    expect(result?.ref_id).toBe("ref-unique");
  });

  test("(a) exact tie → ambiguous, returns undefined", () => {
    // Two nodes with the same exact path — ambiguous
    const nodes = [
      fileNode("ref-1", "app/workers/x.rb"),
      fileNode("ref-2", "app/workers/x.rb"),
    ];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result).toBeUndefined();
  });

  test("(b) suffix tie → ambiguous, returns undefined", () => {
    // Two nodes where both end with "/app/workers/x.rb"
    const nodes = [
      fileNode("ref-1", "repo1/app/workers/x.rb"),
      fileNode("ref-2", "repo2/app/workers/x.rb"),
    ];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result).toBeUndefined();
  });

  test("returns undefined when no node matches framePath", () => {
    const nodes = [fileNode("ref-other", "stakwork/hive/app/workers/other.rb")];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result).toBeUndefined();
  });

  test("filters to only File nodes (ignores Function nodes)", () => {
    const nodes: MockNode[] = [
      { ref_id: "func-ref", node_type: "Function", properties: { file: "app/workers/x.rb", name: "perform" } },
    ];
    const result = matchFileNode(nodes, "app/workers/x.rb");
    expect(result).toBeUndefined();
  });
});

// ── matchesFilePath ───────────────────────────────────────────────────────────

describe("matchesFilePath", () => {
  test("exact match returns true", () => {
    expect(matchesFilePath("app/workers/x.rb", "app/workers/x.rb")).toBe(true);
  });

  test("full repo-qualified path suffix match returns true", () => {
    expect(matchesFilePath("stakwork/hive/app/workers/x.rb", "app/workers/x.rb")).toBe(true);
  });

  test("bare basename matches via /basename suffix (path separator required)", () => {
    // "x.rb" → endsWith("/x.rb") → true for "app/workers/x.rb"
    // This is intentional: a bare basename frame still resolves to the matching node.
    // Ambiguous basename collisions are handled by matchFileNode, not matchesFilePath.
    expect(matchesFilePath("app/workers/x.rb", "x.rb")).toBe(true);
  });

  test("partial path without separator does NOT match (old loose-endsWith bug)", () => {
    // Old: norm.endsWith("rkers/x.rb") would be true for "app/workers/x.rb" (too loose)
    // New: norm.endsWith("/" + "rkers/x.rb") = endsWith("/rkers/x.rb") = false
    expect(matchesFilePath("app/workers/x.rb", "rkers/x.rb")).toBe(false);
  });

  test("returns false when nodePath is undefined", () => {
    expect(matchesFilePath(undefined, "app/workers/x.rb")).toBe(false);
  });

  test("returns false when framePath is null", () => {
    expect(matchesFilePath("app/workers/x.rb", null)).toBe(false);
  });

  test("handles backslash-separated paths (Windows)", () => {
    expect(matchesFilePath("stakwork\\hive\\app\\workers\\x.rb", "app/workers/x.rb")).toBe(true);
  });
});

// ── parseStackFrames (regression guard) ──────────────────────────────────────

describe("parseStackFrames (V8 / Firefox fallback)", () => {
  test("parses V8 at-format frames", () => {
    const frames = parseStackFrames("  at doThing (src/foo/bar.ts:10:5)\n  at main (src/app.ts:1:1)");
    expect(frames[0].functionName).toBe("doThing");
    // extractFileName returns the basename
    expect(frames[0].filePath).toBe("bar.ts");
  });

  test("returns empty for empty string", () => {
    expect(parseStackFrames("")).toHaveLength(0);
  });
});

// ── Per-file path normalization (new exact-match fetch logic) ─────────────────

/**
 * Helper: mirrors the normalization logic in the webhook route's KG edge block.
 * Used to verify path-building correctness without importing the route itself.
 */
function normalizePath(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const norm = filePath.replace(/^(?:\.\/|\/+|(?:[A-Za-z]:)?[/\\]+)/, "");
  return norm || null;
}

function buildFullPath(repoKey: string, filePath: string | null | undefined): string | null {
  const norm = normalizePath(filePath);
  if (!norm) return null;
  return `${repoKey}/${norm}`;
}

describe("per-file path normalization — buildFullPath", () => {
  const REPO_KEY = "stakwork/senza-lnd";

  test("bare relative path unchanged", () => {
    expect(buildFullPath(REPO_KEY, "app/controllers/admin/translations_controller.rb"))
      .toBe("stakwork/senza-lnd/app/controllers/admin/translations_controller.rb");
  });

  test("leading '/' stripped", () => {
    expect(buildFullPath(REPO_KEY, "/app/controllers/admin/translations_controller.rb"))
      .toBe("stakwork/senza-lnd/app/controllers/admin/translations_controller.rb");
  });

  test("leading './' stripped", () => {
    expect(buildFullPath(REPO_KEY, "./app/workers/my_worker.rb"))
      .toBe("stakwork/senza-lnd/app/workers/my_worker.rb");
  });

  test("multiple leading slashes stripped", () => {
    expect(buildFullPath(REPO_KEY, "///app/services/foo.rb"))
      .toBe("stakwork/senza-lnd/app/services/foo.rb");
  });

  test("null filePath → returns null (null guard)", () => {
    expect(buildFullPath(REPO_KEY, null)).toBeNull();
  });

  test("undefined filePath → returns null (null guard)", () => {
    expect(buildFullPath(REPO_KEY, undefined)).toBeNull();
  });

  test("empty string filePath → returns null (null guard)", () => {
    expect(buildFullPath(REPO_KEY, "")).toBeNull();
  });

  test("basename-only (no directory) still builds a path", () => {
    // parseStackFrames fallback produces basenames — documented limitation
    expect(buildFullPath(REPO_KEY, "bar.ts")).toBe("stakwork/senza-lnd/bar.ts");
  });
});

describe("per-file deduplication via Set", () => {
  const REPO_KEY = "stakwork/hive";

  test("multiple frames pointing to the same file dedupe to one entry", () => {
    const candidates: Array<{ filePath: string | null }> = [
      { filePath: "app/controllers/orders_controller.rb" },
      { filePath: "app/controllers/orders_controller.rb" },
      { filePath: "app/controllers/orders_controller.rb" },
    ];

    const uniquePaths = new Set<string>();
    for (const frame of candidates) {
      if (!frame.filePath) continue;
      const norm = normalizePath(frame.filePath);
      if (!norm) continue;
      uniquePaths.add(`${REPO_KEY}/${norm}`);
    }

    expect(uniquePaths.size).toBe(1);
    expect(Array.from(uniquePaths)[0]).toBe("stakwork/hive/app/controllers/orders_controller.rb");
  });

  test("frames pointing to different files produce separate entries", () => {
    const candidates: Array<{ filePath: string | null }> = [
      { filePath: "app/controllers/orders_controller.rb" },
      { filePath: "app/services/order_service.rb" },
      { filePath: "app/workers/order_worker.rb" },
    ];

    const uniquePaths = new Set<string>();
    for (const frame of candidates) {
      if (!frame.filePath) continue;
      const norm = normalizePath(frame.filePath);
      if (!norm) continue;
      uniquePaths.add(`${REPO_KEY}/${norm}`);
    }

    expect(uniquePaths.size).toBe(3);
  });

  test("null filePath candidates are skipped and not added to Set", () => {
    const candidates: Array<{ filePath: string | null }> = [
      { filePath: null },
      { filePath: "app/workers/my_worker.rb" },
      { filePath: null },
    ];

    const uniquePaths = new Set<string>();
    for (const frame of candidates) {
      if (!frame.filePath) continue;
      const norm = normalizePath(frame.filePath);
      if (!norm) continue;
      uniquePaths.add(`${REPO_KEY}/${norm}`);
    }

    expect(uniquePaths.size).toBe(1);
  });
});

describe("File(null pagerank) + Function(non-null pagerank) — matcher selects Function's score", () => {
  // When pooled nodes include a File node with no pagerank and a Function node
  // with a pagerank score, matchFileNode + the function search both succeed,
  // both edges are drawn, and computeImpactScore (which picks max pagerank)
  // correctly returns the Function's score (not null from the File node).

  test("matchFileNode resolves File node even when pagerank is null", () => {
    const nodes: MockNode[] = [
      {
        ref_id: "file-ref",
        node_type: "File",
        properties: { file: "stakwork/senza-lnd/app/controllers/admin/translations_controller.rb" },
        // No pagerank — null/missing
      },
      {
        ref_id: "func-ref",
        node_type: "Function",
        properties: {
          name: "edit",
          file: "stakwork/senza-lnd/app/controllers/admin/translations_controller.rb",
          pagerank: 0.405,
        },
      },
    ];

    const fileMatch = matchFileNode(nodes, "app/controllers/admin/translations_controller.rb");
    expect(fileMatch?.ref_id).toBe("file-ref");

    const funcMatch = nodes.find(
      (n) =>
        n.node_type === "Function" &&
        n.properties.name === "edit" &&
        matchesFilePath(
          n.properties.file as string,
          "app/controllers/admin/translations_controller.rb",
        ),
    );
    expect(funcMatch?.ref_id).toBe("func-ref");
    // The Function node has the non-null pagerank — computeImpactScore would pick this
    expect(funcMatch?.properties.pagerank).toBe(0.405);
    // The File node has no pagerank — confirms scorer must look at all matched nodes
    expect(fileMatch?.properties?.pagerank).toBeUndefined();
  });
});
