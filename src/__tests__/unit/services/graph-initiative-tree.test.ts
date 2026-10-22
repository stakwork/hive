import { describe, test, expect, vi, beforeEach } from "vitest";
import { runWorkspaceGraphQuery } from "@/services/graph/query";
import {
  getInitiativeTree,
  initiativeStage,
  listInitiatives,
  stageLine,
  type InitiativeTreeNode,
} from "@/services/graph/workbench";

vi.mock("@/services/graph/query", () => ({ runWorkspaceGraphQuery: vi.fn() }));

const mockedQuery = vi.mocked(runWorkspaceGraphQuery);
const caller = { slug: "ws", userId: "user-1" };
const meta = { requestedLimit: 1000, limitRewritten: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USE_MOCKS", "false");
});

const node = (type: InitiativeTreeNode["type"], status?: string): InitiativeTreeNode => ({
  ref_id: `${type}-${status ?? "x"}`,
  type,
  properties: status ? { status } : {},
});

describe("initiativeStage / stageLine", () => {
  test("counts each level and requirements neither accepted nor dropped", () => {
    const stage = initiativeStage([
      node("HiveInitiative"),
      node("HiveMilestone"),
      node("InitiativeFeature"),
      node("InitiativeFeature"),
      node("UserStory"),
      node("Requirement", "accepted"),
      node("Requirement", "proposed"),
      node("Requirement", "dropped"),
      node("Requirement"),
    ]);
    expect(stage).toEqual({ milestones: 1, features: 2, stories: 1, requirements: 4, unaccepted: 2 });
    expect(stageLine(stage)).toBe("1 milestone · 2 features · 4 requirements, 2 unaccepted");
  });

  test("an empty initiative, and requirements all accepted", () => {
    expect(stageLine(initiativeStage([node("HiveInitiative")]))).toBe("Nothing planned yet");
    expect(stageLine({ milestones: 0, features: 0, stories: 0, requirements: 3, unaccepted: 0 })).toBe(
      "3 requirements",
    );
  });
});

describe("getInitiativeTree", () => {
  test("rejects a ref_id that could break out of the Cypher string", async () => {
    expect(await getInitiativeTree(caller, "x' OR 1=1")).toMatchObject({ ok: false, status: 400 });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("queries the plan from the focus, by label, live paths only, with brainstorms and choices per node", async () => {
    mockedQuery.mockResolvedValue({ ok: true, meta, data: { columns: [], rows: [] } });
    await getInitiativeTree(caller, "init-1");
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    for (const [{ query }] of mockedQuery.mock.calls) {
      const q = String(query);
      expect(q).toContain("MATCH (r:Data_Bank {ref_id: 'init-1'})");
      expect(q).toContain("`HAS_BRIEF`|`HAS_STORY`|`HAS_REQUIREMENT`|`HAS_MILESTONE`|`HAS_FEATURE`|`HAS_ARCHITECTURE`");
      expect(q).toContain("all(x IN nodes(p) WHERE x.deleted_at IS NULL");
      expect(q).toContain("all(e IN relationships(p) WHERE coalesce(e.is_muted, false) = false");
      expect(q).toContain(":`Requirement`");
      expect(q).not.toContain("HiveTask");
      expect(q).toContain(":`Architecture`");
      expect(q).not.toContain("node_type");
    }
    const nodesQuery = String(mockedQuery.mock.calls.find(([a]) => String(a.query).includes("AS props"))![0].query);
    expect(nodesQuery).not.toContain("INCLUDES");
    expect(nodesQuery).not.toContain("PullRequest");
    expect(nodesQuery).toContain("(o:`Option`)-[ro:RESULTED_IN]->");
  });

  test("reads the brainstorms about each node and the answers that made it", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        ok: true,
        meta,
        data: {
          columns: ["id", "labels", "props", "brainstorms", "made_by"],
          rows: [
            ["req-1", ["Requirement"], [["text", "R"]], [], []],
            ["f-1", ["InitiativeFeature"], [["name", "F"]], ["q-1"], ["o-1"]],
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, meta, data: { columns: ["type", "target", "source"], rows: [] } });
    const res = await getInitiativeTree(caller, "init-1");
    if (!res.ok) throw new Error(res.message);
    const by = Object.fromEntries(res.data.nodes.map((n) => [n.ref_id, n]));
    expect(by["f-1"]).toMatchObject({ brainstorms: ["q-1"], madeBy: ["o-1"] });
  });

  test("parses nodes by label and edges by type, and computes the stage", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        ok: true,
        meta,
        data: {
          columns: ["props", "labels", "id"],
          rows: [
            [[["name", "Onboarding"]], ["Data_Bank", "HiveInitiative"], "init-1"],
            [[["status", "proposed"]], ["Data_Bank", "Requirement"], "req-1"],
            [[], ["Data_Bank", "Other"], "stray"],
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        meta,
        data: { columns: ["type", "target", "source"], rows: [["HAS_REQUIREMENT", "req-1", "story-1"]] },
      });
    const res = await getInitiativeTree(caller, "init-1");
    expect(res).toEqual({
      ok: true,
      data: {
        nodes: [
          { ref_id: "init-1", type: "HiveInitiative", properties: { name: "Onboarding" } },
          { ref_id: "req-1", type: "Requirement", properties: { status: "proposed" } },
        ],
        edges: [{ source: "story-1", target: "req-1", type: "HAS_REQUIREMENT" }],
        stage: { milestones: 0, features: 0, stories: 0, requirements: 1, unaccepted: 1 },
        truncated: false,
      },
    });
  });

  test("passes an upstream failure through", async () => {
    mockedQuery.mockResolvedValue({ ok: false, status: 502, message: "down" });
    expect(await getInitiativeTree(caller, "init-1")).toEqual({ ok: false, status: 502, message: "down" });
  });

  test("USE_MOCKS: a planned initiative rooted at the asked ref_id, every edge between its nodes", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    const res = await getInitiativeTree(caller, "mock-initiative-onboarding");
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nodes[0]).toMatchObject({ ref_id: "mock-initiative-onboarding", type: "HiveInitiative" });
    expect(res.data.stage).toEqual({ milestones: 3, features: 4, stories: 5, requirements: 12, unaccepted: 4 });
    expect(res.data.nodes.filter((n) => n.type === "Architecture")).toHaveLength(2);
    const ids = new Set(res.data.nodes.map((n) => n.ref_id));
    expect(res.data.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});

describe("listInitiatives", () => {
  test("most recently updated first, falling back to when it was made; capped", async () => {
    mockedQuery.mockResolvedValue({
      ok: true,
      meta,
      data: {
        columns: [
          "id",
          "name",
          "status",
          "created_at",
          "added",
          "updated_at",
          "created_by",
          "created_by_kind",
          "assignee_id",
        ],
        rows: [
          ["old", "Old", "ACTIVE", "2026-01-01T00:00:00Z", null, null, "u1", "human", null],
          ["graph-ms", "In graph (ms)", null, null, Date.parse("2026-06-01T00:00:00Z"), null, null, null, null],
          ["graph-s", "In graph (s)", null, null, Date.parse("2026-05-01T00:00:00Z") / 1000, null, null, null, null],
          ["updated", "Updated only", null, null, null, "2026-03-01T00:00:00Z", null, null, null],
          ["new", "New", "DRAFT", "2026-10-01T00:00:00Z", null, null, "strut", "strut", "u2"],
        ],
      },
    });
    const res = await listInitiatives(caller, 4);
    expect(res.ok && res.data.initiatives.map((i) => i.ref_id)).toEqual(["new", "graph-ms", "graph-s", "updated"]);
    expect(res.ok && res.data.initiatives[0]).toMatchObject({
      name: "New",
      created_by_kind: "strut",
      assignee_id: "u2",
    });
    const q = String(mockedQuery.mock.calls[0][0].query);
    expect(q).toContain("MATCH (n:`HiveInitiative`) WHERE n.deleted_at IS NULL");
    expect(q).not.toContain("node_type");
  });

  test("updated_at in any format (ISO, epoch ms, legacy float seconds, numeric strings, missing) orders the same", async () => {
    const t = (iso: string) => Date.parse(iso);
    const c = "2026-01-01T00:00:00Z";
    mockedQuery.mockResolvedValue({
      ok: true,
      meta,
      data: {
        columns: [
          "id",
          "name",
          "status",
          "created_at",
          "added",
          "updated_at",
          "created_by",
          "created_by_kind",
          "assignee_id",
        ],
        rows: [
          ["iso", "Iso", null, c, null, "2026-02-01T00:00:00Z", null, null, null],
          ["ms", "Ms", null, c, null, t("2026-05-01T00:00:00Z"), null, null, null],
          ["sec", "Sec", null, c, null, t("2026-04-01T00:00:00Z") / 1000 + 0.5, null, null, null],
          ["msstr", "Msstr", null, c, null, String(t("2026-03-01T00:00:00Z")), null, null, null],
          ["secstr", "Secstr", null, c, null, String(t("2026-06-01T00:00:00Z") / 1000), null, null, null],
          ["missing", "Missing", null, "2026-01-15T00:00:00Z", null, null, null, null, null],
          ["junk", "Junk", null, "2026-01-10T00:00:00Z", null, "not a date", null, null, null],
        ],
      },
    });
    const res = await listInitiatives(caller, 10);
    const list = res.ok ? res.data.initiatives : [];
    expect(list.map((i) => i.ref_id)).toEqual(["secstr", "ms", "sec", "msstr", "iso", "missing", "junk"]);
    expect(list.find((i) => i.ref_id === "ms")?.updated_at).toBe(t("2026-05-01T00:00:00Z"));
    expect(list.find((i) => i.ref_id === "missing")?.updated_at).toBe(t("2026-01-15T00:00:00Z"));
  });

  test("the graph's own stamp beats a date a model wrote: a new initiative is new, a future date is now", async () => {
    const added = Date.now() - 60_000;
    mockedQuery.mockResolvedValue({
      ok: true,
      meta,
      data: {
        columns: [
          "id",
          "name",
          "status",
          "created_at",
          "added",
          "updated_at",
          "created_by",
          "created_by_kind",
          "assignee_id",
        ],
        rows: [
          [
            "older",
            "Edited last month",
            null,
            null,
            Date.now() - 40 * 86_400_000,
            new Date(Date.now() - 30 * 86_400_000).toISOString(),
            null,
            null,
            null,
          ],
          // strut's model wrote a year-old date; the node reached the graph a minute ago.
          [
            "fresh",
            "infinite canvas",
            "draft",
            "2025-10-22T08:16:00Z",
            added / 1000,
            "2025-10-22T08:16:00Z",
            null,
            "jamie",
            null,
          ],
          [
            "future",
            "From the future",
            null,
            null,
            Date.now() - 50 * 86_400_000,
            "2099-01-01T00:00:00Z",
            null,
            null,
            null,
          ],
        ],
      },
    });
    const res = await listInitiatives(caller, 5);
    if (!res.ok) throw new Error(res.message);
    expect(res.data.initiatives.map((i) => i.ref_id)).toEqual(["future", "fresh", "older"]);
    const fresh = res.data.initiatives.find((i) => i.ref_id === "fresh")!;
    expect(fresh.created_at).toBe(added);
    expect(fresh.updated_at).toBe(added);
    // Capped at now, not 2099.
    expect(res.data.initiatives[0].updated_at!).toBeLessThanOrEqual(Date.now());
  });

  test("USE_MOCKS: the fixture's, most recently updated first, capped", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    const res = await listInitiatives(caller, 50);
    expect(res.ok && res.data.initiatives.map((i) => i.ref_id).slice(0, 3)).toEqual([
      "mock-initiative-onboarding",
      "mock-initiative-janitor",
      "mock-initiative-voice",
    ]);
    expect(res.ok && res.data.initiatives).toHaveLength(7);
    const two = await listInitiatives(caller, 2);
    expect(two.ok && two.data.initiatives).toHaveLength(2);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
