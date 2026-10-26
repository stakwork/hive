import { describe, expect, it } from "vitest";
import { mockChoiceTree } from "@/app/api/mock/graph/workbench-fixture";
import { mockInitiativeTree } from "@/app/api/mock/graph/initiative-fixture";
import {
  bestMatch,
  brainstormsOn,
  byId,
  followUpTo,
  IMPLEMENT,
  initiativeOf,
  initiativesByRecency,
  kids,
  milestoneNumber,
  SYNC,
  nearestContainer,
  pips,
  suggestions,
  textField,
  toBoard,
  type InitiativeEntry,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import { initiativeStage, type InitiativeSummary, type InitiativeTreeData } from "@/services/graph/workbench";

const summary = (ref_id: string, name: string, updated_at: number | null = null): InitiativeSummary => ({
  ref_id,
  name,
  status: null,
  created_at: null,
  updated_at,
  created_by: null,
  created_by_kind: "human",
  assignee_id: null,
});
const tree = (id: string): InitiativeTreeData => {
  const t = mockInitiativeTree(id);
  return { ...t, stage: initiativeStage(t.nodes), truncated: false };
};
const ONB = "mock-initiative-onboarding";
const SIGNUP = "mock-m-signup";
const entries: InitiativeEntry[] = [
  { summary: summary(ONB, "Self-serve onboarding", 3), ws: "ws", tree: tree(ONB) },
  {
    summary: summary("mock-initiative-janitor", "Janitor insights v2", 2),
    ws: "ws",
    tree: tree("mock-initiative-janitor"),
  },
  { summary: summary("mock-initiative-mobile", "Mobile review app", 1), ws: "ws" },
];
const board = toBoard(entries, {
  "mock-brainstorm-auth": mockChoiceTree("mock-brainstorm-auth"),
  "mock-brainstorm-repo": mockChoiceTree("mock-brainstorm-repo"),
});

describe("toBoard", () => {
  it("hangs the problem off the initiative and the solution off its milestones", () => {
    expect(byId(board, ONB)).toMatchObject({ type: "initiative", name: "Self-serve onboarding", updatedAt: 3 });
    expect(byId(board, "mock-s-gh-1")).toMatchObject({ type: "story", parent: ONB });
    expect(byId(board, "mock-r-1")).toMatchObject({ type: "requirement", parent: "mock-s-gh-1" });
    expect(byId(board, "mock-r-14")).toMatchObject({ type: "requirement", status: "proposed" });
    expect(byId(board, "mock-f-gh")).toMatchObject({
      type: "feature",
      parent: SIGNUP,
      madeBy: ["mock-brainstorm-auth-app"],
    });
  });

  it("folds a feature's architecture into it", () => {
    expect(byId(board, "mock-f-gh")?.architecture).toMatchObject({
      name: "GitHub App per org",
      diagram: expect.stringContaining("graph LR"),
    });
    expect(byId(board, "mock-f-name")?.architecture).toBeUndefined();
  });

  it("shows a plan written before 135 (stories under a feature) as the initiative's journeys", () => {
    const old: InitiativeTreeData = {
      nodes: [
        { ref_id: "i", type: "HiveInitiative", properties: { name: "Old" } },
        { ref_id: "m", type: "HiveMilestone", properties: { name: "M" } },
        { ref_id: "f", type: "InitiativeFeature", properties: { name: "F" } },
        { ref_id: "s", type: "UserStory", properties: { text: "S" } },
        { ref_id: "r", type: "Requirement", properties: { text: "R" } },
      ],
      edges: [
        { source: "i", target: "m", type: "HAS_MILESTONE" },
        { source: "m", target: "f", type: "HAS_FEATURE" },
        { source: "f", target: "s", type: "HAS_STORY" },
        { source: "s", target: "r", type: "HAS_REQUIREMENT" },
      ],
      stage: initiativeStage([]),
      truncated: false,
    };
    const b = toBoard([{ summary: summary("i", "Old"), ws: "ws", tree: old }], {});
    expect(byId(b, "s")?.parent).toBe("i");
    expect(byId(b, "r")?.parent).toBe("s");
  });

  it("keeps an initiative whose plan hasn't been read, from its summary", () => {
    expect(byId(board, "mock-initiative-mobile")).toMatchObject({
      type: "initiative",
      name: "Mobile review app",
      updatedAt: 1,
    });
  });

  it("folds a brainstorm about a milestone into questions, follow-ups under their answer", () => {
    const [auth, repo] = brainstormsOn(board, SIGNUP);
    expect(auth).toMatchObject({
      id: "mock-brainstorm-auth",
      about: SIGNUP,
      root: "mock-brainstorm-auth",
      decided: true,
    });
    const app = auth.options![0];
    expect(app).toMatchObject({ letter: "A", chosen: true, makes: ["GitHub sign-in"], fast: 2, good: 3, cheap: 2 });
    expect(app.pros[0]).toEqual({
      req: "mock-r-2",
      good: true,
      text: "One install per org, so returning users skip it",
    });
    expect(followUpTo(board, app.id)).toMatchObject({ follows: app.id, about: SIGNUP, root: "mock-brainstorm-auth" });
    // An answer strut gave no `makes` makes one thing, named after itself (the card says so).
    expect(repo.options?.find((o) => o.id === "mock-brainstorm-repo-all")?.makes).toBeUndefined();
  });
});

describe("pips", () => {
  it("maps a -1..1 score onto 1–3", () => {
    expect([pips(-1), pips(-0.2), pips(0), pips(0.5), pips(1), pips(undefined)]).toEqual([1, 2, 2, 3, 3, undefined]);
  });
});

describe("the desk", () => {
  it("orders initiatives by when they last changed", () => {
    expect(initiativesByRecency(board).map((n) => n.id)).toEqual([
      ONB,
      "mock-initiative-janitor",
      "mock-initiative-mobile",
    ]);
  });
});

describe("walking the board", () => {
  it("finds a card's initiative and the container its artifacts show in", () => {
    expect(initiativeOf(board, "mock-r-1")?.id).toBe(ONB);
    expect(initiativeOf(board, "mock-brainstorm-auth-approve")?.id).toBe(ONB);
    expect(nearestContainer(board, "mock-s-gh-1")).toBe(ONB);
    expect(nearestContainer(board, "mock-brainstorm-repo-fresh")).toBe(SIGNUP);
  });

  it("pulls up the best match, bigger things first on a tie", () => {
    expect(bestMatch(board, "repo picker")?.id).toBe("mock-f-repo");
    expect(bestMatch(board, "Self-serve onboarding.")?.id).toBe(ONB);
    expect(bestMatch(board, "zzz")).toBeUndefined();
  });

  it("suggests what a card still needs", () => {
    expect(suggestions(board, SIGNUP)).toContain("Start another brainstorm on this milestone.");
    expect(suggestions(board, "mock-m-janitor")[0]).toBe("Propose features for this milestone.");
    expect(suggestions(board, "mock-f-name")[0]).toBe("Draft the architecture for this feature.");
    expect(suggestions(board, "mock-f-gh")[0]).toBe(IMPLEMENT);
    expect(suggestions(board, "mock-initiative-mobile")[0]).toBe(
      "Write the user journeys and requirements for this initiative.",
    );
  });
});

describe("editing helpers", () => {
  it("names the field a card's words live in", () => {
    expect([textField("initiative"), textField("feature"), textField("brief"), textField("requirement")]).toEqual([
      "name",
      "name",
      "text",
      "text",
    ]);
  });
});

describe("initiative brief", () => {
  const read = (nodes: InitiativeTreeData["nodes"], edges: InitiativeTreeData["edges"]) =>
    toBoard(
      [{ summary: summary("i", "I"), ws: "ws", tree: { nodes, edges, stage: initiativeStage([]), truncated: false } }],
      {},
    );
  const init = { ref_id: "i", type: "HiveInitiative", properties: { name: "I" } } as const;

  it("shows the brief's text under its initiative", () => {
    const b = read(
      [init, { ref_id: "b", type: "Brief", properties: { text: "Why this" } }],
      [{ source: "i", target: "b", type: "HAS_BRIEF" }],
    );
    expect(kids(b, "i", "brief").map((n) => n.name)).toEqual(["Why this"]);
  });

  it("keeps a brief whose edge is missing, or was met from another node first, on its initiative", () => {
    const b = read(
      [
        init,
        { ref_id: "m", type: "HiveMilestone", properties: { name: "M" } },
        { ref_id: "b", type: "Brief", properties: { text: "Why this" } },
        { ref_id: "b2", type: "Brief", properties: { text: "And this" } },
      ],
      [
        { source: "i", target: "m", type: "HAS_MILESTONE" },
        { source: "m", target: "b", type: "HAS_BRIEF" },
      ],
    );
    expect(kids(b, "i", "brief").map((n) => n.name).sort()).toEqual(["And this", "Why this"]);
  });

  it("reads the brief from its other text fields when `text` is empty", () => {
    const b = read(
      [init, { ref_id: "b", type: "Brief", properties: { text: " ", description: "From description" } }],
      [{ source: "i", target: "b", type: "HAS_BRIEF" }],
    );
    expect(byId(b, "b")?.name).toBe("From description");
  });
});

describe("milestoneNumber", () => {
  const withSequences = (seqs: Array<number | undefined>) =>
    toBoard(
      [
        {
          summary: summary("i", "I"),
          ws: "ws",
          tree: {
            nodes: [
              { ref_id: "i", type: "HiveInitiative", properties: { name: "I" } },
              ...seqs.map((s, k) => ({
                ref_id: `m${k}`,
                type: "HiveMilestone" as const,
                properties: { name: `M${k}`, ...(s === undefined ? {} : { sequence: s }) },
              })),
            ],
            edges: seqs.map((_, k) => ({ source: "i", target: `m${k}`, type: "HAS_MILESTONE" })),
            stage: initiativeStage([]),
            truncated: false,
          },
        },
      ],
      {},
    );

  it("counts 0-based sequences from 1", () => {
    const b = withSequences([0, 1, 2]);
    expect([0, 1, 2].map((k) => milestoneNumber(b, byId(b, `m${k}`)!))).toEqual([1, 2, 3]);
  });

  it("keeps 1-based sequences as they are", () => {
    const b = withSequences([1, 2, 3]);
    expect([0, 1, 2].map((k) => milestoneNumber(b, byId(b, `m${k}`)!))).toEqual([1, 2, 3]);
  });

  it("falls back on order when there is no sequence", () => {
    const b = withSequences([undefined, undefined]);
    expect([0, 1].map((k) => milestoneNumber(b, byId(b, `m${k}`)!))).toEqual([1, 2]);
  });

  it("asks Jamie to run canvas-sync", () => {
    expect(SYNC).toContain("canvas-sync");
  });
});
