/**
 * Unit tests for `services/strut-jobs/pod-note.ts` — the no-pods note a job's
 * prompt carries for a named workspace with no pod pool.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { workspace: { findMany: mockFindMany } } }));

import { withNoPodsNote } from "@/services/strut-jobs/pod-note";

const READY = { poolApiKey: "k", poolState: "COMPLETE", poolName: "pool" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withNoPodsNote", () => {
  it("appends the note after the user's words for a workspace with no swarm", async () => {
    mockFindMany.mockResolvedValue([{ slug: "peel-4", swarm: null }]);
    const out = await withNoPodsNote("Fix the typo in @peel-4");
    expect(out.startsWith("Fix the typo in @peel-4\n\n")).toBe(true);
    expect(out).toContain("[hive] Workspace @peel-4 has no pods");
    expect(out).toContain("not built or tested");
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { slug: { in: ["peel-4"] }, deleted: false },
      select: { slug: true, swarm: { select: { poolApiKey: true, poolState: true, poolName: true } } },
    });
  });

  it("treats a missing key or an unfinished pool as pod-less", async () => {
    mockFindMany.mockResolvedValue([
      { slug: "a", swarm: { ...READY, poolApiKey: null } },
      { slug: "b", swarm: { ...READY, poolState: "STARTED" } },
    ]);
    const out = await withNoPodsNote("@a and @b");
    expect(out).toContain("Workspace @a has no pods");
    expect(out).toContain("Workspace @b has no pods");
  });

  it("adds nothing for a workspace with a COMPLETE pool and a key", async () => {
    mockFindMany.mockResolvedValue([{ slug: "hive", swarm: READY }]);
    expect(await withNoPodsNote("Change @hive")).toBe("Change @hive");
  });

  it("does not query without @slug mentions", async () => {
    expect(await withNoPodsNote("no mentions, a@b.com")).toBe("no mentions, a@b.com");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("does not append twice", async () => {
    mockFindMany.mockResolvedValue([{ slug: "peel-4", swarm: null }]);
    const once = await withNoPodsNote("Fix @peel-4");
    expect(await withNoPodsNote(once)).toBe(once);
  });

  it("sends the prompt unchanged when the lookup throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    expect(await withNoPodsNote("Fix @peel-4")).toBe("Fix @peel-4");
  });
});
