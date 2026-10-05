import { describe, expect, it } from "vitest";
import { buildEndpointBundles, bundleLabel } from "@/components/system-map/DomainNodesTab/bundles";
import type { SystemMapEndpointLink } from "@/types/system-map";

function link(node: string, edgeType: string, endpoint: string, direction: "out" | "in" = "out"): SystemMapEndpointLink {
  return { node, edgeType, endpoint, direction };
}

describe("buildEndpointBundles", () => {
  it("bundles the endpoints one component calls and another exposes, caller first", () => {
    const links = [
      // c2 exposes e1..e3; c1 calls e1, e2 and exposes e9 alone.
      link("c2", "EXPOSES", "e1"),
      link("c2", "EXPOSES", "e2"),
      link("c2", "EXPOSES", "e3"),
      link("c1", "CALLS", "e1"),
      link("c1", "CALLS", "e2"),
      link("c1", "EXPOSES", "e9"),
    ];

    const bundles = buildEndpointBundles(links);

    expect(bundles.map((b) => ({ label: bundleLabel(b), from: b.from.node, to: b.to?.node ?? null, endpoints: b.endpoints }))).toEqual([
      { label: "CALLS · 2 · EXPOSES", from: "c1", to: "c2", endpoints: ["e1", "e2"] },
      { label: "EXPOSES · 1", from: "c1", to: null, endpoints: ["e9"] },
      { label: "EXPOSES · 1", from: "c2", to: null, endpoints: ["e3"] },
    ]);
  });

  it("works for any node and edge type, e.g. a principal calling an exposed endpoint", () => {
    const bundles = buildEndpointBundles([link("svc", "EXPOSES", "e1"), link("user", "CALLS", "e1")]);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].from).toEqual({ node: "user", edgeType: "CALLS", direction: "out" });
    expect(bundles[0].to).toEqual({ node: "svc", edgeType: "EXPOSES", direction: "out" });
  });

  it("pairs every node meeting on an endpoint, and keeps one bundle per pair regardless of link order", () => {
    const bundles = buildEndpointBundles([
      link("a", "CALLS", "e1"),
      link("b", "CALLS", "e1"),
      link("b", "CALLS", "e2"),
      link("a", "CALLS", "e2"),
      link("c", "EXPOSES", "e1"),
    ]);

    const labels = bundles.map((b) => `${b.from.node}>${b.to?.node}:${b.endpoints.join(",")}`).sort();
    expect(labels).toEqual(["a>b:e1,e2", "a>c:e1", "b>c:e1"]);
  });

  it("does not pair a node with itself", () => {
    const bundles = buildEndpointBundles([link("a", "CALLS", "e1"), link("a", "EXPOSES", "e1")]);

    expect(bundles.map((b) => [b.from.edgeType, b.to])).toEqual([
      ["CALLS", null],
      ["EXPOSES", null],
    ]);
  });
});
