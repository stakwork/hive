import { describe, test, expect, vi, beforeEach } from "vitest";
import { runWorkspaceGraphQuery } from "@/services/graph/query";
import { getInitiativeTree, initiativeStage, stageLine, type InitiativeTreeNode } from "@/services/graph/workbench";

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

  test("queries the planning chain from the focus, by label, live paths only", async () => {
    mockedQuery.mockResolvedValue({ ok: true, meta, data: { columns: [], rows: [] } });
    await getInitiativeTree(caller, "init-1");
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    for (const [{ query }] of mockedQuery.mock.calls) {
      const q = String(query);
      expect(q).toContain("MATCH (r:Data_Bank {ref_id: 'init-1'})");
      expect(q).toContain("`HAS_MILESTONE`|`HAS_BRIEF`|`HAS_FEATURE`|`HAS_STORY`|`HAS_REQUIREMENT`");
      expect(q).toContain("all(x IN nodes(p) WHERE x.deleted_at IS NULL");
      expect(q).toContain("all(e IN relationships(p) WHERE coalesce(e.is_muted, false) = false");
      expect(q).toContain(":`Requirement`");
      expect(q).not.toContain("node_type");
    }
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
    const res = await getInitiativeTree(caller, "mock-initiative-1");
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nodes[0]).toMatchObject({ ref_id: "mock-initiative-1", type: "HiveInitiative" });
    expect(res.data.stage).toEqual({ milestones: 2, features: 3, stories: 3, requirements: 7, unaccepted: 3 });
    const ids = new Set(res.data.nodes.map((n) => n.ref_id));
    expect(res.data.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});
