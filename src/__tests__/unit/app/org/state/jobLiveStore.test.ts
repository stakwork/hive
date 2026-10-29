/**
 * The live store (strut plans/live-artifacts.md): a job's updates kept as
 * each thing's newest state, what a working card shows of them, and a
 * Verify's start and end.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_LIVE_ITEMS,
  applyJobUpdate,
  liveItemsToShow,
  liveKey,
  liveStatus,
  useJobLiveStore,
  type JobLiveItem,
} from "@/app/org/[githubLogin]/_state/jobLiveStore";
import type { CanvasJobUpdate } from "@/lib/pusher";

const JOB = "j-1";
const MANIFEST = `/jobs/${JOB}/files/walkthroughs/001/walkthrough.json`;
const u = (over: Partial<CanvasJobUpdate> = {}): CanvasJobUpdate => ({ jobId: JOB, swarmId: "s-1", at: "t", kind: "walkthrough", url: MANIFEST, state: "recording", ...over });

describe("applyJobUpdate", () => {
  it("keeps each thing's newest state, moved to the end — the same key strut coalesces on", () => {
    let items: JobLiveItem[] = [];
    items = applyJobUpdate(items, u({ detail: { frames: 1 } }), 1);
    items = applyJobUpdate(items, u({ kind: "pod", url: undefined, id: "pod-7", state: "held" }), 2);
    items = applyJobUpdate(items, u({ detail: { frames: 2 } }), 3);
    expect(items.map((i) => [i.kind, i.detail?.frames ?? i.state, i.receivedAt])).toEqual([["pod", "held", 2], ["walkthrough", 2, 3]]);
    expect(liveKey(u())).not.toBe(liveKey(u({ id: "x" })));
  });

  it("keeps at most MAX_LIVE_ITEMS, dropping the oldest", () => {
    let items: JobLiveItem[] = [];
    for (let n = 0; n < MAX_LIVE_ITEMS + 5; n++) items = applyJobUpdate(items, u({ kind: "image", url: `/jobs/${JOB}/files/shots/${n}.png` }), n);
    expect(items).toHaveLength(MAX_LIVE_ITEMS);
    expect(items[0].url).toBe(`/jobs/${JOB}/files/shots/5.png`);
  });
});

describe("liveItemsToShow", () => {
  const items = [
    applyJobUpdate([], u({ kind: "image", url: `/jobs/${JOB}/files/shots/001.png` }), 10)[0],
    applyJobUpdate([], u(), 20)[0],
    applyJobUpdate([], u({ kind: "verify", url: undefined, state: "done" }), 30)[0],
  ];
  it("what arrived since the card appeared, never a verify's end", () => {
    expect(liveItemsToShow(items, { since: 15 }).map((i) => i.kind)).toEqual(["walkthrough"]);
    expect(liveItemsToShow(undefined)).toEqual([]);
  });
  it("matched to a delivered artifact BY URL: the conversation's card wins", () => {
    expect(liveItemsToShow(items, { delivered: new Set([MANIFEST]) }).map((i) => i.kind)).toEqual(["image"]);
  });
  it("a run's graph writes are a signal, never a thing to show (strut plans/live-feeds.md §2)", () => {
    const graph = applyJobUpdate([], u({ kind: "graph", url: undefined, id: "1790000000001", state: "written", detail: { writes: 3 } }), 40)[0];
    expect(liveItemsToShow([...items, graph]).map((i) => i.kind)).toEqual(["image", "walkthrough"]);
  });
  it("with launchedAt (strut's clock), each update's own `at` decides, whenever it was received", () => {
    const launched = Date.parse("2026-10-29T16:15:43.587Z");
    const before = applyJobUpdate([], u({ kind: "pod", url: undefined, id: "pod-1", state: "released", at: "2026-10-29T16:10:00.000Z" }), 99)[0];
    const after = applyJobUpdate([], u({ kind: "pod", url: undefined, id: "pod-2", state: "held", at: "2026-10-29T16:16:01.000Z" }), 1)[0];
    expect(liveItemsToShow([before, after], { since: 50, launchedAt: launched }).map((i) => i.id)).toEqual(["pod-2"]);
    // An `at` that does not parse falls back to when it was received.
    const odd = applyJobUpdate([], u({ kind: "pod", url: undefined, id: "pod-3", state: "held", at: "t" }), 60)[0];
    expect(liveItemsToShow([odd], { since: 50, launchedAt: launched }).map((i) => i.id)).toEqual(["pod-3"]);
  });
});

describe("liveStatus", () => {
  it("is the newest status line among the items, if any", () => {
    let items: JobLiveItem[] = [];
    expect(liveStatus(items)).toBeUndefined();
    items = applyJobUpdate(items, u({ kind: "status", url: undefined, id: "r1", title: "Drafting round 1" }), 1);
    items = applyJobUpdate(items, u({ kind: "image", url: `/jobs/${JOB}/files/shots/001.png` }), 2);
    items = applyJobUpdate(items, u({ kind: "status", url: undefined, id: "r2", title: "Writing the cards" }), 3);
    expect(liveStatus(items)?.title).toBe("Writing the cards");
    items = applyJobUpdate(items, u({ kind: "status", url: undefined, id: "r1", title: "Drafting round 2" }), 4);
    expect(liveStatus(items)?.title).toBe("Drafting round 2");
  });
});

describe("useJobLiveStore", () => {
  beforeEach(() => useJobLiveStore.setState({ byJob: {}, verifying: {} }));

  it("a Verify is in flight from its start until the job reports it done", () => {
    const s = useJobLiveStore.getState();
    s.startVerify(JOB);
    expect(useJobLiveStore.getState().verifying[JOB]).toBeTypeOf("number");
    s.apply(u({ kind: "evidence", url: undefined, id: "ev-1", state: "supported" }));
    expect(useJobLiveStore.getState().verifying[JOB]).toBeDefined();
    s.apply(u({ kind: "verify", url: undefined, state: "done" }));
    expect(useJobLiveStore.getState().verifying[JOB]).toBeUndefined();
    expect(useJobLiveStore.getState().byJob[JOB].map((i) => i.kind)).toEqual(["evidence", "verify"]);
  });
});
