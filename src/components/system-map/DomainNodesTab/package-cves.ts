/**
 * The `swarm-package-cve-findings` output, matched to the Dependencies
 * view's packages: `{ vulnerable_packages: [{ name, version, ecosystem,
 * purl, ref_id, source_path, severity, fixed_in, advisories, fetch_errors }] }`.
 *
 * A finding matches a package by `ref_id` (the `SysPackage` node), else by
 * `purl` (its `properties.id`), else by name, version and ecosystem.
 */

import type { PackageRow } from "./dependencies";

export interface PackageAdvisory {
  id: string;
  cves: string[];
  severity: string;
  cvssScore: number | null;
  kind: string;
  summary: string;
  fixedIn: string;
  url: string;
  published: string;
}

export interface VulnerablePackage {
  name: string;
  version: string;
  ecosystem: string;
  purl: string;
  refId: string;
  sourcePath: string;
  severity: string;
  fixedIn: string;
  advisories: PackageAdvisory[];
  fetchErrors: string[];
}

export interface PackageCveReport {
  /** When the run that produced it finished (or started, when unknown). */
  checkedAt: string;
  vulnerable: VulnerablePackage[];
  /** Package refId → its finding. */
  byPackage: Map<string, VulnerablePackage>;
  /** Findings that match no package in the graph as loaded. */
  unmatched: VulnerablePackage[];
}

/** Most severe first; anything else ranks after LOW. */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MODERATE", "MEDIUM", "LOW"];

export function severityRank(severity: string | undefined): number {
  if (!severity) return SEVERITY_ORDER.length + 1;
  const index = SEVERITY_ORDER.indexOf(severity.toUpperCase());
  return index === -1 ? SEVERITY_ORDER.length : index;
}

export const SEVERITY_STYLE: Record<string, { badge: string; row: string }> = {
  CRITICAL: { badge: "border-red-600/50 bg-red-600/15 text-red-700 dark:text-red-300", row: "bg-red-500/10" },
  HIGH: {
    badge: "border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-300",
    row: "bg-orange-500/10",
  },
  MODERATE: { badge: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300", row: "bg-amber-500/5" },
  MEDIUM: { badge: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300", row: "bg-amber-500/5" },
  LOW: { badge: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300", row: "" },
};
const UNKNOWN_STYLE = { badge: "border-muted-foreground/40 text-muted-foreground", row: "" };

export function severityStyle(severity: string): { badge: string; row: string } {
  return SEVERITY_STYLE[severity.toUpperCase()] ?? UNKNOWN_STYLE;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseAdvisory(raw: unknown): PackageAdvisory | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (!str(a.id)) return null;
  return {
    id: str(a.id),
    cves: strings(a.cves),
    severity: str(a.severity).toUpperCase(),
    cvssScore: typeof a.cvss_score === "number" ? a.cvss_score : null,
    kind: str(a.kind),
    summary: str(a.summary),
    fixedIn: str(a.fixed_in),
    url: str(a.url),
    published: str(a.published),
  };
}

function parseVulnerable(raw: unknown): VulnerablePackage | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!str(p.name) && !str(p.ref_id) && !str(p.purl)) return null;
  const advisories = Array.isArray(p.advisories)
    ? p.advisories.map(parseAdvisory).filter((a): a is PackageAdvisory => a !== null)
    : [];
  advisories.sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.cvssScore ?? 0) - (a.cvssScore ?? 0),
  );
  return {
    name: str(p.name),
    version: str(p.version),
    ecosystem: str(p.ecosystem),
    purl: str(p.purl),
    refId: str(p.ref_id),
    sourcePath: str(p.source_path),
    severity: (str(p.severity) || advisories[0]?.severity || "").toUpperCase(),
    fixedIn: str(p.fixed_in),
    advisories,
    fetchErrors: Array.isArray(p.fetch_errors)
      ? p.fetch_errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
      : [],
  };
}

/** The run output's vulnerable packages, or null when it is not this workflow's shape. */
export function parsePackageCves(output: unknown): VulnerablePackage[] | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const list = (output as Record<string, unknown>).vulnerable_packages;
  if (!Array.isArray(list)) return null;
  return list.map(parseVulnerable).filter((p): p is VulnerablePackage => p !== null);
}

function nameKey(name: string, version: string, ecosystem: string): string {
  return `${ecosystem.toLowerCase()}|${name}|${version}`;
}

/** Match a run's findings to the packages of the graph. */
export function matchPackageCves(
  vulnerable: VulnerablePackage[],
  packages: PackageRow[],
  checkedAt: string,
): PackageCveReport {
  const byRef = new Set(packages.map((p) => p.node.refId));
  const byPurl = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of packages) {
    const purl = str(p.node.properties.id);
    if (purl) byPurl.set(purl, p.node.refId);
    const key = nameKey(p.node.name, p.version, p.ecosystem);
    byName.set(key, [...(byName.get(key) ?? []), p.node.refId]);
  }

  const byPackage = new Map<string, VulnerablePackage>();
  const unmatched: VulnerablePackage[] = [];
  const assign = (refId: string, finding: VulnerablePackage) => {
    const current = byPackage.get(refId);
    if (!current || severityRank(finding.severity) < severityRank(current.severity)) byPackage.set(refId, finding);
  };
  for (const finding of vulnerable) {
    if (finding.refId && byRef.has(finding.refId)) {
      assign(finding.refId, finding);
      continue;
    }
    const viaPurl = finding.purl ? byPurl.get(finding.purl) : undefined;
    if (viaPurl) {
      assign(viaPurl, finding);
      continue;
    }
    const viaName = byName.get(nameKey(finding.name, finding.version, finding.ecosystem));
    if (viaName?.length) viaName.forEach((refId) => assign(refId, finding));
    else unmatched.push(finding);
  }
  return { checkedAt, vulnerable, byPackage, unmatched };
}
