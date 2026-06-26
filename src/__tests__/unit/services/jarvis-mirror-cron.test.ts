import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db");

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn(),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNodeBulk: vi.fn(async () => ({ success: true, errors: [] })),
  addEdgeBulk: vi.fn(async () => ({ success: true, errors: [] })),
}));

import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addNodeBulk, addEdgeBulk } from "@/services/swarm/api/nodes";
import { runJarvisMirror } from "@/services/jarvis-mirror-cron";

const mockedDb = vi.mocked(db, true);
const mockedConfig = vi.mocked(getJarvisConfigForWorkspace);
const mockedAddNodeBulk = vi.mocked(addNodeBulk);
const mockedAddEdgeBulk = vi.mocked(addEdgeBulk);

const CFG = { jarvisUrl: "https://sw.sphinx.chat:8444", apiKey: "key" };

function setupDb(opts: {
  workspaces?: any[];
  features?: any[];
  tasks?: any[];
  messages?: any[];
}) {
  (mockedDb.workspace as any) = {
    findMany: vi.fn(async () => opts.workspaces ?? []),
    update: vi.fn(async () => ({})),
  };
  (mockedDb.feature as any) = { findMany: vi.fn(async () => opts.features ?? []) };
  (mockedDb.task as any) = { findMany: vi.fn(async () => opts.tasks ?? []) };
  (mockedDb.chatMessage as any) = { findMany: vi.fn(async () => opts.messages ?? []) };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.USE_MOCKS;
  mockedConfig.mockResolvedValue(CFG as any);
  mockedAddNodeBulk.mockResolvedValue({ success: true, errors: [] });
  mockedAddEdgeBulk.mockResolvedValue({ success: true, errors: [] });
});

const AT = new Date("2026-01-02T03:04:05.000Z");

describe("runJarvisMirror", () => {
  it("skips entirely when USE_MOCKS is set", async () => {
    process.env.USE_MOCKS = "true";
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    const res = await runJarvisMirror();
    expect(res.processed).toBe(0);
    expect(mockedAddNodeBulk).not.toHaveBeenCalled();
  });

  it("skips workspaces without a jarvis config", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    mockedConfig.mockResolvedValue(null);
    const res = await runJarvisMirror();
    expect(res.results[0].skipped).toBe("no jarvis config");
    expect(mockedAddNodeBulk).not.toHaveBeenCalled();
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
  });

  it("mirrors features/tasks/messages and advances the cursor", async () => {
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      features: [{ id: "f1", title: "F1", updatedAt: AT }],
      tasks: [{ id: "t1", title: "T1", updatedAt: AT, feature: { id: "f1", title: "F1" } }],
      messages: [
        { id: "m1", message: "hi", role: "USER", updatedAt: AT, task: { id: "t1", title: "T1" }, feature: null },
      ],
    });

    const res = await runJarvisMirror();

    expect(mockedAddNodeBulk).toHaveBeenCalledTimes(3); // feature, task, chat
    expect(mockedAddEdgeBulk).toHaveBeenCalledTimes(2); // task->feature, msg->task
    expect(res.results[0].counts).toEqual({ feature: 1, task: 1, chat: 1 });

    const updateArg = (mockedDb.workspace as any).update.mock.calls[0][0];
    expect(updateArg.data.jarvisSyncState.feature).toEqual({ at: AT.toISOString(), id: "f1" });
    expect(updateArg.data.jarvisSyncState.task).toEqual({ at: AT.toISOString(), id: "t1" });
    expect(updateArg.data.jarvisSyncState.chat).toEqual({ at: AT.toISOString(), id: "m1" });
  });

  it("does not write the cursor when nothing changed", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    await runJarvisMirror();
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
  });

  it("reports capped=true and anyCapped when a batch fills maxPerType", async () => {
    const features = Array.from({ length: 2 }, (_, i) => ({
      id: `f${i}`,
      title: `F${i}`,
      updatedAt: new Date(AT.getTime() + i),
    }));
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }], features });

    const res = await runJarvisMirror({ maxPerType: 2 });
    expect(res.anyCapped).toBe(true);
    expect(res.results[0].capped).toBe(true);
  });

  it("does NOT advance the cursor when the node write fails", async () => {
    mockedAddNodeBulk.mockResolvedValue({
      success: false,
      errors: ["Error processing node: Not a valid node_type"],
    });
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      features: [{ id: "f1", title: "F1", updatedAt: AT }],
    });

    const res = await runJarvisMirror();

    // Write failed → cursor stays put so the row is retried next run.
    expect(res.results[0].counts?.feature).toBe(0);
    expect(res.results[0].errors?.length).toBeGreaterThan(0);
    // Nothing advanced → no cursor persisted.
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
  });

  it("does NOT advance the task cursor when the edge write fails", async () => {
    mockedAddEdgeBulk.mockResolvedValue({ success: false, errors: ["edge boom"] });
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      tasks: [{ id: "t1", title: "T1", updatedAt: AT, feature: { id: "f1", title: "F1" } }],
    });

    const res = await runJarvisMirror();
    expect(res.results[0].counts?.task).toBe(0);
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
  });

  it("passes the stored keyset cursor into the feature query", async () => {
    const cursor = { at: AT.toISOString(), id: "f0" };
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: { feature: cursor } }],
    });
    await runJarvisMirror();
    const where = (mockedDb.feature as any).findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { updatedAt: { gt: new Date(cursor.at) } },
      { updatedAt: new Date(cursor.at), id: { gt: "f0" } },
    ]);
  });

  it("continues to other workspaces when one throws", async () => {
    setupDb({
      workspaces: [
        { id: "w1", slug: "w1", jarvisSyncState: null },
        { id: "w2", slug: "w2", jarvisSyncState: null },
        { id: "w3", slug: "w3", jarvisSyncState: null },
      ],
      features: [{ id: "f1", title: "F1", updatedAt: AT }],
    });
    mockedConfig.mockResolvedValueOnce(CFG as any); // w1 ok
    mockedConfig.mockRejectedValueOnce(new Error("boom")); // w2 throws
    mockedConfig.mockResolvedValueOnce(CFG as any); // w3 ok

    const res = await runJarvisMirror();
    expect(res.processed).toBe(3);
    expect(res.results[1].errors?.[0]).toContain("boom");
    expect(res.results[2].counts?.feature).toBe(1);
  });
});
