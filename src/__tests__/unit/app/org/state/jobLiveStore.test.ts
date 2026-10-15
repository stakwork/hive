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
