import { describe, it, expect } from "vitest";
import { parseScope, isLiveId, ROOT_REF } from "@/lib/canvas/scope";

describe("parseScope", () => {
  it("treats the empty string as the root canvas", () => {
    expect(parseScope(ROOT_REF)).toEqual({ kind: "root" });
    expect(parseScope("")).toEqual({ kind: "root" });
  });

  it("parses a node: prefix into an authored-sub scope", () => {
    expect(parseScope("node:abc123")).toEqual({
      kind: "authored",
      nodeId: "abc123",
    });
  });

  it("parses a ws: prefix into a workspace scope", () => {
    expect(parseScope("ws:cuid_xyz")).toEqual({
      kind: "workspace",
      workspaceId: "cuid_xyz",
    });
  });

  it("parses a feature: prefix into a feature scope", () => {
    expect(parseScope("feature:fuid_1")).toEqual({
      kind: "feature",
      featureId: "fuid_1",
    });
  });

  it("treats unknown refs as opaque (preserves pre-projection behavior)", () => {
    expect(parseScope("legacy-sub-canvas")).toEqual({
      kind: "opaque",
      ref: "legacy-sub-canvas",
    });
  });

  it("treats empty-body prefixed refs as opaque, not invalid", () => {
    // A bare `ws:` with no id doesn't address a workspace. Rather than
    // throwing (which would break the REST route), we store it opaque.
    expect(parseScope("ws:")).toEqual({ kind: "opaque", ref: "ws:" });
    expect(parseScope("node:")).toEqual({ kind: "opaque", ref: "node:" });
  });
});

describe("isLiveId", () => {
  it("recognizes the ws: prefix as a live id", () => {
    expect(isLiveId("ws:abc")).toBe(true);
  });

  it("recognizes the feature: prefix as a live id", () => {
    expect(isLiveId("feature:xyz")).toBe(true);
  });

  it("recognizes the repo: prefix as a live id", () => {
    expect(isLiveId("repo:abc")).toBe(true);
  });

  it("treats unprefixed ids as authored", () => {
    expect(isLiveId("some-random-id")).toBe(false);
    expect(isLiveId("nd_1234")).toBe(false);
  });

  it("does not treat the node: prefix as live (authored-sub scope, not an entity)", () => {
    // `node:<id>` is a SCOPE prefix, not a LIVE-ID prefix. Authored
    // nodes themselves don't carry it.
    expect(isLiveId("node:abc")).toBe(false);
  });
});
