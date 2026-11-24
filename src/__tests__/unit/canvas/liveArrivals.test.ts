/**
 * `computeArrivals`: which cards the realtime feed added that deserve the live-arrival animation.
 */
import { describe, test, expect } from "vitest";
import {
  computeArrivals,
  viewRect,
  MAX_ARRIVALS,
  STAGGER_MS,
  type ArrivalMemory,
  type ArrivalNode,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/arrivals";
import { PENDING_PREFIX } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";

const VIEW = { x: 0, y: 0, w: 1000, h: 800 };
const card = (id: string, x = 100, y = 100, scope = "init", type = "milestone"): ArrivalNode => ({
  id,
  type,
  scope,
  rect: { x, y, w: 200, h: 120 },
});
const base = [card("init", 0, 0, "org", "initiative"), card("m1", 100, 100)];
const run = (prev: ArrivalMemory | null, nodes: ArrivalNode[], extra = {}) =>
  computeArrivals({ prev, nodes, ready: true, view: VIEW, ...extra });
const baseline = (nodes = base) => run(null, nodes).next;

describe("computeArrivals", () => {
  test("initial load animates nothing", () => {
    const r = run(null, base);
    expect(r.inView).toEqual([]);
    expect(r.offView).toEqual([]);
    expect(r.next.seen.has("m1")).toBe(true);
  });

  test("not ready: nothing", () => {
    const r = computeArrivals({ prev: null, nodes: base, ready: false, view: VIEW });
    expect(r.inView).toEqual([]);
    expect(r.offView).toEqual([]);
  });

  test("refetch with the same ids animates nothing", () => {
    const r = run(
      baseline(),
      base.map((n) => ({ ...n })),
    );
    expect(r.inView).toEqual([]);
    expect(r.offView).toEqual([]);
  });

  test("a new id in view arrives", () => {
    const r = run(baseline(), [...base, card("m2", 300, 300)]);
    expect(r.inView).toEqual([{ id: "m2", delayMs: 0 }]);
    expect(r.offView).toEqual([]);
  });

  test("a new id off view is reported, not animated", () => {
    const r = run(baseline(), [...base, card("m2", 5000, 5000)]);
    expect(r.inView).toEqual([]);
    expect(r.offView).toEqual(["m2"]);
  });

  test("a new id not drawn at this level counts as off view", () => {
    const r = run(baseline(), [...base, { ...card("m2", 300, 300), shown: false }, { ...card("m3"), rect: null }]);
    expect(r.inView).toEqual([]);
    expect(r.offView.sort()).toEqual(["m2", "m3"]);
  });

  test("an unknown camera puts everything off view", () => {
    const r = run(baseline(), [...base, card("m2")], { view: null });
    expect(r.offView).toEqual(["m2"]);
  });

  test("optimistic cards never arrive, and the saved card replacing one doesn't either", () => {
    const pend = card(`${PENDING_PREFIX}t:1:0`, 300, 300, "init", "story");
    const withPending = run(baseline(), [...base, pend]);
    expect(withPending.inView).toEqual([]);
    expect(withPending.offView).toEqual([]);
    const saved = run(withPending.next, [...base, card("real", 300, 300, "init", "story")]);
    expect(saved.inView).toEqual([]);
    expect(saved.offView).toEqual([]);
    // A later card of that kind from a teammate does arrive.
    const later = run(saved.next, [
      ...base,
      card("real", 300, 300, "init", "story"),
      card("other", 500, 300, "init", "story"),
    ]);
    expect(later.inView.map((a) => a.id)).toEqual(["other"]);
  });

  test("a card the user's own save created isn't an arrival", () => {
    const r = run(baseline(), [...base, card("mine")], { own: new Set(["mine"]) });
    expect(r.inView).toEqual([]);
    expect(r.offView).toEqual([]);
  });

  test("caps concurrent animations and staggers them in reading order", () => {
    const many = Array.from({ length: 15 }, (_, i) => card(`n${i}`, 10 + (i % 5) * 150, 10 + Math.floor(i / 5) * 150));
    const r = run(baseline(), [...base, ...many]);
    expect(r.inView).toHaveLength(MAX_ARRIVALS);
    expect(r.inView.map((a) => a.delayMs)).toEqual(r.inView.map((_, i) => i * STAGGER_MS));
    expect(r.inView[0].id).toBe("n0");
    expect(r.inView[1].id).toBe("n1");
    expect(r.overflow).toHaveLength(15 - MAX_ARRIVALS);
  });

  test("animations still playing count against the cap", () => {
    const r = run(baseline(), [...base, card("a"), card("b")], { active: MAX_ARRIVALS - 1 });
    expect(r.inView).toHaveLength(1);
    expect(r.overflow).toHaveLength(1);
  });

  test("opening an initiative whose plan wasn't read doesn't make its cards arrive", () => {
    const prev = run(null, [...base, card("init2", 0, 0, "org", "initiative")], {
      unloaded: new Set(["init2"]),
    }).next;
    // Data lands in the same render that the plan stops being unread...
    const landing = run(prev, [...base, card("init2", 0, 0, "org", "initiative"), card("x1", 100, 100, "init2")]);
    expect(landing.inView).toEqual([]);
    expect(landing.offView).toEqual([]);
    // ...and the next refetch adding one is live.
    const next = run(landing.next, [
      ...base,
      card("init2", 0, 0, "org", "initiative"),
      card("x1", 100, 100, "init2"),
      card("x2", 400, 100, "init2"),
    ]);
    expect(next.inView.map((a) => a.id)).toEqual(["x2"]);
  });

  test("a newly read brainstorm tree doesn't arrive, but its later answers do", () => {
    const q = card("q", 100, 100, "q", "question");
    const prev = run(null, [...base, q], { unloaded: new Set(["q"]) }).next;
    const loaded = run(prev, [...base, q, card("q/a", 400, 100, "q", "option")]);
    expect(loaded.inView).toEqual([]);
    const more = run(loaded.next, [
      ...base,
      q,
      card("q/a", 400, 100, "q", "option"),
      card("q/b", 400, 250, "q", "option"),
    ]);
    expect(more.inView.map((a) => a.id)).toEqual(["q/b"]);
  });

  test("children of a card that just arrived are part of it, not arrivals of their own", () => {
    const r = run(baseline(), [...base, card("m2", 300, 300), card("f1", 320, 320, "m2", "feature")]);
    expect(r.inView.map((a) => a.id)).toEqual(["m2"]);
    expect(r.offView).toEqual([]);
  });

  test("a new initiative at the top level arrives", () => {
    const r = run(baseline(), [...base, card("init3", 200, 200, "org", "initiative")]);
    expect(r.inView.map((a) => a.id)).toEqual(["init3"]);
  });
});

describe("viewRect", () => {
  test("is the world the camera shows", () => {
    expect(viewRect({ cx: 500, cy: 400, z: 2 }, { w: 1000, h: 800 })).toEqual({ x: 250, y: 200, w: 500, h: 400 });
  });
});
