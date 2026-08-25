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
  /** Row served to the anchors pass (workspace.findUnique); null skips it. */
  anchorWorkspace?: any;
}) {
  (mockedDb.workspace as any) = {
    findMany: vi.fn(async () => opts.workspaces ?? []),
    findUnique: vi.fn(async () => opts.anchorWorkspace ?? null),
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

  it("scopes the workspace query when opts.workspace is provided", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "hive", jarvisSyncState: null }] });
    await runJarvisMirror({ workspace: "hive" });
    const where = (mockedDb.workspace as any).findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ slug: "hive" }, { id: "hive" }]);
    expect(where.deleted).toBe(false);
  });

  it("does not add a workspace scope when opts.workspace is omitted", async () => {
    setupDb({ workspaces: [] });
    await runJarvisMirror();
    const where = (mockedDb.workspace as any).findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
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

  it("excludes text-less messages (artifact-only) and SENDING from the chat query", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    await runJarvisMirror();
    const where = (mockedDb.chatMessage as any).findMany.mock.calls[0][0].where;
    expect(where.message).toEqual({ not: "" });
    expect(where.status).toEqual({ not: "SENDING" });
  });

  it("keeps chat scoped to the workspace via AND, with no clobbering top-level OR", async () => {
    setupDb({ workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }] });
    await runJarvisMirror();
    const where = (mockedDb.chatMessage as any).findMany.mock.calls[0][0].where;
    // The workspace scope must live under AND — never as a bare top-level OR
    // that a spread keyset could overwrite.
    expect(where.OR).toBeUndefined();
    expect(where.AND).toEqual([
      { OR: [{ task: { workspaceId: "w1" } }, { feature: { workspaceId: "w1" } }] },
      {}, // no cursor yet
    ]);
  });

  it("REGRESSION: chat keeps the workspace filter even once a chat cursor exists", async () => {
    const cursor = { at: AT.toISOString(), id: "m0" };
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: { chat: cursor } }],
    });
    await runJarvisMirror();
    const where = (mockedDb.chatMessage as any).findMany.mock.calls[0][0].where;
    // Both the workspace scope AND the keyset cursor must be present and ANDed.
    // (Previously the cursor's `OR` overwrote the workspace `OR`, leaking every
    // workspace's chat into this one.)
    expect(where.OR).toBeUndefined();
    expect(where.AND).toEqual([
      { OR: [{ task: { workspaceId: "w1" } }, { feature: { workspaceId: "w1" } }] },
      {
        OR: [
          { updatedAt: { gt: new Date(cursor.at) } },
          { updatedAt: new Date(cursor.at), id: { gt: "m0" } },
        ],
      },
    ]);
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

  it("skips the swarm (no error) when the bulk endpoint 404s", async () => {
    mockedAddNodeBulk.mockResolvedValue({
      success: false,
      endpointMissing: true,
      errors: ["Request failed with status 404"],
    });
    setupDb({
      workspaces: [{ id: "w1", slug: "w1", jarvisSyncState: null }],
      features: [{ id: "f1", title: "F1", updatedAt: AT }],
      tasks: [{ id: "t1", title: "T1", updatedAt: AT, feature: null }],
    });

    const res = await runJarvisMirror();

    expect(res.results[0].skipped).toBe("jarvis bulk endpoint missing (404)");
    expect(res.results[0].errors).toBeUndefined();
    // Bailed on the first 404 — never attempted the task type.
    expect(mockedAddNodeBulk).toHaveBeenCalledTimes(1);
    // No cursor persisted for a skipped swarm.
    expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
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

  describe("workspace anchors (HiveWorkspace + HiveWorkspaceMember)", () => {
    const ANCHOR_WS = {
      id: "w1",
      name: "Hive",
      slug: "hive",
      description: "AI-first PM toolkit",
      mission: "harden codebases",
      createdAt: AT,
      updatedAt: AT,
      owner: {
        id: "u-owner",
        name: "Evan",
        githubAuth: { githubUsername: "evanfeenstra" },
      },
      members: [
        {
          id: "wm1",
          userId: "u2",
          role: "DEVELOPER",
          description: "backend focus",
          joinedAt: AT,
          // No display name — must fall back to the github username.
          user: { name: null, githubAuth: { githubUsername: "alice" } },
        },
      ],
    };

    it("upserts the workspace node, the owner-as-member, and member nodes with HAS_MEMBER edges", async () => {
      setupDb({
        workspaces: [{ id: "w1", slug: "hive", jarvisSyncState: null }],
        anchorWorkspace: ANCHOR_WS,
      });

      const res = await runJarvisMirror();

      expect(res.results[0].anchors).toEqual({ workspace: 1, member: 2 });

      const nodes = mockedAddNodeBulk.mock.calls[0][1] as any[];
      const wsNode = nodes.find((n) => n.node_type === "HiveWorkspace");
      expect(wsNode.node_data).toMatchObject({
        workspace_id: "w1",
        name: "Hive",
        slug: "hive",
        description: "AI-first PM toolkit",
        mission: "harden codebases",
      });

      const memberNodes = nodes.filter((n) => n.node_type === "HiveWorkspaceMember");
      expect(memberNodes).toHaveLength(2);
      // Owner has no WorkspaceMember row — keyed by their user id, role OWNER.
      expect(memberNodes[0].node_data).toMatchObject({
        member_id: "u-owner",
        user_id: "u-owner",
        name: "Evan",
        github_username: "evanfeenstra",
        role: "OWNER",
      });
      // Member display name falls back to the github username.
      expect(memberNodes[1].node_data).toMatchObject({
        member_id: "wm1",
        user_id: "u2",
        name: "alice",
        github_username: "alice",
        role: "DEVELOPER",
        description: "backend focus",
      });

      const edges = mockedAddEdgeBulk.mock.calls[0][1] as any[];
      const memberEdges = edges.filter((e) => e.edge.edge_type === "HAS_MEMBER");
      expect(memberEdges).toHaveLength(2);
      expect(memberEdges[0].source.node_data).toEqual({ workspace_id: "w1", name: "Hive" });
      expect(memberEdges[0].target.node_data).toEqual({ member_id: "u-owner", name: "Evan" });
      expect(memberEdges[1].target.node_data).toEqual({ member_id: "wm1", name: "alice" });
    });

    it("anchors never touch jarvisSyncState (full upsert, no cursor)", async () => {
      setupDb({
        workspaces: [{ id: "w1", slug: "hive", jarvisSyncState: null }],
        anchorWorkspace: ANCHOR_WS,
      });
      await runJarvisMirror();
      expect((mockedDb.workspace as any).update).not.toHaveBeenCalled();
    });

    it("reports zero anchors (with errors) when the node write fails", async () => {
      mockedAddNodeBulk.mockResolvedValue({ success: false, errors: ["node boom"] });
      setupDb({
        workspaces: [{ id: "w1", slug: "hive", jarvisSyncState: null }],
        anchorWorkspace: ANCHOR_WS,
      });
      const res = await runJarvisMirror();
      expect(res.results[0].anchors).toEqual({ workspace: 0, member: 0 });
      expect(res.results[0].errors).toContain("node boom");
    });

    it("skips the anchors pass quietly when the workspace row is gone", async () => {
      setupDb({ workspaces: [{ id: "w1", slug: "hive", jarvisSyncState: null }] });
      const res = await runJarvisMirror();
      expect(res.results[0].anchors).toEqual({ workspace: 0, member: 0 });
      expect(res.results[0].errors).toEqual([]);
    });
  });
});
