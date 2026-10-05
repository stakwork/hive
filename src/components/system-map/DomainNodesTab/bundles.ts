/**
 * Endpoint bundles: the System Map ↔ Endpoint links folded into one group
 * per pair of nodes that meet on the same endpoints —
 *
 *   Component1 ─CALLS→ [20 endpoints] ←EXPOSES─ Component2
 *
 * — and one per node + edge type for endpoints no other System Map node
 * touches (`Component1 ─EXPOSES→ [10 endpoints]`). Works for any node and
 * edge type (Principal CALLS …, Component EXPOSES …).
 */

import type { SystemMapEndpointLink } from "@/types/system-map";

export interface BundleSide {
  node: string;
  edgeType: string;
  direction: "out" | "in";
}

export interface EndpointBundle {
  /** `bundle:` + the sides — never collides with a ref_id. */
  id: string;
  from: BundleSide;
  /** The node on the other side of the endpoints; null when no other System Map node links them. */
  to: BundleSide | null;
  /** Endpoint ref_ids, in link order. */
  endpoints: string[];
}

export const BUNDLE_ID_PREFIX = "bundle:";

/**
 * Edge types that mean "this node serves the endpoint". In a pair the
 * serving side is drawn on the right, so the bundle reads caller → callee.
 */
const PROVIDER_EDGE_TYPES = new Set(["EXPOSES", "SERVES", "IMPLEMENTS", "HANDLES", "PROVIDES", "HOSTS"]);

function sideKey(side: BundleSide): string {
  return `${side.node}|${side.edgeType}|${side.direction}`;
}

function isProvider(side: BundleSide): boolean {
  return PROVIDER_EDGE_TYPES.has(side.edgeType.toUpperCase());
}

/** Caller first, provider second; otherwise a stable order so A/B and B/A are one bundle. */
function orient(a: BundleSide, b: BundleSide): [BundleSide, BundleSide] {
  const pa = isProvider(a);
  const pb = isProvider(b);
  if (pa !== pb) return pa ? [b, a] : [a, b];
  return sideKey(a) <= sideKey(b) ? [a, b] : [b, a];
}

export function buildEndpointBundles(links: SystemMapEndpointLink[]): EndpointBundle[] {
  const sidesByEndpoint = new Map<string, Map<string, BundleSide>>();
  for (const link of links) {
    const side: BundleSide = { node: link.node, edgeType: link.edgeType, direction: link.direction };
    const sides = sidesByEndpoint.get(link.endpoint) ?? new Map<string, BundleSide>();
    sides.set(sideKey(side), side);
    sidesByEndpoint.set(link.endpoint, sides);
  }

  const bundles = new Map<string, EndpointBundle>();
  const add = (from: BundleSide, to: BundleSide | null, endpoint: string) => {
    const id = `${BUNDLE_ID_PREFIX}${sideKey(from)}>${to ? sideKey(to) : ""}`;
    const bundle = bundles.get(id) ?? { id, from, to, endpoints: [] };
    if (!bundle.endpoints.includes(endpoint)) bundle.endpoints.push(endpoint);
    bundles.set(id, bundle);
  };

  for (const [endpoint, sideMap] of sidesByEndpoint) {
    const sides = [...sideMap.values()];
    const nodes = new Set(sides.map((side) => side.node));
    if (nodes.size === 1) {
      for (const side of sides) add(side, null, endpoint);
      continue;
    }
    for (let i = 0; i < sides.length; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        if (sides[i].node === sides[j].node) continue;
        const [from, to] = orient(sides[i], sides[j]);
        add(from, to, endpoint);
      }
    }
  }

  return [...bundles.values()].sort((a, b) => b.endpoints.length - a.endpoints.length || a.id.localeCompare(b.id));
}

/** `CALLS · 20 · EXPOSES`, or `EXPOSES · 10` for a one-sided bundle. */
export function bundleLabel(bundle: EndpointBundle): string {
  const count = String(bundle.endpoints.length);
  return bundle.to ? `${bundle.from.edgeType} · ${count} · ${bundle.to.edgeType}` : `${bundle.from.edgeType} · ${count}`;
}

export function isBundleId(id: string): boolean {
  return id.startsWith(BUNDLE_ID_PREFIX);
}
