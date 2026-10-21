import { describe, test, expect, vi, beforeEach } from "vitest";
import { resetMockInitiativeStore } from "@/app/api/mock/graph/initiative-fixture";
import { getInitiativeTree } from "@/services/graph/workbench";
import { saveInitiativeChanges } from "@/services/graph/initiative-write";

vi.mock("@/lib/db", () => ({
  db: { workspace: { findFirst: vi.fn().mockResolvedValue({ sourceControlOrgId: "org-1" }) } },
}));

const caller = { slug: "ws", userId: "u1" };

beforeEach(() => {
  vi.stubEnv("USE_MOCKS", "true");
  resetMockInitiativeStore();
});

describe("mock mode: a save reads back", () => {
  test("edits and new cards on the fixture initiative", async () => {
    const saved = await saveInitiativeChanges(caller, {
      root: "mock-initiative-1",
      ops: [
        { op: "edit", ref: "mock-initiative-1", fields: { name: "Renamed" } },
        { op: "add", temp: "m", type: "HiveMilestone", parent: "mock-initiative-1", fields: { name: "Launch" } },
      ],
    });
    expect(saved.ok).toBe(true);
    const tree = await getInitiativeTree(caller, "mock-initiative-1");
    if (!tree.ok) throw new Error(tree.message);
    expect(tree.data.nodes[0].properties.name).toBe("Renamed");
    expect(tree.data.stage.milestones).toBe(3);
    expect(tree.data.nodes.find((n) => n.properties.name === "Launch")?.properties.created_by).toBe("u1");
    // Another initiative doesn't see this one's saves.
    expect(await getInitiativeTree(caller, "mock-initiative-2")).toMatchObject({
      ok: true,
      data: { stage: { milestones: 2 } },
    });
  });

  test("a new initiative is its own tree", async () => {
    const saved = await saveInitiativeChanges(caller, {
      root: null,
      ops: [
        { op: "add", temp: "i", type: "HiveInitiative", parent: null, fields: { name: "Fresh" } },
        { op: "add", temp: "b", type: "Brief", parent: "i", fields: { text: "Why" } },
      ],
    });
    if (!saved.ok) throw new Error(saved.message);
    const tree = await getInitiativeTree(caller, saved.data.root);
    if (!tree.ok) throw new Error(tree.message);
    expect(tree.data.nodes.map((n) => n.type)).toEqual(["HiveInitiative", "Brief"]);
  });
});
