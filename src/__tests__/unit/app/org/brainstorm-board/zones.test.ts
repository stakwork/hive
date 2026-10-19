import { describe, expect, it } from "vitest";
import { mockBoardTree, MOCK_BOARD_ROOT } from "@/app/api/mock/graph/workbench-fixture";
import { buildChoiceTree } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";
import {
  authorName,
  couldOnMyPath,
  dimmedIds,
  ghostIds,
  isPerson,
  matchMember,
  myPath,
  zoneOf,
  zonesOf,
} from "@/app/org/[githubLogin]/_components/brainstorm-board/zones";

const mock = mockBoardTree();
const tree = buildChoiceTree(mock.nodes, mock.edges, MOCK_BOARD_ROOT);
const item = (id: string) => tree.items.find((i) => i.id === id)!;
const zone = (id: string) => zoneOf(item(id), tree);

describe("isPerson", () => {
  it("is anything but the model", () => {
    expect(isPerson("user")).toBe(true);
    expect(isPerson("tom-login")).toBe(true);
    expect(isPerson("model")).toBe(false);
  });
});

describe("zoneOf (v1 rule)", () => {
  it("puts a chosen option under a decided question, and the decided questions above it, in built", () => {
    expect(zone(MOCK_BOARD_ROOT)).toBe("built");
    expect(zone("mock-bb-q1")).toBe("built");
    expect(zone("mock-bb-1a")).toBe("built");
  });

  it("puts open questions and their open options in now", () => {
    expect(zone("mock-bb-fq")).toBe("now");
    for (const id of ["mock-bb-fqa", "mock-bb-fqb", "mock-bb-fqc"]) expect(zone(id)).toBe("now");
  });

  it("puts simulated nodes and everything under them in could", () => {
    for (const id of ["mock-bb-fqd", "mock-bb-sim-q", "mock-bb-sim-a", "mock-bb-sim-b"]) expect(zone(id)).toBe("could");
  });

  it("keeps branches not taken beside the decision they lost to", () => {
    for (const id of ["mock-bb-1b", "mock-bb-1c", "mock-bb-1c-q", "mock-bb-1c-a"]) expect(zone(id)).toBe("built");
  });

  it("zonesOf agrees with zoneOf", () => {
    const all = zonesOf(tree);
    expect(all.size).toBe(tree.items.length);
    for (const i of tree.items) expect(all.get(i.id)).toBe(zoneOf(i, tree));
  });
});

describe("ghostIds / dimmedIds", () => {
  it("ghosts are the descendants of unchosen options under a decided question — not the options", () => {
    expect([...ghostIds(tree)].sort()).toEqual(["mock-bb-1c-a", "mock-bb-1c-q"]);
  });

  it("unchosen siblings of a chosen option dim", () => {
    expect([...dimmedIds(tree)].sort()).toEqual(["mock-bb-1b", "mock-bb-1c"]);
  });
});

describe("myPath", () => {
  it("is the chosen chain from the root, ending at the first open question", () => {
    expect(myPath(tree)).toEqual([MOCK_BOARD_ROOT, "mock-bb-q1", "mock-bb-1a", "mock-bb-fq"]);
  });

  it("is just the root when it is open, and empty for no tree", () => {
    const open = buildChoiceTree([{ ref_id: "r", type: "Question", properties: { text: "Q" } }], [], "r");
    expect(myPath(open)).toEqual(["r"]);
    expect(myPath({ items: [], links: [] })).toEqual([]);
  });
});

describe("couldOnMyPath", () => {
  it("is true for futures hung off the path's open question", () => {
    const path = new Set(myPath(tree));
    expect(couldOnMyPath("mock-bb-fqd", tree, path)).toBe(true);
    expect(couldOnMyPath("mock-bb-sim-a", tree, path)).toBe(true);
    expect(couldOnMyPath("mock-bb-sim-a", tree, new Set())).toBe(false);
  });
});

describe("authors", () => {
  it("signs with the speaker, else made_by unless it is the generic user, else someone", () => {
    expect(authorName(item(MOCK_BOARD_ROOT))).toBe("Tom");
    expect(authorName({ madeBy: "tom-login" })).toBe("tom-login");
    expect(authorName({ madeBy: "user" })).toBe("someone");
  });

  it("matches a member by id, githubUsername or name, case-insensitive", () => {
    const members = [
      { id: "u1", name: "Tom Smith", image: null, githubUsername: "tomsmith" },
      { id: "u2", name: "Jamie", image: "x.png", githubUsername: null },
    ];
    expect(matchMember(members, { speaker: "TOMSMITH" })?.id).toBe("u1");
    expect(matchMember(members, { madeBy: "u2" })?.id).toBe("u2");
    expect(matchMember(members, { speaker: "jamie", madeBy: "user" })?.id).toBe("u2");
    expect(matchMember(members, { speaker: "Nobody" })).toBeNull();
  });
});
