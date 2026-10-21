import { describe, expect, it } from "vitest";
import { mockChoiceTree } from "@/app/api/mock/graph/workbench-fixture";
import { mockInitiativeTree, MOCK_INITIATIVES } from "@/app/api/mock/graph/initiative-fixture";
import { toBoard, type InitiativeEntry } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import {
  ORG,
  STACK,
  addKey,
  between,
  chain,
  diveTo,
  fit,
  focusWeight,
  layoutScene,
  levelFor,
  openAt,
  openTree,
  optionKey,
  orgRect,
  panelKey,
  storyKey,
  visibility,
  zoomAbout,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/scene";
import { initiativeStage } from "@/services/graph/workbench";

const entry = (id: string, name: string, updated: number): InitiativeEntry => {
  const t = mockInitiativeTree(id);
  return {
    summary: {
      ref_id: id,
      name,
      status: null,
      created_at: null,
      updated_at: updated,
      created_by: null,
      created_by_kind: null,
      assignee_id: null,
    },
    ws: "ws",
    tree: { ...t, stage: initiativeStage(t.nodes), truncated: false },
  };
};
const ONB = "mock-initiative-onboarding";
const SIGNUP = "mock-m-signup";
const board = toBoard(
  MOCK_INITIATIVES.map((s, i) => entry(s.id, s.name, 100 - i)),
  {
    "mock-brainstorm-auth": mockChoiceTree("mock-brainstorm-auth"),
    "mock-brainstorm-repo": mockChoiceTree("mock-brainstorm-repo"),
  },
);
const DESK = [ONB, "mock-initiative-janitor", "mock-initiative-voice"];
const scene = layoutScene(board, DESK);
const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;

describe("layoutScene", () => {
  it("lays the desk in a row, with the rest in a stack after it", () => {
    const tops = [...scene.values()].filter((n) => n.parent === ORG);
    expect(tops.map((n) => n.id)).toEqual([...DESK, STACK]);
    expect(tops[0].rect.y).toBeCloseTo(tops[2].rect.y);
    expect(scene.get(STACK)!.rect.x).toBeGreaterThan(tops[2].rect.x + tops[2].rect.w);
    expect(
      layoutScene(
        board,
        MOCK_INITIATIVES.map((s) => s.id),
      ).has(STACK),
    ).toBe(false);
  });

  it("nests every card inside its container", () => {
    for (const n of scene.values()) {
      if (n.parent === ORG || ["question", "option", "artifacts"].includes(n.type)) continue;
      expect(inside(n.rect, scene.get(n.parent)!.rect), n.id).toBe(true);
    }
  });

  it("gives an initiative its road (brief, milestones in order) and its user stories panel", () => {
    expect(scene.get(`${ONB}-brief`)?.parent).toBe(ONB);
    const road = [SIGNUP, "mock-m-invite", "mock-m-janitor"].map((id) => scene.get(id)!.rect.x);
    expect([...road].sort((a, b) => a - b)).toEqual(road);
    expect(scene.get(panelKey("stories", ONB))?.type).toBe("stories");
  });

  it("gives a milestone a copy of each story in scope, its features, and the add slots", () => {
    expect(scene.get(storyKey("mock-s-gh-1", SIGNUP))).toMatchObject({
      type: "story",
      parent: SIGNUP,
      of: "mock-s-gh-1",
    });
    expect(scene.has(storyKey("mock-s-link-1", SIGNUP))).toBe(false);
    expect(scene.get(storyKey("mock-s-link-1", "mock-m-invite"))?.parent).toBe("mock-m-invite");
    expect(scene.get("mock-f-gh")?.parent).toBe(SIGNUP);
    expect(scene.get(addKey("story", SIGNUP))?.of).toBe("story");
    expect(scene.get(addKey("feature", SIGNUP))?.of).toBe("feature");
    // Features sit below the stories.
    expect(scene.get("mock-f-gh")!.rect.y).toBeGreaterThan(scene.get(storyKey("mock-s-gh-1", SIGNUP))!.rect.y);
  });

  it("keeps a story added inside a milestone showing there before it has requirements", () => {
    const s = layoutScene(board, DESK, { addedIn: { "mock-m-janitor": ["mock-s-name"] } });
    expect(s.has(storyKey("mock-s-name", "mock-m-janitor"))).toBe(true);
  });

  it("gives a feature its architecture and build panels", () => {
    expect(scene.get(panelKey("architecture", "mock-f-gh"))?.type).toBe("architecture");
    expect(scene.get(panelKey("build", "mock-f-gh"))?.type).toBe("build");
  });

  it("grows the open brainstorm to the right, folds the others, and frames the first column", () => {
    expect(openTree(board, SIGNUP, {})).toBe("mock-brainstorm-repo");
    const m = scene.get(SIGNUP)!;
    const q = scene.get("mock-brainstorm-repo")!;
    const picker = scene.get(optionKey("mock-brainstorm-repo", "mock-brainstorm-repo-picker"))!;
    const fresh = scene.get("mock-brainstorm-repo-fresh")!;
    expect(q.rect.x).toBeGreaterThan(m.rect.x + m.rect.w);
    expect(picker.rect.x).toBeGreaterThan(q.rect.x + q.rect.w);
    expect(fresh.rect.x).toBeGreaterThan(picker.rect.x + picker.rect.w);
    expect(inside(picker.rect, m.group)).toBe(true);
    expect(inside(fresh.rect, m.group)).toBe(false);
    expect(inside(fresh.rect, q.group)).toBe(true);
    // The older brainstorm is folded: just its question.
    expect(scene.get("mock-brainstorm-auth")?.type).toBe("question");
    expect(scene.has(optionKey("mock-brainstorm-auth", "mock-brainstorm-auth-app"))).toBe(false);
    const other = layoutScene(board, DESK, { open: { [SIGNUP]: "mock-brainstorm-auth" } });
    expect(other.has(optionKey("mock-brainstorm-auth", "mock-brainstorm-auth-app"))).toBe(true);
    expect(other.has(optionKey("mock-brainstorm-repo", "mock-brainstorm-repo-picker"))).toBe(false);
  });

  it("is deterministic, and puts a strip under a container with artifacts", () => {
    expect(layoutScene(board, DESK).get("mock-f-gh")).toEqual(scene.get("mock-f-gh"));
    const s = layoutScene(board, DESK, { artifacts: (id) => (id === SIGNUP ? 2 : 0) });
    const strip = s.get(panelKey("artifacts", SIGNUP))!;
    expect(strip.parent).toBe(SIGNUP);
    expect(strip.rect.y).toBeGreaterThan(s.get(SIGNUP)!.rect.y + s.get(SIGNUP)!.rect.h);
    expect(inside(strip.rect, s.get(SIGNUP)!.group)).toBe(true);
  });
});

describe("levels", () => {
  it("opens the chain of containers above a level", () => {
    expect(chain(scene, "mock-f-gh")).toEqual([ONB, SIGNUP, "mock-f-gh"]);
    expect(openAt(scene, ORG)).toEqual([]);
  });

  it("finds the level a card lives at", () => {
    expect(levelFor(scene, board, "mock-r-1")).toBe(SIGNUP);
    expect(levelFor(scene, board, "mock-r-14")).toBe(ONB);
    expect(levelFor(scene, board, "mock-s-gh-1")).toBe(ONB);
    expect(levelFor(scene, board, `${ONB}-brief`)).toBe(ONB);
    expect(levelFor(scene, board, "mock-brainstorm-repo-fresh")).toBe(SIGNUP);
    expect(levelFor(scene, board, "mock-f-gh")).toBe("mock-f-gh");
  });

  it("shows a card only when every container above it is open", () => {
    const open = new Set([ONB, SIGNUP]);
    expect(visibility(scene, "mock-f-gh", (id) => (open.has(id) ? 1 : 0))).toBe(1);
    expect(visibility(scene, panelKey("build", "mock-f-gh"), (id) => (open.has(id) ? 1 : 0))).toBe(0);
  });

  it("clears everything outside the level you're in", () => {
    expect(focusWeight(scene, "mock-initiative-janitor", ORG)).toBe(1);
    expect(focusWeight(scene, "mock-initiative-janitor", ONB)).toBe(0);
    expect(focusWeight(scene, "mock-m-invite", SIGNUP)).toBe(0);
    expect(focusWeight(scene, "mock-f-gh", SIGNUP)).toBe(1);
  });
});

describe("camera", () => {
  const vp = { w: 1200, h: 800 };
  it("frames a level in the space the chrome leaves", () => {
    const cam = diveTo(scene.get(SIGNUP)!, vp, { top: 70, bottom: 190 });
    const g = scene.get(SIGNUP)!.group;
    expect(g.w * cam.z).toBeLessThanOrEqual(vp.w);
    expect(g.h * cam.z).toBeLessThanOrEqual(vp.h - 260);
    expect(fit(orgRect(scene), vp).z).toBeLessThan(cam.z);
  });

  it("zooms about the pointer and flies geometrically", () => {
    const cam = { cx: 0, cy: 0, z: 1 };
    const z = zoomAbout(cam, 2, 600, 400, vp);
    expect(z).toEqual({ cx: 0, cy: 0, z: 2 });
    expect(between({ cx: 0, cy: 0, z: 1 }, { cx: 100, cy: 0, z: 4 }, 0.5).z).toBeCloseTo(2);
    expect(between(cam, z, 1)).toEqual(expect.objectContaining({ z: 2 }));
  });
});
