// @vitest-environment node

import { describe, it, expect } from "vitest";
import {
  parseUrn,
  formatUrn,
  encodeCanvasRef,
  decodeCanvasRef,
  composeCanvasId,
  parseCanvasId,
  type ParsedUrn,
} from "@/lib/urn/parse";

describe("parseUrn", () => {
  it("parses a pg URN", () => {
    expect(parseUrn("urn:myorg:pg:feature:abc")).toEqual({
      realm: "pg",
      org: "myorg",
      type: "feature",
      id: "abc",
    });
  });

  it("parses a canvas URN", () => {
    expect(parseUrn("urn:myorg:canvas:note:ws~clm123.node456")).toEqual({
      realm: "canvas",
      org: "myorg",
      type: "note",
      id: "ws~clm123.node456",
    });
  });

  it("parses a kg URN", () => {
    expect(parseUrn("urn:myorg:kg:myws:concept:abc")).toEqual({
      realm: "kg",
      org: "myorg",
      workspace: "myws",
      type: "concept",
      id: "abc",
    });
  });

  it("returns null for missing urn: prefix", () => {
    expect(parseUrn("pg:feature:abc")).toBeNull();
  });

  it("returns null for completely invalid string", () => {
    expect(parseUrn("invalid")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseUrn("")).toBeNull();
  });

  it("returns null for unknown realm", () => {
    expect(parseUrn("urn:myorg:unknown:feature:abc")).toBeNull();
  });

  it("returns null for pg URN with wrong segment count (too many)", () => {
    expect(parseUrn("urn:myorg:pg:feature:abc:extra")).toBeNull();
  });

  it("returns null for pg URN with wrong segment count (too few)", () => {
    expect(parseUrn("urn:myorg:pg:feature")).toBeNull();
  });

  it("returns null for kg URN with wrong segment count (too few)", () => {
    expect(parseUrn("urn:myorg:kg:myws:concept")).toBeNull();
  });

  it("returns null for kg URN with wrong segment count (too many)", () => {
    expect(parseUrn("urn:myorg:kg:myws:concept:abc:extra")).toBeNull();
  });

  it("returns null for empty org segment", () => {
    expect(parseUrn("urn::pg:feature:abc")).toBeNull();
  });

  it("returns null for empty type segment", () => {
    expect(parseUrn("urn:myorg:pg::abc")).toBeNull();
  });

  it("returns null for empty id segment", () => {
    expect(parseUrn("urn:myorg:pg:feature:")).toBeNull();
  });

  it("returns null for empty realm segment", () => {
    expect(parseUrn("urn:myorg::feature:abc")).toBeNull();
  });
});

describe("formatUrn", () => {
  it("formats a pg URN", () => {
    const parts: ParsedUrn = { realm: "pg", org: "myorg", type: "feature", id: "abc" };
    expect(formatUrn(parts)).toBe("urn:myorg:pg:feature:abc");
  });

  it("formats a canvas URN", () => {
    const parts: ParsedUrn = { realm: "canvas", org: "myorg", type: "note", id: "ws~clm123.node456" };
    expect(formatUrn(parts)).toBe("urn:myorg:canvas:note:ws~clm123.node456");
  });

  it("formats a kg URN", () => {
    const parts: ParsedUrn = { realm: "kg", org: "myorg", workspace: "myws", type: "concept", id: "abc" };
    expect(formatUrn(parts)).toBe("urn:myorg:kg:myws:concept:abc");
  });
});

describe("parseUrn ↔ formatUrn roundtrip", () => {
  it("roundtrips a pg URN", () => {
    const urn = "urn:myorg:pg:initiative:cld123abc";
    const parsed = parseUrn(urn);
    expect(parsed).not.toBeNull();
    expect(formatUrn(parsed!)).toBe(urn);
  });

  it("roundtrips a canvas URN", () => {
    const urn = "urn:acme:canvas:note:ws~clm123.nodeabc";
    const parsed = parseUrn(urn);
    expect(parsed).not.toBeNull();
    expect(formatUrn(parsed!)).toBe(urn);
  });

  it("roundtrips a kg URN", () => {
    const urn = "urn:acme:kg:my-workspace:concept:xyz";
    const parsed = parseUrn(urn);
    expect(parsed).not.toBeNull();
    expect(formatUrn(parsed!)).toBe(urn);
  });
});

describe("canvas ref helpers", () => {
  describe("encodeCanvasRef / decodeCanvasRef", () => {
    it("encodes colons to tildes", () => {
      expect(encodeCanvasRef("ws:clm123")).toBe("ws~clm123");
    });

    it("encodes multiple colons", () => {
      expect(encodeCanvasRef("initiative:abc:extra")).toBe("initiative~abc~extra");
    });

    it("decodes tildes back to colons", () => {
      expect(decodeCanvasRef("ws~clm123")).toBe("ws:clm123");
    });

    it("roundtrips encode/decode", () => {
      const ref = "ws:clm123";
      expect(decodeCanvasRef(encodeCanvasRef(ref))).toBe(ref);
    });

    it("handles string with no colon (root canvas)", () => {
      expect(encodeCanvasRef("")).toBe("");
      expect(decodeCanvasRef("")).toBe("");
    });
  });

  describe("composeCanvasId", () => {
    it("composes ref and nodeId into compound id", () => {
      expect(composeCanvasId("ws:clm123", "node456")).toBe("ws~clm123.node456");
    });

    it("encodes the ref colons", () => {
      expect(composeCanvasId("initiative:abc", "xyz")).toBe("initiative~abc.xyz");
    });
  });

  describe("parseCanvasId", () => {
    it("parses a compound canvas id", () => {
      expect(parseCanvasId("ws~clm123.node456")).toEqual({
        ref: "ws:clm123",
        nodeId: "node456",
      });
    });

    it("splits on first dot only", () => {
      // nodeId itself won't contain dots but we verify first-dot semantics
      expect(parseCanvasId("initiative~abc.nodeXYZ")).toEqual({
        ref: "initiative:abc",
        nodeId: "nodeXYZ",
      });
    });

    it("returns null when no dot separator", () => {
      expect(parseCanvasId("ws~clm123")).toBeNull();
    });

    it("returns null when encodedRef is empty", () => {
      expect(parseCanvasId(".node456")).toBeNull();
    });

    it("returns null when nodeId is empty", () => {
      expect(parseCanvasId("ws~clm123.")).toBeNull();
    });

    it("roundtrips composeCanvasId → parseCanvasId", () => {
      const ref = "ws:clm123";
      const nodeId = "nodeABC";
      const compound = composeCanvasId(ref, nodeId);
      expect(parseCanvasId(compound)).toEqual({ ref, nodeId });
    });
  });
});
