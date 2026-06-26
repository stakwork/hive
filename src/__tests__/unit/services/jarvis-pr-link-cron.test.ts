import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db");

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn(),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addEdgeBulk: vi.fn(async () => ({ success: true, errors: [] })),
  searchLatestByTypes: vi.fn(async () => []),
}));

import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addEdgeBulk, searchLatestByTypes } from "@/services/swarm/api/nodes";
import { runJarvisPrLink } from "@/services/jarvis-pr-link-cron";

const mockedDb = vi.mocked(db, true);
const mockedConfig = vi.mocked(getJarvisConfigForWorkspace);
const mockedAddEdgeBulk = vi.mocked(addEdgeBulk);
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
  mockedAddEdgeBulk.mockResolvedValue({ success: true, errors: [] });
  mockedSearch.mockResolvedValue([]);
});

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
    mockedSearch.mockResolvedValue([prNode("stakwork/hive", 4542, "ref-4542", 1782430995)]);

    const res = await runJarvisPrLink();

    // backfill: full pull
    expect(mockedSearch).toHaveBeenCalledWith(CFG, { PullRequest: 100_000 }, { withProperties: true });

    const edgeArg = mockedAddEdgeBulk.mock.calls[0][1];
    expect(edgeArg).toHaveLength(1);
    expect(edgeArg[0].target).toEqual({ ref_id: "ref-4542" });
    expect((edgeArg[0].source as { node_data: unknown }).node_data).toEqual({
      task_id: "t1",
      name: "T1",
    });

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
    mockedSearch.mockResolvedValue([prNode("stakwork/hive", 4542, "ref-4542", 1782430995)]);

    const res = await runJarvisPrLink();

    // No edge, and the task is NOT marked — it retries next run.
    expect(mockedAddEdgeBulk).not.toHaveBeenCalled();
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
    mockedSearch.mockResolvedValue([
      prNode("stakwork/hive", 4542, "ref-4542", 1782430995),
      prNode("stakwork/hive", 4000, "ref-old", 1781000000),
    ]);

    await runJarvisPrLink();

    expect(mockedSearch).toHaveBeenCalledWith(CFG, { PullRequest: 2_000 }, { withProperties: true });
  });

  it("marks tasks with an unparseable PR url as linked so they stop being scanned", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [{ id: "t1", title: "T1", chatMessages: [prArtifact("not-a-pr-url")] }],
    });

    const res = await runJarvisPrLink();

    expect(mockedAddEdgeBulk).not.toHaveBeenCalled();
    expect((mockedDb.task as any).updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      data: { jarvisPrLinkedAt: expect.any(Date) },
    });
    expect(res.results[0].linked).toBe(1);
  });

  it("self-chains (capped) only when the batch is full AND progress was made", async () => {
    const tasks = Array.from({ length: 2 }, (_, i) => ({
      id: `t${i}`,
      title: `T${i}`,
      chatMessages: [prArtifact(`https://github.com/stakwork/hive/pull/${4000 + i}`)],
    }));
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }], tasks });
    mockedSearch.mockResolvedValue([
      prNode("stakwork/hive", 4000, "r0", 1782430000),
      prNode("stakwork/hive", 4001, "r1", 1782430995),
    ]);

    const res = await runJarvisPrLink({ maxPerRun: 2 });

    expect(res.anyCapped).toBe(true);
    expect(res.results[0].capped).toBe(true);
    // high-water NOT advanced while capped/backfilling
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
  });
});
