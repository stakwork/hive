import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db");

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn(),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addEdgeByRefBulk: vi.fn(async () => ({ success: true, errors: [] })),
  searchLatestByTypes: vi.fn(async () => ({ ok: true, nodes: [] })),
}));

import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addEdgeByRefBulk, searchLatestByTypes } from "@/services/swarm/api/nodes";
import { runJarvisPrLink } from "@/services/jarvis-pr-link-cron";

const mockedDb = vi.mocked(db, true);
const mockedConfig = vi.mocked(getJarvisConfigForWorkspace);
const mockedAddEdge = vi.mocked(addEdgeByRefBulk);
const mockedSearch = vi.mocked(searchLatestByTypes);

const CFG = { jarvisUrl: "https://sw.sphinx.chat:8444", apiKey: "key" };

const prArtifact = (url: string) => ({ artifacts: [{ content: { url } }] });

function prNode(repo: string, number: number, ref_id: string, dateSec: number) {
  return {
    ref_id,
    node_type: "PullRequest",
    date_added_to_graph: dateSec,
    properties: { repo, number },
  };
}

function taskNode(taskId: string, ref_id: string) {
  return { ref_id, node_type: "Hivetask", date_added_to_graph: 0, properties: { task_id: taskId } };
}

/**
 * The cron now calls searchLatestByTypes twice per workspace: once for
 * `PullRequest` nodes and once for `Hivetask` nodes (to resolve task ref_ids).
 * Dispatch on the requested node type so each call gets the right payload.
 */
function mockSearch(
  prResult: { ok: boolean; nodes: any[]; status?: number; endpointMissing?: boolean; error?: string },
  taskNodes: ReturnType<typeof taskNode>[] = [],
) {
  mockedSearch.mockImplementation(async (_cfg: any, nodeTypes: any) => {
    if ("PullRequest" in nodeTypes) return prResult as any;
    if ("Hivetask" in nodeTypes) return { ok: true, nodes: taskNodes } as any;
    return { ok: true, nodes: [] } as any;
  });
}

function setupDb(opts: { workspaces?: any[]; tasks?: any[] }) {
  (mockedDb.workspace as any) = {
    findMany: vi.fn(async () => opts.workspaces ?? []),
    update: vi.fn(async () => ({})),
  };
  (mockedDb.task as any) = {
    findMany: vi.fn(async () => opts.tasks ?? []),
    updateMany: vi.fn(async () => ({ count: (opts.tasks ?? []).length })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.USE_MOCKS;
  mockedConfig.mockResolvedValue(CFG as any);
  mockedAddEdge.mockResolvedValue({ success: true, errors: [] });
  mockedSearch.mockResolvedValue({ ok: true, nodes: [] });
});

// Wrap PR nodes in the SearchLatestResult envelope the function now returns.
const found = (...nodes: ReturnType<typeof prNode>[]) => ({ ok: true as const, nodes });

describe("runJarvisPrLink", () => {
  it("skips entirely when USE_MOCKS is set", async () => {
    process.env.USE_MOCKS = "true";
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    const res = await runJarvisPrLink();
    expect(res.processed).toBe(0);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("skips workspaces without a jarvis config", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    mockedConfig.mockResolvedValue(null);
    const res = await runJarvisPrLink();
    expect(res.results[0].skipped).toBe("no jarvis config");
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("does not fetch PRs when a workspace has no unlinked tasks", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }], tasks: [] });
    const res = await runJarvisPrLink();
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(res.results[0].linked).toBe(0);
  });

  it("links a task to its PR node by ref_id and advances the high-water (backfill)", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [
        { id: "t1", title: "T1", chatMessages: [prArtifact("https://github.com/stakwork/hive/pull/4542")] },
      ],
    });
    mockSearch(found(prNode("stakwork/hive", 4542, "ref-4542", 1782430995)), [taskNode("t1", "tref-1")]);

    const res = await runJarvisPrLink();

    // backfill: full pull (with a generous timeout so it isn't aborted)
    expect(mockedSearch).toHaveBeenCalledWith(CFG, { PullRequest: 100_000 }, {
      withProperties: true,
      timeoutMs: expect.any(Number),
    });
    // task ref_ids are resolved via a full HiveTask pull
    expect(mockedSearch).toHaveBeenCalledWith(CFG, { Hivetask: 100_000 }, {
      withProperties: true,
      timeoutMs: expect.any(Number),
    });

    const edgeArg = mockedAddEdge.mock.calls[0][1];
    expect(edgeArg).toHaveLength(1);
    expect(edgeArg[0]).toMatchObject({ source_ref_id: "tref-1", target_ref_id: "ref-4542" });

    expect((mockedDb.task as any).updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      data: { jarvisPrLinkedAt: expect.any(Date) },
    });

    const wsUpdate = (mockedDb.workspace as any).update.mock.calls[0][0];
    expect(wsUpdate.data.jarvisSyncState.prLink.highWater).toBe(
      new Date(1782430995 * 1000).toISOString(),
    );
    expect(res.results[0].linked).toBe(1);
  });

  it("leaves a task unlinked when its PR node is not yet ingested (pending retry)", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [
        { id: "t1", title: "T1", chatMessages: [prArtifact("https://github.com/stakwork/hive/pull/9999")] },
      ],
    });
    mockSearch(found(prNode("stakwork/hive", 4542, "ref-4542", 1782430995)), [taskNode("t1", "tref-1")]);

    const res = await runJarvisPrLink();

    // No edge, and the task is NOT marked — it retries next run.
    expect(mockedAddEdge).not.toHaveBeenCalled();
    expect((mockedDb.task as any).updateMany).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ linked: 0, pending: 1 });
    // Backfill coverage was complete (uncapped full pull), so the high-water
    // still advances; PR #9999 will arrive newer and be caught incrementally.
    const wsUpdate = (mockedDb.workspace as any).update.mock.calls[0][0];
    expect(wsUpdate.data.jarvisSyncState.prLink.highWater).toBe(
      new Date(1782430995 * 1000).toISOString(),
    );
  });

  it("uses an incremental fetch when a high-water exists", async () => {
    setupDb({
      workspaces: [
        {
          id: "w1",
          slug: "w1",
          jarvisSyncState: { prLink: { highWater: new Date(1782000000 * 1000).toISOString() } },
        },
      ],
      tasks: [
        { id: "t1", title: "T1", chatMessages: [prArtifact("https://github.com/stakwork/hive/pull/4542")] },
      ],
    });
    // Newest node is above the high-water, oldest returned is below it ⇒ boundary reached.
    mockSearch(
      found(
        prNode("stakwork/hive", 4542, "ref-4542", 1782430995),
        prNode("stakwork/hive", 4000, "ref-old", 1781000000),
      ),
      [taskNode("t1", "tref-1")],
    );

    await runJarvisPrLink();

    expect(mockedSearch).toHaveBeenCalledWith(CFG, { PullRequest: 2_000 }, {
      withProperties: true,
      timeoutMs: expect.any(Number),
    });
  });

  it("marks tasks with an unparseable PR url as linked so they stop being scanned", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [{ id: "t1", title: "T1", chatMessages: [prArtifact("not-a-pr-url")] }],
    });

    const res = await runJarvisPrLink();

    expect(mockedAddEdge).not.toHaveBeenCalled();
    expect((mockedDb.task as any).updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      data: { jarvisPrLinkedAt: expect.any(Date) },
    });
    expect(res.results[0].linked).toBe(1);
  });

  it("surfaces a transient PR-fetch failure and leaves tasks unmarked (retry)", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [
        { id: "t1", title: "T1", chatMessages: [prArtifact("https://github.com/stakwork/hive/pull/4542")] },
      ],
    });
    mockedSearch.mockResolvedValue({
      ok: false,
      nodes: [],
      status: 408,
      error: "Request failed with status 408",
    });

    const res = await runJarvisPrLink();

    expect(mockedAddEdge).not.toHaveBeenCalled();
    expect((mockedDb.task as any).updateMany).not.toHaveBeenCalled();
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ linked: 0, pending: 1 });
    expect(res.results[0].errors?.[0]).toContain("PR fetch failed");
  });

  it("skips the workspace quietly when the search endpoint 404s", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [
        { id: "t1", title: "T1", chatMessages: [prArtifact("https://github.com/stakwork/hive/pull/4542")] },
      ],
    });
    mockedSearch.mockResolvedValue({ ok: false, nodes: [], status: 404, endpointMissing: true });

    const res = await runJarvisPrLink();

    expect(res.results[0].skipped).toBe("jarvis search endpoint missing (404)");
    expect(res.results[0].errors).toBeUndefined();
    expect(mockedAddEdge).not.toHaveBeenCalled();
    expect((mockedDb.task as any).updateMany).not.toHaveBeenCalled();
  });

  it("skips the workspace quietly when the edge endpoint 404s", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [
        { id: "t1", title: "T1", chatMessages: [prArtifact("https://github.com/stakwork/hive/pull/4542")] },
      ],
    });
    mockSearch(found(prNode("stakwork/hive", 4542, "ref-4542", 1782430995)), [taskNode("t1", "tref-1")]);
    mockedAddEdge.mockResolvedValue({ success: false, endpointMissing: true, errors: ["404"] });

    const res = await runJarvisPrLink();

    expect(res.results[0].skipped).toBe("jarvis edge endpoint missing (404)");
    expect((mockedDb.task as any).updateMany).not.toHaveBeenCalled();
  });

  it("self-chains (capped) only when the batch is full AND progress was made", async () => {
    const tasks = Array.from({ length: 2 }, (_, i) => ({
      id: `t${i}`,
      title: `T${i}`,
      chatMessages: [prArtifact(`https://github.com/stakwork/hive/pull/${4000 + i}`)],
    }));
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }], tasks });
    mockSearch(
      found(
        prNode("stakwork/hive", 4000, "r0", 1782430000),
        prNode("stakwork/hive", 4001, "r1", 1782430995),
      ),
      [taskNode("t0", "tref-0"), taskNode("t1", "tref-1")],
    );

    const res = await runJarvisPrLink({ maxPerRun: 2 });

    expect(res.anyCapped).toBe(true);
    expect(res.results[0].capped).toBe(true);
    // high-water NOT advanced while capped/backfilling
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
  });
});
