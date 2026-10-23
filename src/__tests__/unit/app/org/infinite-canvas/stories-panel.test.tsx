// @vitest-environment jsdom
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mockInitiativeTree } from "@/app/api/mock/graph/initiative-fixture";
import { kids, toBoard, type PlanNode } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import { StoriesPanel, type CardContext } from "@/app/org/[githubLogin]/_components/infinite-canvas/nodes";
import { initiativeStage } from "@/services/graph/workbench";

vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/fonts", () => ({
  serif: { style: { fontFamily: "serif" } }, hand: { className: "", style: { fontFamily: "cursive" } },
}));

const ONB = "mock-initiative-onboarding";
const t = mockInitiativeTree(ONB);
const board = toBoard(
  [
    {
      summary: {
        ref_id: ONB, name: "Onboarding", status: null, created_at: null, updated_at: 1,
        created_by: null, created_by_kind: "human", assignee_id: null,
      },
      ws: "ws",
      tree: { ...t, stage: initiativeStage(t.nodes), truncated: false },
    },
  ],
  {},
);

function setup(mutate?: (reqs: PlanNode[]) => void) {
  const stories = kids(board, ONB, "story");
  const reqs = stories.flatMap((s) => kids(board, s.id, "requirement"));
  mutate?.(reqs);
  const actions = {
    setStatus: vi.fn(), remove: vi.fn(), addRequirement: vi.fn(), rename: vi.fn(), addStory: vi.fn(),
  };
  const c = { board, jobs: {}, actions, flash: null, work: () => undefined, decide: async () => true } as unknown as CardContext;
  const view = render(<StoriesPanel c={c} initiative={ONB} w={1500} h={400} />);
  return { stories, reqs, actions, view };
}

describe("StoriesPanel", () => {
  it("numbers every story", () => {
    const { stories } = setup();
    expect(stories.length).toBeGreaterThan(0);
    stories.forEach((_, i) => expect(screen.getByText(`[${i + 1}]`)).toBeTruthy());
  });

  it("has accept/drop/delete actions in the DOM and toggles status", () => {
    const { reqs, actions, view } = setup();
    const r = reqs.find((x) => x.status !== "accepted" && x.status !== "dropped" && !x.pencil);
    if (!r) return;
    fireEvent.click(view.container.querySelector(`[data-accept="${r.id}"]`)!);
    expect(actions.setStatus).toHaveBeenCalledWith(r.id, "accepted");
    fireEvent.click(view.container.querySelector(`[data-drop="${r.id}"]`)!);
    expect(actions.setStatus).toHaveBeenCalledWith(r.id, "dropped");
  });

  it("ticks only satisfied requirements; accepted and proposed get non-tick markers", () => {
    const { reqs, view } = setup((rs) => {
      rs[0].status = "satisfied";
      rs[1].status = "accepted";
      rs[2].status = "proposed";
    });
    const box = (id: string) => view.container.querySelector(`[data-req="${id}"] [role="checkbox"]`)!;
    expect(box(reqs[0].id).textContent).toBe("✓");
    expect(box(reqs[1].id).textContent).toBe("○");
    expect(box(reqs[1].id).getAttribute("title")).toMatch(/not yet delivered/);
    expect(box(reqs[2].id).textContent).toBe("·");
    expect(box(reqs[2].id).getAttribute("title")).toMatch(/Proposed/);
  });

  it("delete shows an Undo bar that re-adds the requirement", () => {
    const { reqs, stories, actions, view } = setup();
    const r = reqs.find((x) => !x.pencil)!;
    fireEvent.click(view.container.querySelector(`[data-delete="${r.id}"]`)!);
    expect(actions.remove).toHaveBeenCalledWith(r.id);
    expect(screen.getByText("Requirement deleted.")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    const story = stories.find((s) => kids(board, s.id, "requirement").some((x) => x.id === r.id))!;
    expect(actions.addRequirement).toHaveBeenCalledWith(story.id, r.name);
  });
});
