import { describe, it, expect } from "vitest";
import {
  applyCanvasJobNudge,
  canvasFocusContextLine,
  canvasFocusOf,
  canvasFocusOfInput,
  canvasJobsByRef,
  nodeTypeWord,
  type CanvasCardJobNudge,
  type CanvasJob,
} from "@/lib/canvas/canvas-jobs";
import { parseInitiativeFocus } from "@/lib/canvas/graph-focus";

const hint = {
  workspaceSlug: "hive",
  initiativeRefId: "init-1",
  initiativeName: "Self-serve onboarding",
  stage: "2 milestones",
  selectedRefId: "feat-1",
  selectedType: "InitiativeFeature",
  selectedLabel: "Repo picker",
};

describe("canvas focus", () => {
  it("is the selected card, else the initiative", () => {
    expect(canvasFocusOf(hint)).toEqual({
      workspaceSlug: "hive",
      initiativeRefId: "init-1",
      initiativeName: "Self-serve onboarding",
      refId: "feat-1",
      refType: "InitiativeFeature",
      refLabel: "Repo picker",
    });
    const { selectedRefId: _r, selectedType: _t, selectedLabel: _l, ...bare } = hint;
    expect(canvasFocusOf(bare)).toEqual({
      workspaceSlug: "hive",
      initiativeRefId: "init-1",
      initiativeName: "Self-serve onboarding",
      refId: "init-1",
    });
  });

  it("reads back off a row's input, and nothing malformed", () => {
    const focus = canvasFocusOf(hint);
    expect(canvasFocusOfInput({ prompt: "p", focus })).toEqual(focus);
    expect(canvasFocusOfInput({ prompt: "p" })).toBeNull();
    expect(canvasFocusOfInput({ focus: { refId: "x" } })).toBeNull();
    expect(canvasFocusOfInput(null)).toBeNull();
  });
});

describe("the context line", () => {
  it("names the initiative and the selected card, from the parsed request", () => {
    const parsed = parseInitiativeFocus(hint, ["hive"])!;
    expect(canvasFocusContextLine(canvasFocusOf(parsed))).toBe(
      'On the canvas: initiative "Self-serve onboarding" (`init-1`), feature "Repo picker" (`feat-1`) in workspace `hive`. ',
    );
  });

  it("names the initiative alone when it is the card", () => {
    const parsed = parseInitiativeFocus({ ...hint, selectedRefId: null }, ["hive"])!;
    expect(canvasFocusContextLine(canvasFocusOf(parsed))).toBe(
      'On the canvas: initiative "Self-serve onboarding" (`init-1`) in workspace `hive`. ',
    );
  });

  it("carries no quote or backtick from graph text into the line", () => {
    const parsed = parseInitiativeFocus({ ...hint, initiativeName: 'Bad "x" `y`', selectedLabel: 'a"b' }, ["hive"])!;
    expect(canvasFocusContextLine(canvasFocusOf(parsed))).toBe(
      'On the canvas: initiative "Bad x y" (`init-1`), feature "a b" (`feat-1`) in workspace `hive`. ',
    );
  });

  it("words node types", () => {
    expect(nodeTypeWord("HiveMilestone")).toBe("milestone");
    expect(nodeTypeWord("UserStory")).toBe("user story");
    expect(nodeTypeWord("InitiativeWidget")).toBe("widget");
    expect(nodeTypeWord(undefined)).toBe("card");
  });
});

const nudge = (over: Partial<CanvasCardJobNudge> = {}): CanvasCardJobNudge => ({
  jobId: "j-1",
  state: "running",
  refId: "feat-1",
  initiativeRefId: "init-1",
  workspaceSlug: "hive",
  at: 1_000,
  ...over,
});

const job = (over: Partial<CanvasJob> = {}): CanvasJob => ({
  jobId: "j-1",
  runId: "row-1",
  title: "Build the repo picker",
  state: "running",
  startedBy: { id: "u-1", name: "Ana" },
  refId: "feat-1",
  initiativeRefId: "init-1",
  updatedAt: 500,
  ...over,
});

describe("applyCanvasJobNudge", () => {
  it("keeps the newest nudge per job, for the initiative on screen only", () => {
    let live = applyCanvasJobNudge({}, nudge({ latest: { kind: "image" } }), "init-1");
    expect(live["j-1"]).toMatchObject({ state: "running", latest: { kind: "image" } });
    live = applyCanvasJobNudge(live, nudge({ at: 2_000, state: "done" }), "init-1");
    // A settle without a new item keeps the last thing the job reported.
    expect(live["j-1"]).toMatchObject({ state: "done", at: 2_000, latest: { kind: "image" } });
    expect(applyCanvasJobNudge(live, nudge({ at: 1_500 }), "init-1")).toBe(live);
    expect(applyCanvasJobNudge(live, nudge({ initiativeRefId: "init-2", at: 3_000 }), "init-1")).toBe(live);
    expect(applyCanvasJobNudge(live, nudge({ at: 3_000 }), null)).toBe(live);
  });

  it("keeps a run id it learned when a later nudge has none", () => {
    const live = applyCanvasJobNudge({}, nudge({ runId: "row-1" }), "init-1");
    expect(applyCanvasJobNudge(live, nudge({ at: 2_000 }), "init-1")["j-1"].runId).toBe("row-1");
  });
});

describe("canvasJobsByRef", () => {
  it("groups the read by card, newest first", () => {
    const byRef = canvasJobsByRef(
      [job(), job({ jobId: "j-2", updatedAt: 900 }), job({ jobId: "j-3", refId: "init-1" })],
      {},
    );
    expect(byRef["feat-1"].map((j) => j.jobId)).toEqual(["j-2", "j-1"]);
    expect(byRef["init-1"].map((j) => j.jobId)).toEqual(["j-3"]);
  });

  it("lays a newer nudge over the read, keeping its title and starter", () => {
    const byRef = canvasJobsByRef([job()], {
      "j-1": nudge({ state: "done", at: 2_000, latest: { kind: "pull_request" } }),
    });
    expect(byRef["feat-1"]).toEqual([job({ state: "done", updatedAt: 2_000, latest: { kind: "pull_request" } })]);
  });

  it("ignores a nudge older than the read", () => {
    expect(canvasJobsByRef([job({ state: "done", updatedAt: 5_000 })], { "j-1": nudge() })["feat-1"][0].state).toBe(
      "done",
    );
  });

  it("shows a job the read has not returned yet as an untitled one", () => {
    expect(canvasJobsByRef([], { "j-9": nudge({ jobId: "j-9" }) })["feat-1"]).toEqual([
      {
        jobId: "j-9",
        title: "Job",
        startedBy: null,
        state: "running",
        refId: "feat-1",
        initiativeRefId: "init-1",
        updatedAt: 1_000,
      },
    ]);
  });
});
