/**
 * The Domain nodes tab's Dependencies view, as data: the `SysPackage`
 * nodes and their package → package `DEPENDS_ON` edges, with what each
 * one uses, what uses it, everything it pulls in, and the shortest chain
 * from a direct package to it ("why is this here?").
 *
 * The graph does not mark direct dependencies (a component `DEPENDS_ON`
 * every package of its lockfiles), so "direct" here means no other
 * package depends on it.
 */

import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";
import { PACKAGE_TYPE } from "./architecture";

export interface PackageRow {
  node: SystemMapDomainNode;
  version: string;
  ecosystem: string;
  /** Where it was read from (`source_path`, repo-relative), or "unknown". */
  source: string;
  usedBy: string[];
  dependsOn: string[];
  /** Non-package nodes that point at it (the lockfile that CONTAINS it, the component that DEPENDS_ON it). */
  declaredBy: { refId: string; edgeType: string }[];
  direct: boolean;
  /** How many packages share its name (2+ means several versions). */
  versions: number;
}

export interface DependencyModel {
  packages: PackageRow[];
  byRef: Map<string, PackageRow>;
  sources: { source: string; count: number }[];
  directCount: number;
  /** Package names present in more than one version. */
  multiVersionNames: number;
  maxUsedBy: number;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The file a package was read from, as the graph stores it (`stakwork/peel/Vendor/runner.Cargo.lock`). */
function sourcePath(node: SystemMapDomainNode): string {
  return str(node.properties.source_path) || "unknown";
}

export function buildDependencies(nodes: SystemMapDomainNode[], edges: SystemMapDomainEdge[]): DependencyModel {
  const packages = nodes.filter((n) => n.type === PACKAGE_TYPE);
  const ids = new Set(packages.map((p) => p.refId));
  const allIds = new Set(nodes.map((n) => n.refId));
  const usedBy = new Map<string, string[]>();
  const dependsOn = new Map<string, string[]>();
  const declaredBy = new Map<string, { refId: string; edgeType: string }[]>();
  for (const e of edges) {
    if (!ids.has(e.target) || !allIds.has(e.source)) continue;
    if (ids.has(e.source)) {
      usedBy.set(e.target, [...(usedBy.get(e.target) ?? []), e.source]);
      dependsOn.set(e.source, [...(dependsOn.get(e.source) ?? []), e.target]);
    } else {
      declaredBy.set(e.target, [...(declaredBy.get(e.target) ?? []), { refId: e.source, edgeType: e.edgeType }]);
    }
  }
  const nameCount = new Map<string, number>();
  for (const p of packages) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);

  const rows: PackageRow[] = packages.map((node) => ({
    node,
    version: str(node.properties.version),
    ecosystem: str(node.properties.ecosystem),
    source: sourcePath(node),
    usedBy: usedBy.get(node.refId) ?? [],
    dependsOn: dependsOn.get(node.refId) ?? [],
    declaredBy: declaredBy.get(node.refId) ?? [],
    direct: (usedBy.get(node.refId) ?? []).length === 0,
    versions: nameCount.get(node.name) ?? 1,
  }));

  const sourceCount = new Map<string, number>();
  for (const r of rows) sourceCount.set(r.source, (sourceCount.get(r.source) ?? 0) + 1);

  return {
    packages: rows,
    byRef: new Map(rows.map((r) => [r.node.refId, r])),
    sources: [...sourceCount.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    directCount: rows.filter((r) => r.direct).length,
    multiVersionNames: [...nameCount.values()].filter((c) => c > 1).length,
    maxUsedBy: rows.reduce((m, r) => Math.max(m, r.usedBy.length), 0),
  };
}

/** Every package `refId` pulls in, directly or not. Memoised per model by the caller. */
export function pullsIn(model: DependencyModel, refId: string, cache?: Map<string, number>): number {
  const cached = cache?.get(refId);
  if (cached !== undefined) return cached;
  const seen = new Set<string>();
  const stack = [...(model.byRef.get(refId)?.dependsOn ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(model.byRef.get(id)?.dependsOn ?? []));
  }
  cache?.set(refId, seen.size);
  return seen.size;
}

/**
 * The shortest chain of package refIds from a direct package down to
 * `refId` (both ends included), or null when there is none (a cycle).
 */
export function whyChain(model: DependencyModel, refId: string): string[] | null {
  const start = model.byRef.get(refId);
  if (!start) return null;
  if (start.direct) return [refId];
  const next = new Map<string, string | null>([[refId, null]]);
  const queue = [refId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const up of model.byRef.get(id)?.usedBy ?? []) {
      if (next.has(up)) continue;
      next.set(up, id);
      if (model.byRef.get(up)?.direct) {
        const chain = [up];
        let cur: string | null = id;
        while (cur !== null) {
          chain.push(cur);
          cur = next.get(cur) ?? null;
        }
        return chain;
      }
      queue.push(up);
    }
  }
  return null;
}
