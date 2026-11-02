import type { SystemMapFinding } from "@/types/system-map";

export const FINDING_KIND_FILTERS = ["all", "code", "dependency", "config", "unspecified"] as const;
export type FindingKindFilter = (typeof FINDING_KIND_FILTERS)[number];

export const FINDING_KIND_LABELS: Record<FindingKindFilter, string> = {
  all: "All",
  code: "Code",
  dependency: "Dependency",
  config: "Config",
  unspecified: "Unspecified",
};

/** Parses the `?kind=` query value; anything unknown (or "all") is "all". */
export function parseKindFilter(value: string | null | undefined): FindingKindFilter {
  return (FINDING_KIND_FILTERS as readonly string[]).includes(value ?? "") ? (value as FindingKindFilter) : "all";
}

export function matchesKind(finding: Pick<SystemMapFinding, "kind">, filter: FindingKindFilter): boolean {
  if (filter === "all") return true;
  const kind = finding.kind?.trim().toLowerCase() || null;
  return filter === "unspecified" ? kind === null : kind === filter;
}

export function countByKind(findings: Pick<SystemMapFinding, "kind">[]): Record<FindingKindFilter, number> {
  const counts = { all: findings.length, code: 0, dependency: 0, config: 0, unspecified: 0 };
  for (const f of findings) {
    for (const key of ["code", "dependency", "config", "unspecified"] as const) {
      if (matchesKind(f, key)) counts[key]++;
    }
  }
  return counts;
}
