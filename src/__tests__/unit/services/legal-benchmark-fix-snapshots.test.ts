/**
 * Unit tests for legal-benchmark-fix-snapshots.ts — the server-side fix
 * source behind the run report's snapshot section.
 *
 * Contract under test:
 *   fetchFixSnapshots(jarvisConfig, taskSlug, { runId?, projectId? })
 *     → FixSnapshotEntry[]
 *
 * Coverage per the feature brief:
 *   - rejected fixes RETAINED (unlike the proposed-fixes route)
 *   - run attribution: rerun_run_id match, else project match → fromThisRun,
 *     badged entries sorted first (stable within groups)
 *   - no runId → nothing badged
 *   - empty array (not an error) when the task slug / Jarvis config is
 *     missing or the graph read fails
 *   - projectFix passes the seven snapshot fields through and still
 *     whitelists (no unexpected node data leaks)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearchNodesByAttributes,
}));

import {
  fetchFixSnapshots,
  projectFix,
} from "@/services/legal-benchmark-fix-snapshots";
import { FIX_SNAPSHOT_SHAPES } from "@/app/api/mock/jarvis/graph/fix-snapshot-fixtures";
import type { JarvisConnectionConfig } from "@/types/jarvis";

const CONFIG: JarvisConnectionConfig = {
  jarvisUrl: "https://jarvis.example.com",
  apiKey: "test-key",
};

function node(ref_id: string, properties: Record<string, unknown>) {
  return { ref_id, node_type: "ProposedFix", properties };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.USE_MOCKS;
  mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });
});

describe("fetchFixSnapshots — guard rails", () => {
  it("returns [] when the task slug is missing, without touching the graph", async () => {
    expect(await fetchFixSnapshots(CONFIG, null)).toEqual([]);
    expect(await fetchFixSnapshots(CONFIG, "")).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  it("returns [] when the Jarvis config is missing", async () => {
    expect(await fetchFixSnapshots(null, "task-1")).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  it("returns [] (not an error) when the graph read fails", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: false, nodes: [], status: 502 });
    expect(await fetchFixSnapshots(CONFIG, "task-1")).toEqual([]);
  });

  it("queries ProposedFix nodes by task_slug with properties included", async () => {
    await fetchFixSnapshots(CONFIG, "task-1");
    expect(mockSearchNodesByAttributes).toHaveBeenCalledWith(CONFIG, {
      nodeTypes: ["ProposedFix"],
      filters: [{ attribute: "task_slug", value: "task-1", comparator: "=" }],
      includeProperties: true,
    });
  });
});

describe("fetchFixSnapshots — rejected retention and attribution", () => {
  const NODES = [
    node("fix-accepted", {
      criterion_title: "A",
      eval_status: "accepted",
      status: "accepted",
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
    }),
    node("fix-rejected", {
      criterion_title: "B",
      // Canonical precedence: eval_status wins over a conflicting legacy status
      eval_status: "rejected",
      status: "accepted",
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocumentation,
    }),
    node("fix-this-run", {
      criterion_title: "C",
      status: "pending",
      rerun_run_id: "run-42",
      ...FIX_SNAPSHOT_SHAPES.promptEdit,
    }),
    node("fix-this-project", {
      criterion_title: "D",
      status: "pending",
      unique_source_id: "57419",
      ...FIX_SNAPSHOT_SHAPES.conceptCreate,
    }),
  ];

  beforeEach(() => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: NODES });
  });

  it("retains rejected fixes (canonical eval_status resolution preserved on the entry)", async () => {
    const entries = await fetchFixSnapshots(CONFIG, "task-1");
    const rejected = entries.find((e) => e.ref_id === "fix-rejected");
    expect(rejected).toBeDefined();
    expect(rejected?.eval_status).toBe("rejected");
    expect(rejected?.status).toBe("accepted");
  });

  it("badges rerun_run_id matches and sorts them first", async () => {
    const entries = await fetchFixSnapshots(CONFIG, "task-1", { runId: "run-42" });
    expect(entries[0].ref_id).toBe("fix-this-run");
    expect(entries[0].fromThisRun).toBe(true);
    expect(entries.filter((e) => e.fromThisRun)).toHaveLength(1);
  });

  it("badges Stakwork project matches (unique_source_id precedence) alongside rerun matches", async () => {
    const entries = await fetchFixSnapshots(CONFIG, "task-1", {
      runId: "run-42",
      projectId: 57419,
    });
    expect(entries.slice(0, 2).map((e) => e.ref_id).sort()).toEqual([
      "fix-this-project",
      "fix-this-run",
    ]);
    expect(entries.slice(2).every((e) => e.fromThisRun === false)).toBe(true);
  });

  it("badges nothing when no run identifiers are supplied, preserving graph order", async () => {
    const entries = await fetchFixSnapshots(CONFIG, "task-1");
    expect(entries.every((e) => e.fromThisRun === false)).toBe(true);
    expect(entries.map((e) => e.ref_id)).toEqual([
      "fix-accepted",
      "fix-rejected",
      "fix-this-run",
      "fix-this-project",
    ]);
  });
});

describe("projectFix — snapshot field passthrough", () => {
  it("passes all seven snapshot fields through", () => {
    const projected = projectFix("fix-1", {
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
      fix_type: "concept",
    });
    expect(projected.target_type).toBe("concept");
    expect(projected.target_name).toBe("Limitation of Liability");
    expect(projected.target_version).toBe("3");
    expect(projected.target_ref).toBe("mock-concept-liability-001");
    expect(projected.old_value).toBe(FIX_SNAPSHOT_SHAPES.conceptEditDocs.old_value);
    expect(projected.new_value).toBe(FIX_SNAPSHOT_SHAPES.conceptEditDocs.new_value);
    expect(projected.fix_type).toBe("concept");
  });

  it("still whitelists — unexpected node properties do not leak", () => {
    const projected = projectFix("fix-1", {
      target_type: "concept",
      extra_secret_field: "must-not-be-returned",
    });
    expect("extra_secret_field" in projected).toBe(false);
    expect(projected.target_name).toBeNull();
  });
});
