import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { findBrainstormCard, treeOf } from "@/app/org/[githubLogin]/_components/artifacts/openArtifact";
import { brainstormCardHref, brainstormHref } from "@/app/org/[githubLogin]/_components/artifacts/viewers/graph";

const ref = (kind: string, id: string) => ({ kind, id }) as never;

describe("brainstorm hrefs", () => {
  it("names a brainstorm by workspace and root", () => {
    expect(brainstormHref("acme", "ws1", "r1")).toBe("/org/acme?view=canvas&tab=brainstorm&ws=ws1&root=r1");
  });
  it("opens the card a brainstorm is about, with the tree unfolded", () => {
    expect(brainstormCardHref("acme", "f1", "r1")).toBe("/org/acme?view=canvas&tab=brainstorm&at=f1&tree=r1");
  });
});

describe("treeOf", () => {
  it("reads a tree card's workspace and focus", () => {
    expect(treeOf(ref("graph", "a"), { workspace: "w", focus: "f", layout: "tree" })).toEqual({
      workspace: "w",
      focus: "f",
    });
    expect(treeOf(ref("graph", "job:brainstorm-tree"), { workspace: "w", focus: "f" })).not.toBeNull();
  });
  it("reads a json tree", () => {
    const value = { workspace: "w", focus: "f", layout: "tree" };
    expect(treeOf(ref("json", "x"), { value })).toEqual({ workspace: "w", focus: "f" });
  });
  it("leaves non-tree graphs, other kinds and unread content to the panel", () => {
    expect(treeOf(ref("graph", "g"), { workspace: "w", focus: "f" })).toBeNull();
    expect(treeOf(ref("markdown", "brainstorm"), { text: "x" })).toBeNull();
    expect(treeOf(ref("graph", "brainstorm-tree"), null)).toBeNull();
    expect(treeOf(ref("graph", "g"), { workspace: "w", layout: "tree" })).toBeNull();
  });
});

describe("findBrainstormCard", () => {
  const respond = (body: unknown, ok = true) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => body })),
    );

  it("finds the card the root question is about", async () => {
    respond({
      nodes: [
        { ref_id: "r1", type: "Question", about: "f1" },
        { ref_id: "o1", type: "Option" },
      ],
      edges: [],
    });
    expect(await findBrainstormCard(new QueryClient(), "w", "r1")).toEqual({ card: "f1", root: "r1" });
  });
  it("is null for a brainstorm about no card, or a failed read", async () => {
    respond({ nodes: [{ ref_id: "r1", type: "Question" }], edges: [] });
    expect(await findBrainstormCard(new QueryClient(), "w", "r1")).toBeNull();
    respond({}, false);
    expect(
      await findBrainstormCard(new QueryClient({ defaultOptions: { queries: { retry: false } } }), "w", "r1"),
    ).toBeNull();
  });
});
