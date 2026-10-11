/**
 * The curated CWE views the Infosec page's CWE lists tab offers, and the
 * MITRE mapping-usage rule for which entries a CWE workflow may target.
 * Shared by the server read (`cwe-catalogue.ts`) and the tab.
 */

import type { CweMappingUsage } from "@/types/system-map";

export interface CweListOption {
  /** The view's CWE id. */
  value: string;
  label: string;
}

export const CWE_LISTS: CweListOption[] = [
  { value: "CWE-1435", label: "CWE Top 25 (2025)" },
  { value: "CWE-1430", label: "CWE Top 25 (2024)" },
  { value: "CWE-1425", label: "CWE Top 25 (2023)" },
  { value: "CWE-1344", label: "OWASP Top Ten (2021)" },
  { value: "CWE-1450", label: "OWASP Top Ten RC1 (2025)" },
  { value: "CWE-1003", label: "NVD simplified mapping" },
];

export function isCweList(value: unknown): value is string {
  return typeof value === "string" && CWE_LISTS.some((list) => list.value === value);
}

/** Usages under which a CWE may be the subject of a review. */
export function isUsableCwe(usage: CweMappingUsage): boolean {
  return usage === "Allowed" || usage === "Allowed-with-Review";
}
