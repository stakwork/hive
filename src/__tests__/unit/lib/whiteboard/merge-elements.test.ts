import { describe, it, expect } from "vitest";
import { mergeElementsByVersion } from "@/lib/whiteboard/merge-elements";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

function el(
  id: string,
  version: number,
  isDeleted = false,
): ExcalidrawElement {
  return {
    id,
    version,
    isDeleted,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    versionNonce: 1,
    isDeleted,
    index: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
  } as unknown as ExcalidrawElement;
}

describe("mergeElementsByVersion", () => {
  it("tombstone survives an unrelated delta", () => {
    const local = [el("X", 2, true), el("Y", 1)];
    const remoteDelta = [el("Y", 2)];

    const result = mergeElementsByVersion(local, remoteDelta);
    const ids = result.map((e) => e.id);

    expect(ids).toContain("X");
    const x = result.find((e) => e.id === "X")!;
    expect(x.isDeleted).toBe(true);
    expect(x.version).toBe(2);
  });

  it("tombstone survives N sequential deltas that never mention X", () => {
    let state: readonly ExcalidrawElement[] = [el("X", 2, true), el("Y", 1)];

    for (let i = 2; i <= 5; i++) {
      state = mergeElementsByVersion(state, [el("Y", i)]);
    }

    const x = state.find((e) => e.id === "X");
    expect(x).toBeDefined();
    expect(x!.isDeleted).toBe(true);
  });

  it("self-heal: tombstone survives full-sync where DB has lost it (empty remote)", () => {
    const local = [el("X", 2, true)];
    const remoteEmpty: ExcalidrawElement[] = [];

    const result = mergeElementsByVersion(local, remoteEmpty);
    const x = result.find((e) => e.id === "X");

    expect(x).toBeDefined();
    expect(x!.isDeleted).toBe(true);
  });

  it("resurrection blocked: local tombstone beats remote alive element even at higher version", () => {
    const local = [el("X", 1, true)];
    const remote = [el("X", 2, false)];

    const result = mergeElementsByVersion(local, remote);
    const x = result.find((e) => e.id === "X")!;

    expect(x.isDeleted).toBe(true);
  });

  it("remote tombstone applied: local alive element is tombstoned by higher-version remote delete", () => {
    const local = [el("X", 1, false)];
    const remote = [el("X", 2, true)];

    const result = mergeElementsByVersion(local, remote);
    const x = result.find((e) => e.id === "X")!;

    expect(x.isDeleted).toBe(true);
    expect(x.version).toBe(2);
  });
});
