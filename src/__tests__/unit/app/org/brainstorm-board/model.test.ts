import { describe, expect, it } from "vitest";
import { mockBoardTree, MOCK_BOARD_ROOT } from "@/app/api/mock/graph/workbench-fixture";
import { buildChoiceTree } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";
import { dimmedIds, ghostIds, isPerson, matchMember, memberLabel, myPath } from "@/app/org/[githubLogin]/_components/brainstorm-board/model";

const mock = mockBoardTree();
const tree = buildChoiceTree(mock.nodes, mock.edges, MOCK_BOARD_ROOT);

describe("isPerson", () => {
  it("is anything but the model", () => {
    expect(isPerson("user")).toBe(true);
    expect(isPerson("tom-login")).toBe(true);
    expect(isPerson("model")).toBe(false);
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

describe("members", () => {
  it("matches a member by id, githubUsername or name, case-insensitive", () => {
    const members = [
      { id: "u1", name: "Tom Smith", image: null, githubUsername: "tomsmith" },
      { id: "u2", name: "Jamie", image: "x.png", githubUsername: null },
    ];
    expect(matchMember(members, { speaker: "TOMSMITH" })?.id).toBe("u1");
    expect(matchMember(members, { madeBy: "u2" })?.id).toBe("u2");
    expect(matchMember(members, { speaker: "jamie", madeBy: "user" })?.id).toBe("u2");
    expect(matchMember(members, { speaker: "Nobody" })).toBeNull();
    expect(matchMember(members, { madeBy: "user" })).toBeNull();
    expect(matchMember([], { madeBy: "tom" })).toBeNull();
  });

  it("labels a member by name, else githubUsername", () => {
    expect(memberLabel({ id: "u1", name: "Tom Smith", image: null, githubUsername: "t" })).toBe("Tom Smith");
    expect(memberLabel({ id: "u1", name: null, image: null, githubUsername: "tom" })).toBe("tom");
  });
});
