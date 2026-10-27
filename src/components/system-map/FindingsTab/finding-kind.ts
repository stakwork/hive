/**
 * Which check a Finding came from (the CWE check or the package CVE check)
 * and what its card leads with: CVE ids and the vulnerable package, or its
 * CWE. The check is the node's `source_role` (`osv-package-scan` for the
 * CVE check), else inferred like the Fix does. Other property names are read
 * leniently, like `parseFinding`.
 */

import { classifyFinding } from "@/lib/system-map/finding-fix";
import type { SystemMapFinding } from "@/types/system-map";

/** The check a finding came from. */
export type FindingCheck = "cwe" | "cve";

export const CHECK_LABEL: Record<FindingCheck, string> = { cwe: "CWE check", cve: "CVE check" };

const CVE_SOURCE_RE = /osv|package|cve/i;

export interface FindingSummary {
  check: FindingCheck;
  /** CVE / advisory ids for a CVE-check finding; the CWE for a CWE-check one. */
  ids: string[];
  /** `name@version` of the vulnerable package. */
  pkg: string | null;
  fixedIn: string | null;
}

const CVE_ID_KEYS = ["cve_id", "cve", "cves", "advisory_id", "advisory", "advisories"];

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function first(p: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(p[key]);
    if (value) return value;
  }
  return null;
}

function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(idsOf);
  if (value && typeof value === "object") return idsOf((value as Record<string, unknown>).id);
  const s = str(value);
  return s ? s.split(/[,\s]+/).filter(Boolean) : [];
}

function cveIds(p: Record<string, unknown>): string[] {
  const ids = CVE_ID_KEYS.flatMap((key) => idsOf(p[key]));
  return [...new Set(ids)];
}

export function checkOf(finding: SystemMapFinding): FindingCheck {
  const role = str(finding.properties.source_role);
  if (role) return CVE_SOURCE_RE.test(role) ? "cve" : "cwe";
  return classifyFinding(finding) === "package_cve" ? "cve" : "cwe";
}

export function summarizeFinding(finding: SystemMapFinding): FindingSummary {
  const check = checkOf(finding);
  const p = finding.properties;
  if (check === "cwe") {
    return { check, ids: finding.cweId ? [finding.cweId] : [], pkg: null, fixedIn: null };
  }
  const name = first(p, ["package_name", "package"]);
  const version = first(p, ["installed_version", "package_version", "version"]);
  return {
    check,
    ids: cveIds(p),
    pkg: name ? `${name}${version ? `@${version}` : ""}` : null,
    fixedIn: first(p, ["fixed_in", "fixed_version", "patched_version"]),
  };
}
