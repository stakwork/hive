import { describe, expect, it } from "vitest";
import { keepPlaced } from "@/app/org/[githubLogin]/_components/brainstorm-board/layout";

const tree = (ids: string[], links: Array<[string, string]>) =>
  ({
    items: ids.map((id) => ({ id })),
    links: links.map(([source, target]) => ({ source, target })),
  }) as never;

describe("keepPlaced", () => {
  it("is the fresh layout when nothing is placed", () => {
    const fresh = { a: { x: 0, y: 0 }, b: { x: 300, y: 10 } };
    expect(keepPlaced(tree(["a", "b"], [["a", "b"]]), fresh, {})).toEqual(fresh);
  });

  it("keeps placed cards and puts a new one beside its parent", () => {
    const prev = { a: { x: 5, y: 50 }, b: { x: 305, y: 50 } };
    const fresh = { a: { x: 0, y: 0 }, b: { x: 300, y: -40 }, c: { x: 300, y: 40 } };
    const out = keepPlaced(tree(["a", "b", "c"], [["a", "b"], ["a", "c"]]), fresh, prev);
    expect(out.a).toEqual(prev.a);
    expect(out.b).toEqual(prev.b);
    expect(out.c).toEqual({ x: 305, y: 90 });
  });

  it("never remembers transient cards", () => {
    const prev = { a: { x: 0, y: 0 }, "slot:a": { x: 9, y: 9 } };
    const fresh = { a: { x: 0, y: 0 }, "slot:a": { x: 300, y: 70 } };
    const out = keepPlaced(tree(["a", "slot:a"], [["a", "slot:a"]]), fresh, prev, (id) => id.startsWith("slot:"));
    expect(out["slot:a"]).toEqual({ x: 300, y: 70 });
  });
});
