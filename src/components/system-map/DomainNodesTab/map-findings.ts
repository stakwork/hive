/**
 * Findings on the Map view, as data: where each infosec `Finding` lands on
 * the map, without a read per finding.
 *
 * - A component's name is its repo path (`stakwork/peel/brain`), so a
 *   finding's `file` (`stakwork/peel/brain/src/db.rs`) belongs to the
 *   component with the longest name that prefixes it.
 * - A node whose `source_path` is the finding's file (an interface, an
 *   artifact declared there) is on the spot too.
 * - Once a finding's related nodes are read (one call, on click), every one
 *   that is on the map or the package board is highlighted, a related
 *   code file adds its component the same way the finding's own file does,
 *   and a package adds the components that depend on it.
 * - A finding about a package (a CVE) also gets its path into the system,
 *   component first (`findingPackagePaths`), shown in its panel: the one the
 *   related read walked in jarvis, else one built from the packages read
 *   here. Packages stay on the board, which opens only when asked.
 */

import type { SystemMapFinding, SystemMapFindingPathStep, SystemMapFindingRelated } from "@/types/system-map";
import { pathStepLabel } from "@/components/system-map/FindingsTab/FindingPaths";
import { PACKAGE_TYPE } from "./architecture";
import type { MapModel } from "./map-layout";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

export function findingSeverityRank(severity: string | null | undefined): number {
  const index = severity ? SEVERITY_ORDER.indexOf(severity.toLowerCase()) : -1;
  return index === -1 ? SEVERITY_ORDER.length : index;
}

export const FINDING_SEVERITY_COLOR: Record<string, string> = {
  critical: "#b91c1c",
  high: "#ea580c",
  medium: "#d97706",
  low: "#0284c7",
  info: "#6b7280",
};
export function findingColor(severity: string | null | undefined): string {
  return FINDING_SEVERITY_COLOR[severity?.toLowerCase() ?? ""] ?? "#6b7280";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalisePath(path: string): string {
  return path.replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

export interface MapFindingIndex {
  /** Component refId → the findings whose file is in it, worst first. */
  byComponent: Map<string, SystemMapFinding[]>;
  /** Finding refId → the map nodes it lands on without a read (its component, nodes declared in its file). */
  anchors: Map<string, string[]>;
  /** Findings that land nowhere on the map. */
  unplaced: number;
}

/** The components on the map, longest name first, for prefix matching. */
function componentPaths(model: MapModel): { id: string; path: string }[] {
  return [...model.nodes.values()]
    .filter((n) => n.node.type === "SysComponent")
    .map((n) => ({ id: n.node.refId, path: normalisePath(n.node.name) }))
    .filter((c) => c.path.includes("/"))
    .sort((a, b) => b.path.length - a.path.length);
}

/** The component a repo path belongs to: the one with the longest name that prefixes it. */
export function componentForPath(path: string | null, components: { id: string; path: string }[]): string | null {
  if (!path) return null;
  const p = normalisePath(path);
  return components.find((c) => p === c.path || p.startsWith(`${c.path}/`))?.id ?? null;
}

export function buildMapFindingIndex(findings: SystemMapFinding[], model: MapModel): MapFindingIndex {
  const components = componentPaths(model);
  const bySourcePath = new Map<string, string[]>();
  for (const n of model.nodes.values()) {
    const source = str(n.node.properties.source_path);
    if (!source) continue;
    const key = normalisePath(source);
    bySourcePath.set(key, [...(bySourcePath.get(key) ?? []), n.node.refId]);
  }

  const byComponent = new Map<string, SystemMapFinding[]>();
  const anchors = new Map<string, string[]>();
  let unplaced = 0;
  for (const finding of findings) {
    const ids = new Set<string>();
    const component = componentForPath(finding.file, components);
    if (component) {
      ids.add(component);
      byComponent.set(component, [...(byComponent.get(component) ?? []), finding]);
    }
    if (finding.file) for (const id of bySourcePath.get(normalisePath(finding.file)) ?? []) ids.add(id);
    if (ids.size === 0) unplaced++;
    anchors.set(finding.refId, [...ids]);
  }
  for (const list of byComponent.values()) {
    list.sort((a, b) => findingSeverityRank(a.severity) - findingSeverityRank(b.severity));
  }
  return { byComponent, anchors, unplaced };
}

export interface FindingHighlight {
  /** Map nodes and package chips to light up. */
  ids: Set<string>;
  /** Related nodes that are not on the map (code, the CWE, …). */
  offMap: SystemMapFindingRelated[];
}

/** What to light for one finding: its anchors, plus its related nodes once they are read. */
export function findingHighlight(
  finding: SystemMapFinding,
  index: MapFindingIndex,
  model: MapModel,
  related: SystemMapFindingRelated[] | null,
): FindingHighlight {
  const ids = new Set(index.anchors.get(finding.refId) ?? []);
  const offMap: SystemMapFindingRelated[] = [];
  const components = related ? componentPaths(model) : [];
  for (const r of related ?? []) {
    if (model.nodes.has(r.refId) || model.chips.has(r.refId)) {
      ids.add(r.refId);
      continue;
    }
    offMap.push(r);
    const component = componentForPath(r.file ?? str(r.properties.file) ?? str(r.properties.source_path), components);
    if (component) ids.add(component);
  }
  // A package on the board lights the components that depend on it.
  for (const id of [...ids]) for (const owner of model.chips.get(id)?.usedBy ?? []) ids.add(owner);
  return { ids, offMap };
}

export interface PathStep {
  id: string;
  label: string;
  kind: "component" | "package";
  /** On the map or the package board, so it can be lit and opened. */
  placed: boolean;
}

const MAX_PATHS = 3;

/**
 * For a finding about a package (a CVE): how the package gets into the system,
 * component first — `stakwork/staklink → express@4.21.2 → proxy-addr@2.0.7`.
 * `walked` (from the related read) wins. Otherwise, with packages read, each
 * path runs from a component through the direct package down the dependency
 * chain (shortest first); without them, it is the finding's component and the
 * package alone.
 */
export function findingPackagePaths(
  finding: SystemMapFinding,
  index: MapFindingIndex,
  model: MapModel,
  related: SystemMapFindingRelated[] | null,
  walked: SystemMapFindingPathStep[][] = [],
): PathStep[][] {
  if (walked.length) {
    return walked.slice(0, MAX_PATHS).map((path) =>
      path.map((step) => ({
        id: step.refId,
        label: step.nodeType === "SysComponent" ? step.name : pathStepLabel(step),
        kind: step.nodeType === "SysComponent" ? "component" : "package",
        placed: model.nodes.has(step.refId) || model.chips.has(step.refId),
      })),
    );
  }
  const component = (id: string): PathStep => ({
    id,
    label: model.nodes.get(id)?.node.name ?? id,
    kind: "component",
    placed: model.nodes.has(id),
  });
  const chip = (id: string): PathStep => {
    const c = model.chips.get(id)!;
    return { id, label: `${c.name}${c.version ? `@${c.version}` : ""}`, kind: "package", placed: true };
  };
  const ownComponents = (index.anchors.get(finding.refId) ?? []).filter(
    (id) => model.nodes.get(id)?.node.type === "SysComponent",
  );
  const paths: PathStep[][] = [];
  for (const r of related ?? []) {
    if (r.nodeType !== PACKAGE_TYPE && !model.chips.has(r.refId)) continue;
    if (!model.chips.has(r.refId)) {
      const version = str(r.properties.version);
      const pkg: PathStep = {
        id: r.refId,
        label: `${r.name}${version && !r.name.includes("@") ? `@${version}` : ""}`,
        kind: "package",
        placed: false,
      };
      paths.push([...ownComponents.slice(0, 1).map(component), pkg]);
      continue;
    }
    const chains = model
      .pathsToRoots(r.refId)
      .sort((a, b) => a.length - b.length)
      .slice(0, MAX_PATHS);
    for (const chain of chains) {
      const owners = model.chips.get(chain[0])?.usedBy ?? [];
      const owner = owners.find((id) => ownComponents.includes(id)) ?? owners[0] ?? ownComponents[0];
      paths.push([...(owner ? [component(owner)] : []), ...chain.map(chip)]);
    }
  }
  return paths.slice(0, MAX_PATHS);
}
