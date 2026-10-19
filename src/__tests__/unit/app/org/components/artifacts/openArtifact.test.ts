import { describe, it, expect } from "vitest";
import { treeDeskHref } from "@/app/org/[githubLogin]/_components/artifacts/openArtifact";
import { brainstormBoardHref } from "@/app/org/[githubLogin]/_components/artifacts/viewers/graph";
import { openingFocus } from "@/app/org/[githubLogin]/_components/brainstorm-board/opening";

const ref = (kind: string, id: string) => ({ kind, id }) as never;

describe("brainstormBoardHref", () => {
  it("names the workspace and root", () => {
    expect(brainstormBoardHref("acme", "ws1", "r1")).toBe("/org/acme?view=canvas&tab=brainstorm&ws=ws1&root=r1");
  });
  it("adds node when given", () => {
    expect(brainstormBoardHref("acme", "ws1", "r1", "n1")).toBe(
      "/org/acme?view=canvas&tab=brainstorm&ws=ws1&root=r1&node=n1",
    );
  });
});

describe("treeDeskHref", () => {
  it("sends a tree card to the desk", () => {
    expect(treeDeskHref(ref("graph", "a"), { workspace: "w", focus: "f", layout: "tree" }, "acme")).toBe(
      brainstormBoardHref("acme", "w", "f"),
    );
    expect(treeDeskHref(ref("graph", "job:brainstorm-tree"), { workspace: "w", focus: "f" }, "acme")).not.toBeNull();
  });
  it("sends a json tree to the desk", () => {
    const value = { workspace: "w", focus: "f", layout: "tree" };
    expect(treeDeskHref(ref("json", "x"), { value }, "acme")).toBe(brainstormBoardHref("acme", "w", "f"));
  });
  it("leaves non-tree graphs and other kinds to the panel", () => {
    expect(treeDeskHref(ref("graph", "g"), { workspace: "w", focus: "f" }, "acme")).toBeNull();
    expect(treeDeskHref(ref("markdown", "brainstorm"), { text: "x" }, "acme")).toBeNull();
  });
  it("falls back to the panel without content, focus or login", () => {
    expect(treeDeskHref(ref("graph", "brainstorm-tree"), null, "acme")).toBeNull();
    expect(treeDeskHref(ref("graph", "g"), { workspace: "w", layout: "tree" }, "acme")).toBeNull();
    expect(treeDeskHref(ref("graph", "g"), { workspace: "w", focus: "f", layout: "tree" }, "")).toBeNull();
  });
});

describe("openingFocus", () => {
  const blocks = new Set(["b1"]);
  const isBlock = (k: string) => blocks.has(k);
  const blockOf = (id: string) => (id === "c1" || id === "b1" ? "b1" : undefined);
  it("focuses a root", () => {
    expect(openingFocus("b1", null, isBlock, blockOf)).toEqual({ kind: "block", key: "b1" });
  });
  it("points at a node of the root", () => {
    expect(openingFocus("b1", "c1", isBlock, blockOf)).toEqual({ kind: "block", key: "b1", card: "c1" });
  });
  it("focuses the block of a card given as root", () => {
    expect(openingFocus("c1", null, isBlock, blockOf)).toEqual({ kind: "block", key: "b1", card: "c1" });
  });
  it("fits for unknown or missing", () => {
    expect(openingFocus("zzz", null, isBlock, blockOf)).toEqual({ kind: "fit" });
    expect(openingFocus(null, null, isBlock, blockOf)).toEqual({ kind: "fit" });
  });
});
